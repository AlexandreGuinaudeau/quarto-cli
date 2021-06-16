/*
* observable.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { info, warning } from "log/mod.ts";
import { basename, join } from "path/mod.ts";
import { writeAll } from "io/mod.ts";
import { ensureDirSync } from "fs/mod.ts";
import { pandocAutoIdentifier } from "../../core/pandoc/pandoc-id.ts";

const kObservableSiteUrl = "https://observablehq.com/";
const kObservableApiUrl = "https://api.observablehq.com/";
const kFormatHtml = "format: html";

export function isObservableUrl(url: string) {
  return url.startsWith(kObservableSiteUrl) ||
    url.startsWith(kObservableApiUrl);
}

export async function observableNotebookToMarkdown(
  url: string,
  output?: string,
) {
  // convert end-user url to api url if necessary
  if (url.startsWith(kObservableSiteUrl)) {
    const nbPath = url.slice(kObservableSiteUrl.length).replace(/^d\//, "");
    url = `${kObservableApiUrl}document/${nbPath}`;
  }

  // retreive and parse json
  const res = await fetch(url);
  const body = new Uint8Array(await res.arrayBuffer());
  const json = new TextDecoder().decode(body);
  const nb = JSON.parse(json);

  // see if we can determine a default file name
  let file = output ? basename(output) : undefined;
  if (!file) {
    const slug = nb.slug || nb.fork_of?.slug;
    if (typeof (slug) === "string") {
      file = slug;
    } else if (typeof (nb.title) === "string") {
      file = pandocAutoIdentifier(nb.title, false);
    } else {
      file = nb.id as string;
    }
  }

  // determine/ensure output directory
  if (!output) {
    output = file;
  }
  ensureDirSync(output);
  info(`Writing to ${output}/`);

  // download attachments
  const attachments: string[] = [];
  for (const file of nb.files) {
    // download attachment
    info("  " + file.name + " (attachment)");
    const res = await fetch(file.download_url);
    const contents = new Uint8Array(await res.arrayBuffer());
    const downloadTo = await Deno.create(join(output, file.name));
    await writeAll(downloadTo, contents);
    Deno.close(downloadTo.rid);
    // record attachment in list
    attachments.push(file.name);
  }

  // generate markdown
  const kModePrefixes = ["md", "html", "tex"].map(prefix => ({
    prefix,
    re: new RegExp("^" + prefix + "\\s*`\(.+\)`\s*;?$")
  }));
  const lines: string[] = [];
  for (let i = 0; i < nb.nodes.length; i++) {
    // resolve mode and value (new style nodes are typed, old style use prefixes)
    const node = nb.nodes[i];
    let mode = node.mode as string;
    let value = node.value as string;
    const trimmedValue = value.trim();
    if (mode === "js") {
      for (const { prefix, re } of kModePrefixes) {
        let m = trimmedValue.match(re);
        if (m) {
          mode = prefix;
          value = m[1];
        }
      }
    }

    // consume and write front matter if this is the first cell
    if (i === 0) {
      const skip = consumeFrontMatter(mode, value, nb.nodes[1], lines);
      if (skip > 0) {
        i = skip - 1;
        continue;
      }
    }

    // write lines
    switch (mode) {
      case "js":
        lines.push("```{observable}");
        lines.push(value);
        lines.push("```");
        break;
      case "md":
        lines.push(value);
        break;
      case "html":
        lines.push("```{=html}");
        lines.push(value);
        lines.push("```");
        break;
      case "tex":
        lines.push("$$");
        lines.push(value);
        lines.push("$$");
        break;
      default:
        warning("Unknown mode: " + mode);
    }

    // space between blocks
    lines.push("");
  }
  // closing newline
  lines.push("");

  // write markdown
  const qmdFile = join(output, file + ".qmd");
  info("  " + basename(qmdFile));
  Deno.writeTextFileSync(qmdFile, lines.join("\n"));
}

function consumeFrontMatter(
  mode: string,
  value: string,
  nextNode: { mode: string; value: string } | undefined,
  lines: string[],
) {
  let skip = 0;
  let needFormat = true;
  let title = "";
  let leadingMd = "";
  lines.push("---");

  // if it's a markdown cell then look for a title
  if (mode === "md") {
    // capture the title and preserve the rest of the markdown
    leadingMd = value.replace(/^\s*#\s+(.*)\n?/, (_m, p1) => {
      title = p1;
      return "";
    }).trim();

    // if we found a title then add it
    if (title) {
      // skip this node since we got the title and leadingMd from it
      skip++;

      // add title
      lines.push('title: "' + title + '"');
      // check for a metadata comment in the second node
      if (nextNode?.mode === "js") {
        const nodeValue = nextNode.value as string;
        const metaMatch = nodeValue.match(
          /^\s*\/\*-{3,}\s*([\S\s)]*)\n\-{3,}\*\/\s*$/,
        );
        if (metaMatch) {
          const yaml = metaMatch[1];
          if (yaml.includes("format:")) {
            needFormat = false;
          }
          lines.push(yaml);
          skip++; // skip this node since we already processed it
        }
      }
    }
  }

  if (needFormat) {
    lines.push(kFormatHtml);
  }

  lines.push("---");
  lines.push("");

  // see if there is any leading markdown to add
  if (leadingMd) {
    lines.push(leadingMd);
    lines.push("");
  }

  // number of nodes to skip in main procesing loop
  return skip;
}
