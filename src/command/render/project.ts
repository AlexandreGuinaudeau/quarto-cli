/*
* project.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { copySync, ensureDirSync, existsSync } from "fs/mod.ts";
import { dirname, isAbsolute, join, relative } from "path/mod.ts";
import { warning } from "log/mod.ts";

import { ld } from "lodash/mod.ts";

import { resolvePathGlobs } from "../../core/path.ts";

import { kKeepMd } from "../../config/constants.ts";

import {
  kProjectExecuteDir,
  kProjectLibDir,
  kProjectOutputDir,
  kProjectType,
  ProjectContext,
} from "../../project/project-context.ts";

import { projectType } from "../../project/types/project-types.ts";
import { copyResourceFile } from "../../project/project-resources.ts";
import { ensureGitignore } from "../../project/project-gitignore.ts";

import { renderFiles, RenderOptions, RenderResult } from "./render.ts";
import {
  copyToProjectFreezer,
  kProjectFreezeDir,
  pruneProjectFreezer,
  pruneProjectFreezerDir,
} from "./freeze.ts";

export async function renderProject(
  context: ProjectContext,
  options: RenderOptions,
  files?: string[],
): Promise<RenderResult> {
  // lookup the project type
  const projType = projectType(context.config?.project?.[kProjectType]);

  // get real path to the project
  const projDir = Deno.realPathSync(context.dir);

  // is this an incremental render?
  const incremental = !!files;

  // force execution for any incremental files (unless options.useFreezer is set)
  const alwaysExecuteFiles = incremental && !options.useFreezer
    ? ld.cloneDeep(files) as string[]
    : undefined;

  // if we have alwaysExecuteFiles then we need to normalize
  // the files list for comparison
  if (alwaysExecuteFiles && files) {
    files = files.map((file) => {
      const target = isAbsolute(file) ? file : join(Deno.cwd(), file);
      if (!existsSync(target)) {
        throw new Error("Render target does not exist: " + file);
      }
      return Deno.realPathSync(target);
    });
  }

  // check with the project type to see if we should render all
  // of the files in the project with the freezer enabled (required
  // for projects that produce self-contained output from a
  // collection of input files)
  if (
    files && alwaysExecuteFiles &&
    projType.incrementalRenderAll &&
    await projType.incrementalRenderAll(context, options, files)
  ) {
    files = context.files.input;
    options = { ...options, useFreezer: true };
  }

  // default for files if not specified
  files = files || context.files.input;

  // projResults to return
  const projResults: RenderResult = {
    baseDir: projDir,
    outputDir: context.config?.project?.[kProjectOutputDir],
    files: [],
  };

  // ensure we have the requisite entries in .gitignore
  await ensureGitignore(context);

  // lookup the project type and call preRender
  if (projType.preRender) {
    await projType.preRender(context);
  }

  // set execute dir if requested
  const executeDir = context.config?.project?.[kProjectExecuteDir];
  if (options.flags?.executeDir === undefined && executeDir === "project") {
    options = {
      ...options,
      flags: {
        ...options.flags,
        executeDir: projDir,
      },
    };
  }

  // set executeDaemon to 0 for renders of the entire project
  // or a list of more than one file (don't want to leave dozens of
  // kernels in memory)
  if (
    files.length > 1 && options.flags &&
    options.flags.executeDaemon === undefined
  ) {
    options.flags.executeDaemon = 0;
  }

  // determine the output dir
  const outputDir = projResults.outputDir;
  const outputDirAbsolute = outputDir ? join(projDir, outputDir) : undefined;
  if (outputDirAbsolute) {
    ensureDirSync(outputDirAbsolute);
  }

  // track the lib dir
  const libDir = context.config?.project[kProjectLibDir];

  // set QUARTO_PROJECT_DIR
  Deno.env.set("QUARTO_PROJECT_DIR", projDir);
  try {
    // render the files
    const fileResults = await renderFiles(
      files,
      options,
      alwaysExecuteFiles,
      projType?.pandocRenderer
        ? projType.pandocRenderer(options, context)
        : undefined,
      context,
    );

    if (outputDirAbsolute) {
      // move or copy dir
      const relocateDir = (dir: string, copy = false) => {
        const targetDir = join(outputDirAbsolute, dir);
        if (existsSync(targetDir)) {
          Deno.removeSync(targetDir, { recursive: true });
        }
        const srcDir = join(projDir, dir);
        if (existsSync(srcDir)) {
          ensureDirSync(dirname(targetDir));
          if (copy) {
            copySync(srcDir, targetDir);
          } else {
            Deno.renameSync(srcDir, targetDir);
          }
        }
      };
      const moveDir = relocateDir;
      const copyDir = (dir: string) => relocateDir(dir, true);

      // track whether we need to keep the lib dir around
      let keepLibsDir = false;

      // move/copy projResults to output_dir
      fileResults.files.forEach((renderedFile) => {
        // move the renderedFile to the output dir
        const outputFile = join(outputDirAbsolute, renderedFile.file);
        ensureDirSync(dirname(outputFile));
        Deno.renameSync(join(projDir, renderedFile.file), outputFile);

        // files dir
        const keepFiles = !!renderedFile.format.execute[kKeepMd];
        keepLibsDir = keepLibsDir || keepFiles;
        if (renderedFile.supporting) {
          if (keepFiles) {
            renderedFile.supporting.map((file) => copyDir(file));
          } else {
            renderedFile.supporting.map((file) => moveDir(file));
          }
        }

        // resource files
        const resourceDir = join(projDir, dirname(renderedFile.file));
        const globs = renderedFile.resourceFiles.globs;
        const fileResourceFiles = globs.length > 0
          ? resolvePathGlobs(
            resourceDir,
            renderedFile.resourceFiles.globs,
            [],
          )
          : { include: [], exclude: [] };

        // add the explicitly discovered files (if they exist and
        // the output isn't self-contained)
        if (!renderedFile.selfContained) {
          const resultFiles = renderedFile.resourceFiles.files
            .map((file) => join(resourceDir, file))
            .filter(existsSync)
            .map(Deno.realPathSync);
          fileResourceFiles.include.push(...resultFiles);
        }

        // apply removes and filter files dir
        const resourceFiles = fileResourceFiles.include.filter(
          (file: string) => {
            if (fileResourceFiles.exclude.includes(file)) {
              return false;
            } else if (
              renderedFile.supporting &&
              renderedFile.supporting.some((support) =>
                file.startsWith(join(projDir, support))
              )
            ) {
              return false;
            } else {
              return true;
            }
          },
        );

        // render file renderedFile
        projResults.files.push({
          input: renderedFile.input,
          markdown: renderedFile.markdown,
          format: renderedFile.format,
          file: renderedFile.file,
          supporting: renderedFile.supporting,
          resourceFiles,
        });
      });

      // move or copy the lib dir if we have one (move one subdirectory at a time
      // so that we can merge with what's already there)
      if (libDir) {
        const libDirFull = join(context.dir, libDir);
        if (existsSync(libDirFull)) {
          // if this is an incremental render or we are uzing the freezer, then
          // copy lib dirs incrementally (don't replace the whole directory).
          // otherwise, replace the whole thing so we get a clean start
          const libsIncremental = !!(incremental || options.useFreezer);

          // determine format lib dirs (for pruning)
          const formatLibDirs = projType.formatLibDirs
            ? projType.formatLibDirs()
            : [];

          // lib dir to freezer
          const freezeLibDir = (hidden: boolean) => {
            copyToProjectFreezer(context, libDir, hidden, libsIncremental);
            pruneProjectFreezerDir(context, libDir, formatLibDirs, hidden);
            pruneProjectFreezer(context, hidden);
          };

          // copy to hidden freezer
          freezeLibDir(true);

          // if we have a visible freezer then copy to it as well
          if (existsSync(join(context.dir, kProjectFreezeDir))) {
            freezeLibDir(false);
          }

          if (libsIncremental) {
            for (const lib of Deno.readDirSync(libDirFull)) {
              if (lib.isDirectory) {
                const srcDir = join(libDir, lib.name);
                if (keepLibsDir) {
                  copyDir(srcDir);
                } else {
                  moveDir(srcDir);
                }
              }
            }
            if (!keepLibsDir) {
              Deno.removeSync(libDirFull, { recursive: true });
            }
          } else {
            if (keepLibsDir) {
              copyDir(libDir);
            } else {
              moveDir(libDir);
            }
          }
        }
      }

      // determine the output files and filter them out of the resourceFiles
      const outputFiles = projResults.files.map((result) =>
        join(projDir, result.file)
      );
      projResults.files.forEach((file) => {
        file.resourceFiles = file.resourceFiles.filter((resource) =>
          !outputFiles.includes(resource)
        );
      });

      // copy all of the resource files
      const allResourceFiles = ld.uniq(
        (context.files.resources || []).concat(
          projResults.files.flatMap((file) => file.resourceFiles),
        ),
      );

      // copy the resource files to the output dir
      allResourceFiles.forEach((file: string) => {
        const sourcePath = relative(projDir, file);
        const destPath = join(outputDirAbsolute, sourcePath);
        if (existsSync(file)) {
          if (Deno.statSync(file).isFile) {
            copyResourceFile(context.dir, file, destPath);
          }
        } else if (!existsSync(destPath)) {
          warning(`File '${sourcePath}' was not found.`);
        }
      });
    } else {
      // track output files
      projResults.files.push(
        ...fileResults.files.map((result) => ({
          input: result.input,
          markdown: result.markdown,
          format: result.format,
          file: result.file,
          supporting: result.supporting,
          resourceFiles: [],
        })),
      );
    }

    // forward error to projResults
    projResults.error = fileResults.error;

    // call post-render
    if (projType.postRender) {
      await projType.postRender(
        context,
        incremental,
        projResults.files.map((result) => {
          const file = outputDir ? join(outputDir, result.file) : result.file;
          return {
            file: join(projDir, file),
            format: result.format,
          };
        }),
      );
    }

    return projResults;
  } finally {
    Deno.env.delete("QUARTO_PROJECT_DIR");
  }
}
