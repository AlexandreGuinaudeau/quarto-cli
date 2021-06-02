/*
* log.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/
import * as colors from "fmt/colors.ts";
import * as log from "log/mod.ts";
import { LogRecord } from "log/logger.ts";
import { BaseHandler, FileHandler } from "log/handlers.ts";
import { Command } from "cliffy/command/mod.ts";

import { getenv } from "./env.ts";
import { Args } from "flags/mod.ts";
import { lines } from "./text.ts";
import { error, warning } from "log/mod.ts";

export interface LogOptions {
  log?: string;
  level?: string;
  format?: "plain" | "json-stream";
  quiet?: boolean;
  newline?: true;
}

export interface LogMessageOptions {
  newline?: boolean;
  bold?: boolean;
  dim?: boolean;
  indent?: number;
  format?: (line: string) => string;
}

export function appendLogOptions(cmd: Command): Command {
  return cmd.option(
    "--log <level>",
    "Path to log file",
    {
      global: true,
    },
  ).option(
    "--log-level <level>",
    "Log level (info, warning, error, critical)",
    {
      global: true,
    },
  )
    .option(
      "--log-format <format>",
      "Log format (plain, json-stream)",
      {
        global: true,
      },
    )
    .option(
      "--quiet",
      "Suppress console output.",
      {
        global: true,
      },
    );
}

export function logOptions(args: Args) {
  const logOptions: LogOptions = {};
  logOptions.log = args.l || args.log;
  logOptions.level = args.ll || args["log-level"];
  logOptions.quiet = args.q || args.quiet;
  logOptions.format = parseFormat(args.lf || args["log-format"]);
  return logOptions;
}

export class StdErrOutputHandler extends BaseHandler {
  format(logRecord: LogRecord): string {
    let msg = super.format(logRecord);

    if (logRecord.level >= log.LogLevels.WARNING) {
      msg = `${logRecord.levelName}: ${msg}`;
    }

    // Set default options
    const options = {
      newline: true,
      ...(logRecord.args[0] as LogMessageOptions),
    };

    // Format the message based upon type
    switch (logRecord.level) {
      case log.LogLevels.INFO:
      case log.LogLevels.DEBUG:
        msg = applyMsgOptions(msg, options);
        break;
      case log.LogLevels.WARNING:
        msg = colors.yellow(msg);
        break;
      case log.LogLevels.ERROR:
        msg = colors.red(msg);
        break;
      case log.LogLevels.CRITICAL:
        msg = colors.bold(colors.red(msg));
        break;
      default:
        break;
    }

    // Apply the new line (it applies across all types)
    if (options.newline) {
      msg = msg + "\n";
    }

    return msg;
  }
  log(msg: string): void {
    Deno.stderr.writeSync(
      new TextEncoder().encode(msg),
    );
  }
}

export class LogFileHandler extends FileHandler {
  constructor(levelName: log.LevelName, options: LogFileHandlerOptions) {
    super(levelName, options);
    this.msgFormat = options.format;
  }
  msgFormat;

  format(logRecord: LogRecord): string {
    // Messages that start with a carriage return are progress messages
    // that rewrite a line, so just ignore these
    if (logRecord.msg.startsWith("\r")) {
      return "";
    }

    if (this.msgFormat === undefined || this.msgFormat === "plain") {
      // Implement a plain formatted message which is basically
      // the console output, but written without formatting to the log file
      const options = {
        newline: true,
        ...logRecord.args[0] as LogMessageOptions,
        bold: false,
        dim: false,
        format: undefined,
      };
      let msg = applyMsgOptions(logRecord.msg, options);
      if (options.newline) {
        msg = msg + "\n";
      }

      // Error formatting
      if (logRecord.level >= log.LogLevels.WARNING) {
        return `(${logRecord.levelName}) ${msg}`;
      } else {
        return msg;
      }
    } else {
      // Implement streaming JSON output
      return JSON.stringify(logRecord, undefined, 0) + "\n";
    }
  }

  log(msg: string): void {
    // Ignore any messages that are blank
    if (msg !== "") {
      // Strip any color information that may have been applied
      msg = colors.stripColor(msg);
      this._buf.writeSync(this._encoder.encode(msg));
      this._buf.flush();
    }
  }
}

interface LogFileHandlerOptions {
  filename: string;
  mode?: "a" | "w" | "x";
  format?: "plain" | "json-stream";
}

export async function initializeLogger(logOptions: LogOptions) {
  const handlers: Record<string, BaseHandler> = {};
  const defaultHandlers = [];
  const file = logOptions.log;
  const logLevel = logOptions.level ? parseLevel(logOptions.level) : "INFO";

  // Don't add the StdErroutputHandler if we're quiet
  if (!logOptions.quiet) {
    // Default logger just redirects to the console
    handlers["console"] = new StdErrOutputHandler(
      logLevel,
      {
        formatter: "{msg}",
      },
    );
    defaultHandlers.push("console");
  }

  // If a file is specified, add a file based logger
  if (file) {
    handlers["file"] = new LogFileHandler(
      logLevel,
      {
        filename: file,
        mode: "w",
        format: logOptions.format,
      },
    );
    defaultHandlers.push("file");
  }

  // Setup the loggers
  await log.setup({
    handlers,
    loggers: {
      default: {
        level: "DEBUG",
        handlers: defaultHandlers,
      },
    },
  });
}

export function cleanupLogger() {
  // Currently no cleanup required
}

export function logError(e: Error) {
  error(() => {
    const isDebug = getenv("QUARTO_DEBUG", "false") === "true";
    if (isDebug) {
      return e.stack;
    } else {
      return `${e.name}: ${e.message}`;
    }
  });
}

export function warnOnce(msg: string) {
  if (!warnings[msg]) {
    warnings[msg] = true;
    warning(msg);
  }
}
const warnings: Record<string, boolean> = {};

function applyMsgOptions(msg: string, options: LogMessageOptions) {
  if (options.indent) {
    const pad = " ".repeat(options.indent);
    msg = lines(msg)
      .map((msg) => pad + msg)
      .join("\n");
  }
  if (options.bold) {
    msg = colors.bold(msg);
  }
  if (options.dim) {
    msg = colors.dim(msg);
  }
  if (options.format) {
    msg = options.format(msg);
  }

  return msg;
}

function parseFormat(format?: string) {
  if (format) {
    format = format.toLowerCase();
    switch (format) {
      case "plain":
      case "json-stream":
        return format;
      default:
        return "plain";
    }
  } else {
    return "plain";
  }
}

function parseLevel(
  level: string,
): "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL" {
  const lvl = levelMap[level.toLowerCase()];
  if (lvl) {
    return lvl;
  } else {
    return "WARNING";
  }
}
const levelMap: Record<
  string,
  "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL"
> = {
  debug: "DEBUG",
  info: "INFO",
  warning: "WARNING",
  error: "ERROR",
  critical: "CRITICAL",
};
