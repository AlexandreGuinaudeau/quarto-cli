/*
* cmd.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { Command } from "cliffy/command/mod.ts";
import { Confirm } from "cliffy/prompt/mod.ts";
import { info } from "log/mod.ts";

import { formatLine, withSpinner } from "../../core/console.ts";
import { ToolSummaryData } from "./install.ts";

import {
  installableTools,
  installTool,
  toolSummary,
  uninstallTool,
  updateTool,
} from "./install.ts";

// The quarto install command
export const installCommand = new Command()
  .name("install")
  .arguments("<name:string>")
  .description(
    `Installs tools, extensions, and templates.\n\nTools that can be installed include:\n${
      installableTools().map((name) => "  " + name).join("\n")
    }`,
  )
  .option(
    "-lt, --list-tools",
    "List installable tools and their status",
  )
  .example(
    "Install TinyTex",
    "quarto install tinytex",
  )
  // deno-lint-ignore no-explicit-any
  .action(async (options: any, name: string) => {
    if (options.listTools) {
      await outputTools();
    } else if (name) {
      await installTool(name);
    }
  });

// The quarto uninstall command
export const uninstallCommand = new Command()
  .name("uninstall")
  .arguments("<name:string>")
  .description(
    `Uninstalls tools, extensions, and templates.\n\nTools that can be uninstalled include:\n${
      installableTools().map((name) => "  " + name).join("\n")
    }`,
  )
  .example(
    "Uninstall TinyTex",
    "quarto uninstall tinytex",
  )
  // deno-lint-ignore no-explicit-any
  .action(async (_options: any, name: string) => {
    await confirmDestructiveAction(
      name,
      `This will remove ${name} and all of its files. Are you sure?`,
      async () => {
        await uninstallTool(name);
      },
      false,
      await toolSummary(name),
    );
  });

// The quarto update command
export const updateCommand = new Command()
  .name("update")
  .arguments("<name: string>")
  .description(
    `Updates tools, extensions, and templates.\n\nTools that can be updated include:\n${
      installableTools().map((name) => "  " + name).join("\n")
    }`,
  )
  .example(
    "Update TinyTex",
    "quarto update tinytex",
  )
  // deno-lint-ignore no-explicit-any
  .action(async (_options: any, name: string) => {
    const summary = await toolSummary(name);
    await confirmDestructiveAction(
      name,
      `This will update ${name} from ${summary?.installedVersion} to ${
        summary?.latestRelease.version
      }. Are you sure?`,
      async () => {
        await updateTool(name);
      },
      true,
      summary,
    );
  });

async function confirmDestructiveAction(
  name: string,
  prompt: string,
  action: () => Promise<void>,
  update: boolean,
  summary?: ToolSummaryData,
) {
  if (summary) {
    if (summary.installed) {
      if (
        summary.installedVersion === summary.latestRelease.version && update
      ) {
        info(`${name} is already up to date.`);
      } else if (summary.installedVersion !== undefined) {
        const confirmed: boolean = await Confirm.prompt(prompt);
        if (confirmed) {
          await action();
        }
      } else {
        info(
          `${name} was not install using Quarto. Please use the tool that you used to install ${name} instead.`,
        );
      }
    } else {
      info(
        `${name} isn't installed. Please use 'quarto install ${name} to install it.`,
      );
    }
  } else {
    info(
      `${name} isn't a supported tool. Use 'quarto install help' for more information.`,
    );
  }
}

async function outputTools() {
  const toolRows: string[] = [];
  const cols = [20, 32, 14, 14];
  await withSpinner({
    message: "Reading Tool Data",
  }, async () => {
    // Reads the status
    const installStatus = (summary: ToolSummaryData): string => {
      if (summary.installed) {
        if (summary.installedVersion) {
          if (summary.installedVersion === summary.latestRelease.version) {
            return "Up to date";
          } else {
            return "Update available";
          }
        } else {
          return "Present - ext. managed";
        }
      } else {
        return "Not installed";
      }
    };

    // The column widths for output (in chars)

    for (const tool of installableTools()) {
      const summary = await toolSummary(tool);
      if (summary) {
        toolRows.push(
          formatLine(
            [
              tool,
              installStatus(summary),
              summary.installedVersion || "----",
              summary.latestRelease.version,
            ],
            cols,
          ),
        );
      }
    }
  });
  // Write the output
  info(
    formatLine(["Tool", "Status", "Installed", "Latest"], cols),
    { bold: true },
  );
  if (toolRows.length === 0) {
    info("nothing installed", { indent: 2 });
  } else {
    toolRows.forEach((row) => info(row));
  }
}
