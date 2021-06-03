/*
* display-data.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import {
  kApplicationJavascript,
  kApplicationJupyterWidgetState,
  kApplicationJupyterWidgetView,
  kApplicationPdf,
  kImageJpeg,
  kImagePng,
  kImageSvg,
  kTextHtml,
  kTextLatex,
  kTextMarkdown,
  kTextPlain,
} from "../mime.ts";
import {
  JupyterOutput,
  JupyterOutputDisplayData,
  JupyterToMarkdownOptions,
} from "./jupyter.ts";

export function isDisplayData(output: JupyterOutput) {
  return ["display_data", "execute_result"].includes(output.output_type);
}

export function isCaptionableData(output: JupyterOutput) {
  if (isDisplayData(output)) {
    const displayData = output as JupyterOutputDisplayData;
    return !displayData.noCaption;
  } else {
    return false;
  }
}

export function displayDataMimeType(
  output: JupyterOutputDisplayData,
  options: JupyterToMarkdownOptions,
) {
  const displayPriority = [
    kTextMarkdown,
    kImageSvg,
    kImagePng,
    kImageJpeg,
  ];
  if (options.toHtml) {
    const htmlFormats = [
      kApplicationJupyterWidgetState,
      kApplicationJupyterWidgetView,
      kApplicationJavascript,
      kTextHtml,
    ];
    // if we are targeting markdown w/ html then prioritize the html formats
    // (this is b/c jupyter widgets also provide a text/markdown representation
    // that we don't want to have "win" over the widget)
    if (options.toMarkdown) {
      displayPriority.unshift(...htmlFormats);
      // otherwise put them after markdown
    } else {
      displayPriority.push(...htmlFormats);
    }
    displayPriority.unshift(
      kApplicationJupyterWidgetState,
      kApplicationJupyterWidgetView,
      kApplicationJavascript,
      kTextHtml,
    );
  } else if (options.toLatex) {
    displayPriority.push(
      kTextLatex,
      kApplicationPdf,
    );
  } else if (options.toMarkdown) {
    displayPriority.push(
      kTextHtml,
    );
  }
  displayPriority.push(
    kTextPlain,
  );

  const availDisplay = Object.keys(output.data);
  for (const display of displayPriority) {
    if (availDisplay.includes(display)) {
      return display;
    }
  }
  return null;
}

export function displayDataIsImage(mimeType: string) {
  return [kImagePng, kImageJpeg, kImageSvg, kApplicationPdf].includes(mimeType);
}

export function displayDataIsMarkdown(mimeType: string) {
  return [kTextMarkdown, kTextPlain].includes(mimeType);
}

export function displayDataIsLatex(mimeType: string) {
  return [kTextLatex].includes(mimeType);
}

export function displayDataIsHtml(mimeType: string) {
  return [kTextHtml].includes(mimeType);
}

export function displayDataIsJson(mimeType: string) {
  return [kApplicationJupyterWidgetState, kApplicationJupyterWidgetView]
    .includes(mimeType);
}

export function displayDataIsJavascript(mimeType: string) {
  return [kApplicationJavascript].includes(mimeType);
}
