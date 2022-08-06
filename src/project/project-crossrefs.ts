/*
* project-crossrefs.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { basename, isAbsolute, join, relative } from "path/mod.ts";
import {
  kCrossref,
  kCrossrefChapterId,
  kCrossrefChaptersAlpha,
  kCrossrefChaptersAppendix,
} from "../config/constants.ts";
import { Metadata } from "../config/types.ts";

import { projectScratchPath } from "./project-scratch.ts";

export const kCrossrefIndexFile = "crossref-index-file";
export const kCrossrefResolveRefs = "crossref-resolve-refs";

const kCrossrefDir = "crossref";

export function projectCrossrefDir(dir: string) {
  return projectScratchPath(dir, kCrossrefDir);
}

export function crossrefIndexForOutputFile(
  projectDir: string,
  input: string,
  output: string,
) {
  if (isAbsolute(input)) {
    input = relative(projectDir, input);
  }
  return projectScratchPath(
    projectDir,
    join(kCrossrefDir, input, `${basename(output)}.json`),
  );
}

export function deleteCrossrefMetadata(metadata: Metadata) {
  const crossref = metadata[kCrossref] as Metadata;
  if (crossref) {
    delete crossref[kCrossrefChaptersAppendix];
    delete crossref[kCrossrefChaptersAlpha];
    delete crossref[kCrossrefChapterId];
    if (Object.keys(crossref).length === 0) {
      delete metadata[kCrossref];
    }
  }
}
