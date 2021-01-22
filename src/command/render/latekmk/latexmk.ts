/*
 * latexmk.ts
 *
 * Copyright (C) 2020 by RStudio, PBC
 *
 */

import { join, normalize } from "path/mod.ts";

import { writeFileToStdout } from "../../../core/console.ts";
import { dirAndStem, expandPath } from "../../../core/path.ts";

import {
  kKeepTex,
  kLatexAutoInstall,
  kLatexAutoMk,
  kLatexClean,
  kLatexMaxRuns,
  kLatexMinRuns,
  kLatexOutputDir,
  kOutputExt,
  kOutputFile,
} from "../../../config/constants.ts";
import { Format } from "../../../config/format.ts";
import { PdfEngine, pdfEngine } from "../../../config/pdf.ts";

import { PandocOptions } from "../pandoc.ts";
import { RenderOptions } from "../render.ts";
import {
  kStdOut,
  removePandocArgs,
  RenderFlags,
  replacePandocArg,
} from "../flags.ts";
import { OutputRecipe } from "../output.ts";
import { generatePdf } from "./pdf.ts";

// latexmk options
export interface LatexmkOptions {
  input: string;
  engine: PdfEngine;
  autoInstall?: boolean;
  autoMk?: boolean;
  minRuns?: number;
  maxRuns?: number;
  outputDir?: string;
  clean?: boolean;
  quiet?: boolean;
}

export const kLatexMkMessageOptions = { bold: true };

export function useQuartoLatexmk(
  format: Format,
  flags?: RenderFlags,
) {
  // check writer and extension
  const to = format.pandoc.to;
  const ext = format.render[kOutputExt] || "html";

  // Check whether explicitly disabled
  if (format.render[kLatexAutoMk] === false) {
    return false;
  }

  // if we are creating pdf output
  if (["beamer", "pdf"].includes(to || "") && ext === "pdf") {
    const engine = pdfEngine(format.pandoc, format.render, flags);
    return ["pdflatex", "xelatex", "lualatex"].includes(
      engine.pdfEngine,
    );
  }

  // default to false
  return false;
}

export function quartoLatexmkOutputRecipe(
  input: string,
  options: RenderOptions,
  format: Format,
): OutputRecipe {
  // break apart input file
  const [inputDir, inputStem] = dirAndStem(input);

  // there are many characters that give tex trouble in filenames, create
  // a target stem that replaces them with the '-' character
  const texStem = inputStem.replaceAll(/[ <>()|\:&;#?*']/g, "-");

  // cacluate output and args for pandoc (this is an intermediate file
  // which we will then compile to a pdf and rename to .tex)
  const output = texStem + ".tex";
  let args = options.pandocArgs || [];
  const pandoc = { ...format.pandoc };
  if (options.flags?.output) {
    args = replacePandocArg(args, "--output", output);
  } else {
    pandoc[kOutputFile] = output;
  }

  // remove --to argument if it's there, since we've already folded it
  // into the yaml, and it will be "beamer" or "pdf" so actually incorrect
  const removeArgs = new Map<string, boolean>();
  removeArgs.set("--to", true);
  args = removePandocArgs(args, removeArgs);

  // when pandoc is done, we need to run latexmk and then copy the
  // ouptut to the user's requested destination
  const complete = async (pandocOptions: PandocOptions) => {
    // determine latexmk options
    const mkOptions: LatexmkOptions = {
      input: join(inputDir, output),
      engine: pdfEngine(format.pandoc, format.render, pandocOptions.flags),
      autoInstall: format.render[kLatexAutoInstall],
      autoMk: format.render[kLatexAutoMk],
      minRuns: format.render[kLatexMinRuns],
      maxRuns: format.render[kLatexMaxRuns],
      outputDir: format.render[kLatexOutputDir],
      clean: !options.flags?.debug && format.render[kLatexClean] !== false,
      quiet: pandocOptions.flags?.quiet,
    };

    // run latexmk
    await generatePdf(mkOptions);

    // keep tex if requested
    const compileTex = join(inputDir, output);
    if (!format.render[kKeepTex]) {
      Deno.removeSync(compileTex);
    }

    // copy (or write for stdout) compiled pdf to final output location
    const compilePdf = join(inputDir, texStem + ".pdf");
    const finalOutput = options.flags?.output || format.pandoc[kOutputFile];
    if (finalOutput) {
      if (finalOutput === kStdOut) {
        writeFileToStdout(compilePdf);
        Deno.removeSync(compilePdf);
      } else {
        const outputPdf = expandPath(finalOutput);
        if (normalize(compilePdf) !== normalize(outputPdf)) {
          Deno.renameSync(compilePdf, outputPdf);
        }
      }
      return finalOutput;
    } else {
      return compilePdf;
    }
  };

  // tweak writer if it's pdf
  const to = format.pandoc.to === "pdf" ? "latex" : format.pandoc.to;

  // return recipe
  return {
    output,
    args,
    format: {
      ...format,
      pandoc: {
        ...pandoc,
        to,
      },
    },
    complete,
  };
}
