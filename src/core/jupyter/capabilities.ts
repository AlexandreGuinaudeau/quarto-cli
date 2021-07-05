/*
* capabilities.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { join } from "path/mod.ts";
import { existsSync } from "fs/mod.ts";

import { isWindows } from "../platform.ts";
import { execProcess } from "../process.ts";
import { resourcePath } from "../resources.ts";
import { readYamlFromString } from "../yaml.ts";

import { JupyterCapabilities } from "./types.ts";

// cache capabiliites per-process
let cachedJupyterCaps: JupyterCapabilities | undefined;

export async function jupyterCapabilities() {
  if (!cachedJupyterCaps) {
    // if we are on windows and have PY_PYTHON defined then use the launcher
    if (isWindows() && pyPython()) {
      cachedJupyterCaps = await getPyLauncherJupyterCapabilities();
    }

    // default handling (also a fallthrough if launcher didn't work out)
    if (!cachedJupyterCaps) {
      // look for python from conda (conda doesn't provide python3 on windows or mac)
      cachedJupyterCaps = await getJupyterCapabilities(["python"]);

      // if it's not conda then probe explicitly for python 3
      if (!cachedJupyterCaps?.conda) {
        const caps = isWindows()
          ? await getPyLauncherJupyterCapabilities()
          : await getJupyterCapabilities(["python3"]);
        if (caps) {
          cachedJupyterCaps = caps;
        }
      }
    }
  }

  return cachedJupyterCaps;
}

export function isEnvDir(dir: string) {
  return existsSync(join(dir, "pyvenv.cfg")) ||
    existsSync(join(dir, "conda-meta"));
}

function pyPython() {
  return Deno.env.get("PY_PYTHON");
}

function getPyLauncherJupyterCapabilities() {
  return getJupyterCapabilities(["py"], true);
}

async function getJupyterCapabilities(cmd: string[], pyLauncher = false) {
  try {
    const result = await execProcess({
      cmd: [
        ...cmd,
        resourcePath("capabilities/jupyter.py"),
      ],
      stdout: "piped",
      stderr: "piped",
    });
    if (result.success && result.stdout) {
      const caps = readYamlFromString(result.stdout) as JupyterCapabilities;
      if (caps.versionMajor >= 3) {
        caps.pyLauncher = pyLauncher;
        return caps;
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  } catch {
    return undefined;
  }
}
