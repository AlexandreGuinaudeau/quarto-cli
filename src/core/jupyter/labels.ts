import {
  displayDataIsImage,
  displayDataMimeType,
  isCaptionableData,
  isDisplayData,
} from "./display_data.ts";

import {
  JupyterCellWithOptions,
  JupyterOutput,
  JupyterOutputDisplayData,
  JupyterToMarkdownOptions,
  kCellFigCap,
  kCellFigSubCap,
  kCellLabel,
  kCellName,
} from "./jupyter.ts";
import { includeOutput } from "./tags.ts";

export function cellLabel(cell: JupyterCellWithOptions) {
  const label = (cell.options[kCellLabel] || cell.metadata[kCellName] || "");

  if (label && !label.startsWith("#")) {
    return "#" + label;
  } else {
    return label;
  }
}

// validate unique labels
export function cellLabelValidator() {
  const cellLabels = new Set<string>();
  return function (cell: JupyterCellWithOptions) {
    const label = cellLabel(cell);
    if (label) {
      if (cellLabels.has(label)) {
        throw new Error(
          "Cell label names must be unique (found duplicate '" + label + "')",
        );
      } else {
        cellLabels.add(label);
      }
    }
  };
}

export function shouldLabelCellContainer(
  cell: JupyterCellWithOptions,
  options: JupyterToMarkdownOptions,
) {
  // no outputs
  if (!cell.outputs) {
    return true;
  }

  // not including output
  if (!includeOutput(cell, options)) {
    return true;
  }

  // no display data outputs
  const displayDataOutputs = cell.outputs.filter(isDisplayData);
  if (displayDataOutputs.length === 0) {
    return true;
  }

  // multiple display data outputs
  if (displayDataOutputs.length > 1) {
    return true;
  }

  // don't label it (single display_data output)
  return false;
}

export function shouldLabelOutputContainer(
  output: JupyterOutput,
  options: JupyterToMarkdownOptions,
) {
  // label output container unless this is an image (which gets it's id directly assigned)
  if (isDisplayData(output)) {
    if (!isCaptionableData(output)) {
      return false;
    }

    const mimeType = displayDataMimeType(
      output as JupyterOutputDisplayData,
      options,
    );
    if (mimeType) {
      if (displayDataIsImage(mimeType)) {
        return false;
      }
    }
    return true;
  } else {
    return false;
  }
}

export function isFigureLabel(label: string) {
  return label && label.startsWith("#fig:");
}

export function resolveCaptions(cell: JupyterCellWithOptions) {
  // if we have display data outputs, then break off their captions
  if (Array.isArray(cell.options[kCellFigCap])) {
    const figCap = cell.options[kCellFigCap] as string[];
    if (
      cell.outputs &&
      cell.outputs.filter(isCaptionableData).length > 0
    ) {
      return {
        cellCaption: undefined,
        outputCaptions: figCap,
      };
    } else {
      return {
        cellCaption: undefined,
        outputCaptions: [],
      };
    }
  } else if (cell.options[kCellFigCap]) {
    if (cell.options[kCellFigSubCap]) {
      return {
        cellCaption: cell.options[kCellFigCap],
        outputCaptions: cell.options[kCellFigSubCap] || [],
      };
    } else {
      return {
        cellCaption: undefined,
        outputCaptions: [cell.options[kCellFigCap] as string],
      };
    }
  } else {
    return {
      cellCaption: undefined,
      outputCaptions: [],
    };
  }
}
