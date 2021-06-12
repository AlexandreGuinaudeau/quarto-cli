import { join } from "path/mod.ts";

import { docs, outputForInput } from "../../utils.ts";
import { ensureFileRegexMatches, noErrorsOrWarnings } from "../../verify.ts";
import { testRender } from "../render/render.ts";

const input = docs(join("shortcodes", "metadata.qmd"));
const output = outputForInput(input, "html");
testRender(input, "html", false, [
  ensureFileRegexMatches(output.outputPath, [
    /Subkey Value/,
    /Hello World/,
  ], [
    /\?/,
  ]),
]);

const inputError = docs(join("shortcodes", "metadata-error.qmd"));
const outputError = outputForInput(inputError, "html");
testRender(inputError, "html", false, [
  ensureFileRegexMatches(outputError.outputPath, [
    /\?meta:equation/,
    /\?invalid meta type:weird-type/,
  ]),
]);

const inputVars = docs(join("shortcodes", "vars-simple.qmd"));
const outputVars = outputForInput(inputVars, "html");
testRender(inputVars, "html", false, [
  ensureFileRegexMatches(outputVars.outputPath, [
    /bar/,
    /Variable 2 Sub Sub VALUE/,
  ], [
    /\?/,
  ]),
]);

const inputVarsErr = docs(join("shortcodes", "vars-error.qmd"));
const outputVarsErr = outputForInput(inputVarsErr, "html");
testRender(inputVarsErr, "html", false, [
  ensureFileRegexMatches(outputVarsErr.outputPath, [
    /\?var:foobar123/,
  ]),
]);

const inputNoVars = docs(join("shortcodes", "vars-simple.qmd"));
testRender(inputNoVars, "html", false, [
  noErrorsOrWarnings,
], {
  setup: async () => {
    await Deno.rename(
      docs(join("shortcodes", "_variables.yml")),
      docs(join("shortcodes", "_variables.yml,bak")),
    );
  },
  teardown: async () => {
    await Deno.rename(
      docs(join("shortcodes", "_variables.yml,bak")),
      docs(join("shortcodes", "_variables.yml")),
    );
  },
});
