/*
* rmd.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { error, info, warning } from "log/mod.ts";

import { execProcess } from "../core/process.ts";
import { rBinaryPath, resourcePath } from "../core/resources.ts";
import { readYamlFromMarkdownFile } from "../core/yaml.ts";
import { partitionMarkdown } from "../core/pandoc/pandoc-partition.ts";

import { kCodeLink } from "../config/constants.ts";

import {
  DependenciesOptions,
  DependenciesResult,
  ExecuteOptions,
  ExecuteResult,
  ExecutionEngine,
  kQmdExtensions,
  PostProcessOptions,
  postProcessRestorePreservedHtml,
  RunOptions,
} from "./engine.ts";
import { sessionTempFile } from "../core/temp.ts";
import {
  knitrCapabilities,
  knitrCapabilitiesMessage,
  knitrInstallationMessage,
  rInstallationMessage,
} from "../core/knitr.ts";

const kRmdExtensions = [".rmd", ".rmarkdown"];

const kKnitrEngine = "knitr";

export const knitrEngine: ExecutionEngine = {
  name: kKnitrEngine,

  defaultExt: ".Rmd",

  defaultYaml: () => [],

  validExtensions: () => kRmdExtensions.concat(kQmdExtensions),

  claimsExtension: (ext: string) => {
    return kRmdExtensions.includes(ext.toLowerCase());
  },

  claimsLanguage: (language: string) => {
    return language.toLowerCase() === "r";
  },

  target: (file: string, _quiet?: boolean) => {
    return Promise.resolve({
      source: file,
      input: file,
      metadata: readYamlFromMarkdownFile(file),
    });
  },

  partitionedMarkdown: (file: string) => {
    return Promise.resolve(partitionMarkdown(Deno.readTextFileSync(file)));
  },

  execute: (options: ExecuteOptions): Promise<ExecuteResult> => {
    return callR<ExecuteResult>(
      "execute",
      options,
      options.quiet,
    );
  },

  dependencies: (options: DependenciesOptions) => {
    return callR<DependenciesResult>(
      "dependencies",
      options,
      options.quiet,
    );
  },

  postprocess: async (options: PostProcessOptions) => {
    // handle preserved html in js-land
    postProcessRestorePreservedHtml(options);

    // see if we can code link
    if (options.format.render?.[kCodeLink]) {
      await callR<void>(
        "postprocess",
        { ...options, preserve: undefined },
        options.quiet,
        false,
      ).then(() => {
        return Promise.resolve();
      }, () => {
        warning(
          `Unable to perform code-link (code-link requires R and the downlit package)`,
        );
        return Promise.resolve();
      });
    }
  },

  canFreeze: true,

  ignoreGlobs: () => {
    return ["**/renv/**", "**/packrat/**", "**/rsconnect/**"];
  },

  run: (options: RunOptions) => {
    return callR<void>(
      "run",
      options,
    );
  },
};

async function callR<T>(
  action: string,
  params: unknown,
  quiet?: boolean,
  reportError?: boolean,
): Promise<T> {
  // create a temp file for writing the results
  const resultsFile = sessionTempFile(
    { prefix: "r-results", suffix: ".json" },
  );

  const input = JSON.stringify({
    action,
    params,
    results: resultsFile,
  });

  try {
    const result = await execProcess(
      {
        cmd: [
          rBinaryPath("Rscript"),
          resourcePath("rmd/rmd.R"),
        ],
        stderr: quiet ? "piped" : "inherit",
      },
      input,
      "stdout>stderr",
    );

    if (result.success) {
      const results = await Deno.readTextFile(resultsFile);
      await Deno.remove(resultsFile);
      const resultsJson = JSON.parse(results);
      return resultsJson as T;
    } else {
      if (reportError) {
        await printCallRDiagnostics();
      }
      return Promise.reject();
    }
  } catch (e) {
    if (reportError) {
      if (e?.message) {
        info("");
        error(e.message);
      }
      await printCallRDiagnostics();
    }
    return Promise.reject();
  }
}

async function printCallRDiagnostics() {
  const caps = await knitrCapabilities();
  if (caps && !caps.rmarkdown) {
    info("");
    info("R installation:");
    info(knitrCapabilitiesMessage(caps, "  "));
    info("");
    info(knitrInstallationMessage());
    info("");
  } else if (!caps) {
    info("");
    info(rInstallationMessage());
    info("");
  }
}
