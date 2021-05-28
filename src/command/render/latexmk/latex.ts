/*
 * latex.ts
 *
 * Copyright (C) 2020 by RStudio, PBC
 *
 */

import { basename, join } from "path/mod.ts";
import { existsSync } from "fs/mod.ts";
import { error, info } from "log/mod.ts";

import { dirAndStem } from "../../../core/path.ts";
import { execProcess, ProcessResult } from "../../../core/process.ts";

import { PdfEngine } from "../../../config/pdf.ts";
import { PackageManager } from "./pkgmgr.ts";
import { kLatexBodyMessageOptions, kLatexHeaderMessageOptions } from "./pdf.ts";

export interface LatexCommandReponse {
  log: string;
  result: ProcessResult;
  output?: string;
}

export async function hasLatexDistribution() {
  try {
    const result = await execProcess({
      cmd: ["pdftex", "--version"],
      stdout: "piped",
      stderr: "piped",
    });
    return result.code === 0;
  } catch {
    return false;
  }
}

// Runs the Pdf engine
export async function runPdfEngine(
  input: string,
  engine: PdfEngine,
  outputDir?: string,
  pkgMgr?: PackageManager,
  quiet?: boolean,
): Promise<LatexCommandReponse> {
  // Input and log paths
  const [cwd, stem] = dirAndStem(input);
  const targetDir = outputDir ? join(cwd, outputDir) : cwd;
  const output = join(targetDir, `${stem}.pdf`);
  const log = join(targetDir, `${stem}.log`);

  // Clean any log file or output from previous runs
  [log, output].forEach((file) => {
    if (existsSync(file)) {
      Deno.removeSync(file);
    }
  });

  // build pdf engine command line
  const args = ["-interaction=batchmode", "-halt-on-error"];

  // output directory
  if (outputDir !== undefined) {
    args.push(`-output-directory=${outputDir}`);
  }

  // pdf engine opts
  if (engine.pdfEngineOpts) {
    args.push(...engine.pdfEngineOpts);
  }

  // input file
  args.push(basename(input));

  // Run the command
  const result = await runLatexCommand(
    engine.pdfEngine,
    args,
    pkgMgr,
    quiet,
    cwd,
  );

  // Success, return result
  return {
    result,
    output,
    log,
  };
}

// Run the index generation engine (currently hard coded to makeindex)
export async function runIndexEngine(
  input: string,
  engine?: string,
  args?: string[],
  pkgMgr?: PackageManager,
  quiet?: boolean,
) {
  const [cwd, stem] = dirAndStem(input);
  const log = join(cwd, `${stem}.ilg`);

  // Clean any log file from previous runs
  if (existsSync(log)) {
    Deno.removeSync(log);
  }

  const result = await runLatexCommand(
    engine || "makeindex",
    [...(args || []), basename(input)],
    pkgMgr,
    quiet,
    cwd,
  );

  return {
    result,
    log,
  };
}

// Runs the bibengine to process citations
export async function runBibEngine(
  engine: string,
  input: string,
  cwd: string,
  pkgMgr?: PackageManager,
  quiet?: boolean,
): Promise<LatexCommandReponse> {
  const [dir, stem] = dirAndStem(input);
  const log = join(dir, `${stem}.blg`);

  // Clean any log file from previous runs
  if (existsSync(log)) {
    Deno.removeSync(log);
  }

  const result = await runLatexCommand(
    engine,
    [input],
    pkgMgr,
    quiet,
    cwd,
  );
  return {
    result,
    log,
  };
}

async function runLatexCommand(
  latexCmd: string,
  args: string[],
  pkMgr?: PackageManager,
  quiet?: boolean,
  cwd?: string,
): Promise<ProcessResult> {
  const runOptions: Deno.RunOptions = {
    cmd: [latexCmd, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  };

  // Run the command
  const runCmd = async () => {
    const result = await execProcess(runOptions, undefined, "stdout>stderr");
    if (!quiet && result.stderr) {
      info(result.stderr, kLatexBodyMessageOptions);
    }
    return result;
  };

  try {
    // Try running the command
    return await runCmd();
  } catch (e) {
    // First confirm that there is a TeX installation available
    const tex = await hasLatexDistribution();
    if (!tex) {
      info(
        "\nNo TeX installation was detected.\n\nPlease run 'quarto install tinytex' to install TinyTex.\nIf you prefer, you may install TexLive or another TeX distribution.\n",
      );
      return Promise.reject();
    } else if (pkMgr && pkMgr.autoInstall) {
      // If the command itself can't be found, try installing the command
      // if auto installation is enabled
      if (!quiet) {
        info(
          `command ${latexCmd} not found, attempting install`,
          kLatexHeaderMessageOptions,
        );
      }

      // Search for a package for this command
      const packageForCommand = await pkMgr.searchPackages([latexCmd]);
      if (packageForCommand) {
        // try to install it
        await pkMgr.installPackages(packagesForCommand(latexCmd));
      }
      // Try running the command again
      return await runCmd();
    } else {
      // Some other error has occurred
      error(
        `Error executing ${latexCmd}`,
        kLatexHeaderMessageOptions,
      );

      return Promise.reject();
    }
  }
}

// Convert any commands to their
function packagesForCommand(cmd: string): string[] {
  if (cmd === "texindy") {
    return ["xindy"];
  } else {
    return [cmd];
  }
}
