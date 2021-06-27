/*
* serve.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import * as colors from "fmt/colors.ts";
import { error, info } from "log/mod.ts";
import { existsSync } from "fs/mod.ts";
import { basename, extname, join, posix, relative } from "path/mod.ts";

import { Response, serve, ServerRequest } from "http/server.ts";

import { openUrl } from "../../core/shell.ts";
import { contentType, isHtmlContent } from "../../core/mime.ts";
import {
  copyMinimal,
  kSkipHidden,
  pathWithForwardSlashes,
} from "../../core/path.ts";
import { createSessionTempDir } from "../../core/temp.ts";
import { logError } from "../../core/log.ts";
import { PromiseQueue } from "../../core/promise.ts";

import {
  kProjectLibDir,
  ProjectContext,
  projectContext,
  projectIgnoreRegexes,
  projectOutputDir,
} from "../../project/project-context.ts";
import { inputFileForOutputFile } from "../../project/project-index.ts";
import { kProject404File } from "../../project/project-resources.ts";

import { renderProject } from "../render/project.ts";
import { renderResultFinalOutput } from "../render/render.ts";
import { projectFreezerDir } from "../render/freeze.ts";

import { kLocalhost } from "./port.ts";
import { ProjectWatcher, watchProject } from "./watch.ts";

export const kRenderNone = "none";

export type ServeOptions = {
  port: number;
  render: string;
  browse?: boolean;
  watch?: boolean;
  navigate?: boolean;
};

export async function serveProject(
  project: ProjectContext,
  options: ServeOptions,
) {
  // provide defaults
  options = {
    browse: true,
    watch: true,
    navigate: true,
    ...options,
  };

  // render in the main directory
  const renderResult = await renderProject(
    project,
    {
      useFreezer: options.render === kRenderNone,
      flags: options.render !== kRenderNone ? { to: options.render } : {},
    },
  );

  // exit if there was an error
  if (renderResult.error) {
    throw error;
  }

  // create mirror of project for serving
  const serveDir = copyProjectForServe(project, true);
  const serveProject = (await projectContext(serveDir))!;

  // create project watcher
  const watcher = await watchProject(
    project,
    serveProject,
    renderResult,
    options,
  );

  // create a promise queue so we only do one renderProject at a time
  const renderQueue = new PromiseQueue();

  // main request handler
  const handler = async (req: ServerRequest): Promise<void> => {
    // handle watcher request
    if (watcher.handle(req)) {
      return await watcher.connect(req);
    }

    // handle file requests
    const serveOutputDir = projectOutputDir(serveProject);
    let response: Response | undefined;
    let fsPath: string | undefined;
    try {
      const normalizedUrl = normalizeURL(req.url);
      fsPath = serveOutputDir + normalizedUrl!;
      // don't let the path escape the serveDir
      if (fsPath!.indexOf(serveOutputDir) !== 0) {
        fsPath = serveDir;
      }
      const fileInfo = existsSync(fsPath) ? Deno.statSync(fsPath!) : undefined;
      if (fileInfo && fileInfo.isDirectory) {
        fsPath = join(fsPath, "index.html");
      }
      if (fileInfo?.isDirectory && !normalizedUrl.endsWith("/")) {
        response = serveRedirect(normalizedUrl + "/");
      } else {
        response = await serveFile(fsPath!, watcher, renderQueue);
        printUrl(normalizedUrl);
      }
    } catch (e) {
      response = await serveFallback(req, e, fsPath!, serveOutputDir);
    } finally {
      try {
        await req.respond(response!);
      } catch (e) {
        maybeDisplaySocketError(e);
      }
    }
  };

  // serve project
  const server = serve({ port: options.port, hostname: kLocalhost });

  // compute site url
  const siteUrl = `http://localhost:${options.port}/`;

  // print status
  if (options.watch) {
    info("Watching project for reload on changes");
  }
  info(`Browse preview at `, {
    newline: false,
  });
  info(`${siteUrl}`, { format: colors.underline });

  // open browser if requested
  if (options.browse) {
    if (renderResult.baseDir && renderResult.outputDir) {
      const finalOutput = renderResultFinalOutput(renderResult);
      if (finalOutput) {
        const targetPath = pathWithForwardSlashes(relative(
          join(renderResult.baseDir, renderResult.outputDir),
          finalOutput,
        ));
        openUrl(targetPath === "index.html" ? siteUrl : siteUrl + targetPath);
      }
    } else {
      openUrl(siteUrl);
    }
  }

  // wait for requests
  for await (const req of server) {
    handler(req);
  }
}

export function copyProjectForServe(
  project: ProjectContext,
  copyOutput: boolean,
  serveDir?: string,
) {
  serveDir = serveDir || createSessionTempDir();

  // output dir
  const outputDir = projectOutputDir(project);
  // lib dir
  const libDirConfig = project.config?.project[kProjectLibDir];
  const libDir = libDirConfig ? join(project.dir, libDirConfig) : undefined;

  const projectIgnore = projectIgnoreRegexes(project.dir);

  const filter = (path: string) => {
    if (
      !copyOutput &&
      (path.startsWith(outputDir) || (libDir && path.startsWith(libDir)))
    ) {
      return false;
    }
    const pathRelative = pathWithForwardSlashes(relative(project.dir, path));
    return !projectIgnore.some((regex: RegExp) => regex.test(pathRelative));
  };

  copyMinimal(
    project.dir,
    serveDir,
    [kSkipHidden],
    filter,
  );
  copyMinimal(
    projectFreezerDir(project.dir, true),
    projectFreezerDir(serveDir, true),
  );
  return Deno.realPathSync(serveDir);
}

export function maybeDisplaySocketError(e: unknown) {
  if (
    !(e instanceof Deno.errors.BrokenPipe) &&
    !(e instanceof Deno.errors.ConnectionAborted)
  ) {
    logError(e as Error);
  }
}

function serveRedirect(url: string): Response {
  const headers = new Headers();
  headers.set("Location", url);
  return {
    status: 301,
    headers,
  };
}

function serveFallback(
  req: ServerRequest,
  e: Error,
  fsPath: string,
  serveOutputDir: string,
): Promise<Response> {
  const encoder = new TextEncoder();
  if (e instanceof URIError) {
    return Promise.resolve({
      status: 400,
      body: encoder.encode("Bad Request"),
    });
  } else if (e instanceof Deno.errors.NotFound) {
    const url = normalizeURL(req.url);
    if (
      basename(fsPath) !== "favicon.ico" && extname(fsPath) !== ".map" &&
      !basename(fsPath).startsWith("jupyter-")
    ) {
      printUrl(url, false);
    }
    let body = encoder.encode("Not Found");
    const custom404 = join(serveOutputDir, kProject404File);
    if (existsSync(custom404)) {
      body = Deno.readFileSync(custom404);
    }
    return Promise.resolve({
      status: 404,
      body,
    });
  } else {
    error(`500 (Internal Error): ${(e as Error).message}`, { bold: true });
    return Promise.resolve({
      status: 500,
      body: encoder.encode("Internal server error"),
    });
  }
}

async function serveFile(
  filePath: string,
  watcher: ProjectWatcher,
  renderQueue: PromiseQueue,
): Promise<Response> {
  // read file
  let fileContents = new Uint8Array();

  // if this is an html file then re-render (using the freezer)
  if (isHtmlContent(filePath)) {
    // find the input file associated with this output and render it
    // if we can't find an input file for this .html file it may have
    // been an input added after the server started running, to catch
    // this case run a refresh on the watcher then try again
    const serveDir = projectOutputDir(watcher.serveProject());
    const filePathRelative = relative(serveDir, filePath);
    let inputFile = await inputFileForOutputFile(
      watcher.serveProject(),
      filePathRelative,
    );
    if (!inputFile || !existsSync(inputFile)) {
      inputFile = await inputFileForOutputFile(
        await watcher.refreshProject(),
        filePathRelative,
      );
    }
    if (inputFile) {
      try {
        await renderQueue.enqueue(() =>
          renderProject(
            watcher.serveProject(),
            { useFreezer: true, devServerReload: true, flags: { quiet: true } },
            [inputFile!],
          )
        );
      } catch (e) {
        logError(e);
      }
    }

    fileContents = Deno.readFileSync(filePath);
    fileContents = watcher.injectClient(fileContents);
  } else {
    fileContents = Deno.readFileSync(filePath);
  }

  // content headers
  const headers = new Headers();
  headers.set("Content-Length", fileContents.byteLength.toString());
  const contentTypeValue = contentType(filePath);
  if (contentTypeValue) {
    headers.set("Content-Type", contentTypeValue);
  }
  headers.set("Cache-Control", "no-store, max-age=0");

  return {
    status: 200,
    body: fileContents,
    headers,
  };
}

function printUrl(url: string, found = true) {
  const format = !found ? colors.red : undefined;
  const urlDisplay = url + (found ? "" : " (404: Not Found)");
  if (
    isHtmlContent(url) || url.endsWith("/") || extname(url) === ""
  ) {
    info(`GET: ${urlDisplay}`, {
      bold: false,
      format: format || colors.green,
    });
  } else if (!found) {
    info(urlDisplay, { dim: found, format, indent: 2 });
  }
}

function normalizeURL(url: string): string {
  let normalizedUrl = url;
  try {
    normalizedUrl = decodeURI(normalizedUrl);
  } catch (e) {
    if (!(e instanceof URIError)) {
      throw e;
    }
  }

  try {
    //allowed per https://www.w3.org/Protocols/rfc2616/rfc2616-sec5.html
    const absoluteURI = new URL(normalizedUrl);
    normalizedUrl = absoluteURI.pathname;
  } catch (e) { //wasn't an absoluteURI
    if (!(e instanceof TypeError)) {
      throw e;
    }
  }

  if (normalizedUrl[0] !== "/") {
    throw new URIError("The request URI is malformed.");
  }

  normalizedUrl = posix.normalize(normalizedUrl);
  const startOfParams = normalizedUrl.indexOf("?");
  return startOfParams > -1
    ? normalizedUrl.slice(0, startOfParams)
    : normalizedUrl;
}
