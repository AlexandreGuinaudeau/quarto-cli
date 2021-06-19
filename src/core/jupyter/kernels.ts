/*
* kerenels.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

// deno-lint-ignore-file camelcase

import { basename, join } from "path/mod.ts";
import { existsSync, walkSync } from "fs/mod.ts";

import { debug } from "log/mod.ts";

import { execProcess } from "../process.ts";
import { jupyterExec } from "./exec.ts";

export interface JupyterKernelspec {
  name: string;
  language: string;
  display_name: string;
}

// deno-lint-ignore no-explicit-any
export function isJupyterKernelspec(x: any): x is JupyterKernelspec {
  if (x && typeof (x) === "object") {
    return typeof (x.name) === "string" &&
      typeof (x.language) === "string" &&
      typeof (x.display_name) === "string";
  } else {
    return false;
  }
}

export async function jupyterKernelspec(
  name: string,
): Promise<JupyterKernelspec | undefined> {
  const kernelspecs = await jupyterKernelspecs();
  return kernelspecs.get(name);
}

export async function jupyterKernelspecs(): Promise<
  Map<string, JupyterKernelspec>
> {
  try {
    const result = await execProcess(
      {
        cmd: [...(await jupyterExec()), "--paths", "--json"],
        stdout: "piped",
      },
    );
    if (result.success) {
      const kernelmap = new Map<string, JupyterKernelspec>();
      const dataPaths = JSON.parse(result.stdout!).data;
      for (const path of dataPaths) {
        if (!existsSync(path)) {
          continue;
        }
        const kernels = join(path, "kernels");
        if (!existsSync(kernels)) {
          continue;
        }
        for (const walk of walkSync(kernels, { maxDepth: 1 })) {
          if (walk.path === kernels || !walk.isDirectory) {
            continue;
          }
          const kernelConfig = join(walk.path, "kernel.json");
          if (existsSync(kernelConfig)) {
            const config = JSON.parse(Deno.readTextFileSync(kernelConfig));
            const name = basename(walk.path);
            kernelmap.set(name, {
              name,
              language: config.language,
              display_name: config.display_name,
            });
          }
        }
      }
      return kernelmap;
    } else {
      return kDefaultKernelspecs;
    }
  } catch (e) {
    debug("Error reading kernelspecs: " + e.message);
    return kDefaultKernelspecs;
  }
}

// default kernelspecs for when we can't talk to to jupyter
const kDefaultKernelspecs = new Map<string, JupyterKernelspec>();
kDefaultKernelspecs.set("python3", {
  "display_name": "Python 3",
  "language": "python",
  "name": "python3",
});
