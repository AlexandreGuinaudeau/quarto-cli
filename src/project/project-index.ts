/*
* project-index.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { dirname, join, relative } from "path/mod.ts";
import { existsSync } from "fs/mod.ts";
import { fileExecutionEngine } from "../execute/engine.ts";

import { dirAndStem, pathWithForwardSlashes } from "../core/path.ts";
import { PartitionedMarkdown } from "../core/pandoc/pandoc-partition.ts";

import { Metadata } from "../config/types.ts";
import { Format } from "../config/format.ts";

import { kOutputFile, kTitle } from "../config/constants.ts";

import { renderFormats } from "../command/render/render.ts";

import {
  projectConfigFile,
  ProjectContext,
  projectOutputDir,
} from "./project-shared.ts";

import { projectScratchPath } from "./project-scratch.ts";

export interface InputTargetIndex extends Metadata {
  title?: string;
  markdown: PartitionedMarkdown;
  formats: Record<string, Format>;
}

export async function inputTargetIndex(
  project: ProjectContext,
  input: string,
): Promise<InputTargetIndex | undefined> {
  // calculate input file
  const inputFile = join(project.dir, input);

  // return undefined if the file doesn't exist
  if (!existsSync(inputFile) || Deno.statSync(inputFile).isDirectory) {
    return Promise.resolve(undefined);
  }

  // check if this can be handled by one of our engines
  const engine = fileExecutionEngine(inputFile);
  if (engine === undefined) {
    return Promise.resolve(undefined);
  }

  // see if we have an up to date index file
  const targetIndex = readInputTargetIndex(project.dir, input);
  if (targetIndex) {
    return targetIndex;
  }

  // otherwise read the metadata and index it
  const formats = await renderFormats(inputFile, "all", project);
  const firstFormat = Object.values(formats)[0];
  const index = {
    title: firstFormat
      ? firstFormat.metadata?.[kTitle] as string | undefined
      : undefined,
    markdown: await engine.partitionedMarkdown(inputFile),
    formats,
  };

  // if there is no title then try to extract it from a header
  if (!index.title) {
    index.title = index.markdown.headingText;
  }

  const indexFile = inputTargetIndexFile(project.dir, input);
  Deno.writeTextFileSync(indexFile, JSON.stringify(index));
  return index;
}

// reads an existing input target index file
export function readInputTargetIndex(
  projectDir: string,
  input: string,
): InputTargetIndex | undefined {
  const inputFile = join(projectDir, input);
  const indexFile = inputTargetIndexFile(projectDir, input);
  if (existsSync(indexFile)) {
    const inputMod = Deno.statSync(inputFile).mtime;
    const indexMod = Deno.statSync(indexFile).mtime;
    const projConfigFile = projectConfigFile(projectDir);
    const projMod = projConfigFile ? Deno.statSync(projConfigFile).mtime : 0;
    if (
      inputMod && indexMod && (indexMod >= inputMod) &&
      (!projMod || (indexMod >= projMod))
    ) {
      try {
        return JSON.parse(Deno.readTextFileSync(indexFile));
      } catch {
        return undefined;
      }
    }
  }
}

export async function resolveInputTarget(
  project: ProjectContext,
  href: string,
  absolute = true,
) {
  const index = await inputTargetIndex(project, href);
  if (index) {
    const format = Object.values(index.formats)[0];
    const [hrefDir, hrefStem] = dirAndStem(href);
    const outputFile = format?.pandoc[kOutputFile] || `${hrefStem}.html`;
    const outputHref = pathWithForwardSlashes(
      (absolute ? "/" : "") + join(hrefDir, outputFile),
    );
    return { title: index.title, outputHref };
  } else {
    return undefined;
  }
}

export async function inputFileForOutputFile(
  project: ProjectContext,
  output: string,
) {
  // compute output dir
  const outputDir = projectOutputDir(project);

  // full path to output (it's relative to output dir)
  output = join(outputDir, output);

  for (const file of project.files.input) {
    const inputRelative = relative(project.dir, file);
    const index = await inputTargetIndex(project, relative(project.dir, file));
    if (index) {
      const hasOutput = Object.keys(index.formats).some((key) => {
        const format = index.formats[key];
        if (format.pandoc[kOutputFile]) {
          const formatOutputPath = join(
            outputDir!,
            dirname(inputRelative),
            format.pandoc[kOutputFile]!,
          );
          return output === formatOutputPath;
        }
      });
      if (hasOutput) {
        return file;
      }
    }
  }
}

function inputTargetIndexFile(projectDir: string, input: string): string {
  return indexPath(projectDir, `${input}.json`);
}

function indexPath(projectDir: string, path = ""): string {
  return projectScratchPath(projectDir, join("index", path));
}
