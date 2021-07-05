/*
* website-sitemap.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { copySync, existsSync } from "fs/mod.ts";
import { join, relative } from "path/mod.ts";

import { ElementInfo, SAXParser } from "xmlp/mod.ts";

import { ProjectContext } from "../../types.ts";
import { projectOutputDir } from "../../project-shared.ts";
import { pathWithForwardSlashes, removeIfExists } from "../../../core/path.ts";

import { renderEjs } from "../../../core/ejs.ts";
import { resourcePath } from "../../../core/resources.ts";

import { ProjectOutputFile } from "../types.ts";
import { websiteBaseurl } from "./website-config.ts";

export async function updateSitemap(
  context: ProjectContext,
  outputFiles: ProjectOutputFile[],
  incremental: boolean,
) {
  // get output dir
  const outputDir = projectOutputDir(context);

  // see if we have a robots.txt to copy
  const robotsTxtPath = join(context.dir, "robots.txt");
  const srcRobotsTxt = existsSync(robotsTxtPath) ? robotsTxtPath : undefined;
  const destRobotsTxt = join(outputDir, "robots.txt");
  if (srcRobotsTxt) {
    copySync(srcRobotsTxt, destRobotsTxt, {
      overwrite: true,
      preserveTimestamps: true,
    });
  }

  const baseUrlConfig = websiteBaseurl(context.config);
  const sitemapPath = join(outputDir, "sitemap.xml");
  if (typeof baseUrlConfig === "string") {
    // normalize baseUrl
    let baseUrl = baseUrlConfig as string;
    if (!baseUrl.endsWith("/")) {
      baseUrl += "/";
    }

    // helper to create a urlset entry
    const fileLoc = (file: string) =>
      pathWithForwardSlashes(
        join(baseUrl as string, relative(outputDir, file)),
      );
    const fileLastMod = (file: string) =>
      (Deno.statSync(file).mtime || new Date(0))
        .toISOString();
    const urlsetEntry = (outputFile: ProjectOutputFile) => {
      const file = outputFile.file;
      return { loc: fileLoc(file), lastmod: fileLastMod(file) };
    };

    // full render or no existing sitemap creates a fresh sitemap.xml
    if (!incremental || !existsSync(sitemapPath)) {
      // write sitemap
      writeSitemap(sitemapPath, outputFiles.map(urlsetEntry));
    } else { // otherwise parse the sitemap, update and write a new one
      const urlset = outputFiles.reduce(
        (urlset: Urlset, outputFile: ProjectOutputFile) => {
          const file = outputFile.file;
          const loc = fileLoc(file);
          const url = urlset.find((url) => url.loc === loc);
          if (url) {
            url.lastmod = fileLastMod(file);
          } else {
            urlset.push(urlsetEntry(outputFile));
          }
          return urlset;
        },
        await readSitemap(sitemapPath),
      );
      writeSitemap(sitemapPath, urlset);
    }

    // create robots.txt if necessary
    if (!srcRobotsTxt) {
      const robotsTxt = `Sitemap: ${baseUrl}sitemap.xml\n`;
      if (
        !existsSync(destRobotsTxt) ||
        (Deno.readTextFileSync(destRobotsTxt) !== robotsTxt)
      ) {
        Deno.writeTextFileSync(destRobotsTxt, robotsTxt);
      }
    }
  } else {
    removeIfExists(sitemapPath);
  }
}

type Urlset = Array<{ loc: string; lastmod: string }>;

async function readSitemap(sitemapPath: string): Promise<Urlset> {
  const urlset = new Array<{ loc: string; lastmod: string }>();
  const parser = new SAXParser();
  let loc: string | undefined;
  let lastmod: string | undefined;
  parser.on("text", (text: string, element: ElementInfo) => {
    if (element.qName === "loc") {
      loc = text;
    } else if (element.qName == "lastmod") {
      lastmod = text;
    }
  });
  parser.on("end_element", (element: ElementInfo) => {
    if (element.qName === "url" && loc && lastmod) {
      urlset.push({ loc, lastmod });
    }
  });
  const reader = await Deno.open(sitemapPath);
  await parser.parse(reader);
  reader.close();
  return urlset;
}

function writeSitemap(sitemapPath: string, urlset: Urlset) {
  const sitemap = renderEjs(
    resourcePath(
      join("projects", "website", "templates", "sitemap.ejs.xml"),
    ),
    { urlset },
  );
  Deno.writeTextFileSync(sitemapPath, sitemap);
}
