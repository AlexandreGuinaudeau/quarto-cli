import { existsSync } from "fs/mod.ts";
import { dirname, join } from "path/mod.ts";

import { unTar } from "../../util/tar.ts";
import { unzip } from "../../util/utils.ts";
import { Logger } from "../../util/logger.ts";
import { Dependency } from "./dependencies.ts";

export function pandoc(version: string, log: Logger): Dependency {
  // Maps the file name and pandoc executable file name to a repo and expand
  // to create a pandocRelease
  const pandocRelease = (
    filename: string,
    pandocBinary: string,
  ) => {
    return {
      filename,
      url:
        `https://github.com/jgm/pandoc/releases/download/${version}/${filename}`,
      configure: async (path: string) => {
        const dir = dirname(path);
        const pandocSubdir = join(dir, `pandoc-${version}`);

        // Clean pandoc interim dir
        if (existsSync(pandocSubdir)) {
          Deno.removeSync(pandocSubdir, { recursive: true });
        }

        // Extract pandoc
        if (Deno.build.os === "linux") {
          await unTar(path, log);
        } else {
          await unzip(path, dir, log);
        }

        // move the binary
        Deno.renameSync(
          join(pandocSubdir, "bin", pandocBinary),
          join(dir, pandocBinary),
        );

        // cleanup
        if (existsSync(pandocSubdir)) {
          Deno.removeSync(pandocSubdir, { recursive: true });
        }
      },
    };
  };

  // The pandocRelease
  return {
    name: "Pandoc",
    version,
    "windows": pandocRelease(
      `pandoc-${version}-windows-x86_64.zip`,
      "pandoc.exe",
    ),
    "linux": pandocRelease(
      `pandoc-${version}-linux-amd64.tar.gz`,
      "pandoc",
    ),
    "darwin": pandocRelease(
      `pandoc-${version}-macOS.zip`,
      "pandoc",
    ),
  };
}
