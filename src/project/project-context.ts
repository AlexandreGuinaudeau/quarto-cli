/*
* project-context.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { dirname, globToRegExp, isAbsolute, join, relative } from "path/mod.ts";
import { existsSync, walkSync } from "fs/mod.ts";

import { ld } from "lodash/mod.ts";

import { readYaml } from "../core/yaml.ts";
import { mergeConfigs } from "../core/config.ts";
import { kSkipHidden, pathWithForwardSlashes } from "../core/path.ts";

import { Metadata } from "../config/types.ts";
import { includedMetadata } from "../config/metadata.ts";
import {
  kHtmlMathMethod,
  kMetadataFile,
  kMetadataFiles,
  kQuartoVarsKey,
} from "../config/constants.ts";

import { ProjectType } from "./types/project-type.ts";
import { projectType } from "./types/project-types.ts";

import { resolvePathGlobs } from "../core/path.ts";

import {
  engineIgnoreGlobs,
  executionEngineKeepFiles,
  fileExecutionEngine,
} from "../execute/engine.ts";
import { kMarkdownEngine } from "../execute/markdown.ts";

import { projectResourceFiles } from "./project-resources.ts";
import { gitignoreEntries } from "./project-gitignore.ts";
import {
  kProjectLibDir,
  kProjectOutputDir,
  kProjectRender,
  kProjectType,
  ProjectConfig,
  projectConfigFile,
  ProjectContext,
  projectVarsFile,
} from "./project-shared.ts";

export function deleteProjectMetadata(metadata: Metadata) {
  // see if the active project type wants to filter the config printed
  const projType = projectType(
    (metadata as ProjectConfig).project?.[kProjectType],
  );
  if (projType.metadataFields) {
    for (const field of projType.metadataFields().concat("project")) {
      if (typeof (field) === "string") {
        delete metadata[field];
      } else {
        for (const key of Object.keys(metadata)) {
          if (field.test(key)) {
            delete metadata[key];
          }
        }
      }
    }
  }

  // remove project config
  delete metadata.project;
}

export async function projectContext(
  path: string,
  force = false,
  forceHtml = false,
): Promise<ProjectContext | undefined> {
  let dir = Deno.realPathSync(
    Deno.statSync(path).isDirectory ? path : dirname(path),
  );
  const originalDir = dir;

  while (true) {
    const configFile = projectConfigFile(dir);
    if (configFile) {
      let projectConfig: ProjectConfig = readYaml(configFile) as ProjectConfig;
      projectConfig.project = projectConfig.project || {};
      const includedMeta = includedMetadata(dir, projectConfig);
      const metadata = includedMeta.metadata;
      const metadataFileRefs = includedMeta.files;
      projectConfig = mergeConfigs(projectConfig, metadata);
      delete projectConfig[kMetadataFile];
      delete projectConfig[kMetadataFiles];

      // read vars and merge into the project
      const varsFile = projectVarsFile(dir);
      if (varsFile) {
        const vars = readYaml(varsFile) as Metadata;
        projectConfig[kQuartoVarsKey] = mergeConfigs(
          projectConfig[kQuartoVarsKey] || {},
          vars,
        );
      }

      if (projectConfig?.project?.[kProjectType]) {
        // get project config and type

        const type = projectType(projectConfig.project?.[kProjectType]);
        if (
          projectConfig.project[kProjectLibDir] === undefined && type.libDir
        ) {
          projectConfig.project[kProjectLibDir] = type.libDir;
        }
        if (!projectConfig.project[kProjectOutputDir] && type.outputDir) {
          projectConfig.project[kProjectOutputDir] = type.outputDir;
        }
        // see if the project [kProjectType] wants to filter the project config
        if (type.config) {
          projectConfig = await type.config(dir, projectConfig, forceHtml);
        }
        const { files, engines } = projectInputFiles(dir, projectConfig);
        return {
          dir,
          engines,
          files: {
            input: files,
            resources: projectResourceFiles(dir, projectConfig),
            config: [configFile].concat(metadataFileRefs),
            configResources: projectConfigResources(dir, type, projectConfig),
          },
          config: projectConfig,
          formatExtras: type.formatExtras,
        };
      } else {
        const { files, engines } = projectInputFiles(dir);
        return {
          dir,
          engines,
          config: projectConfig,
          files: {
            input: files,
          },
        };
      }
    } else {
      const nextDir = dirname(dir);
      if (nextDir === dir) {
        if (force) {
          const context: ProjectContext = {
            dir: originalDir,
            engines: [],
            config: { project: {} },
            files: {
              input: [],
            },
          };
          if (Deno.statSync(path).isDirectory) {
            const { files, engines } = projectInputFiles(originalDir);
            context.engines = engines;
            context.files.input = files;
          } else {
            const input = Deno.realPathSync(path);
            context.engines = [
              fileExecutionEngine(input)?.name || kMarkdownEngine,
            ];
            context.files.input = [input];
          }
          return context;
        } else {
          return undefined;
        }
      } else {
        dir = nextDir;
      }
    }
  }
}

// read project context (if there is no project config file then still create
// a context (i.e. implicitly treat directory as a project)
export function projectContextForDirectory(
  path: string,
): Promise<ProjectContext> {
  return projectContext(path, true) as Promise<ProjectContext>;
}

export function projectOutputDir(context: ProjectContext): string {
  let outputDir = context.config?.project[kProjectOutputDir];
  if (outputDir) {
    outputDir = join(context.dir, outputDir);
  } else {
    outputDir = context.dir;
  }
  if (existsSync(outputDir)) {
    return Deno.realPathSync(outputDir);
  } else {
    return outputDir;
  }
}

export function projectIsWebserverTarget(context: ProjectContext): boolean {
  const projType = projectType(context.config?.project?.[kProjectType]);
  return !!projType.canServe;
}

export function projectIgnoreGlobs(dir: string) {
  return engineIgnoreGlobs().concat(
    gitignoreEntries(dir).map((ignore) => `**/${ignore}**`),
  );
}

export function projectIgnoreRegexes(dir: string) {
  return projectIgnoreGlobs(dir).map((glob) =>
    globToRegExp(glob, { extended: true, globstar: true })
  );
}

export async function projectMetadataForInputFile(
  input: string,
  project?: ProjectContext,
): Promise<Metadata> {
  if (project) {
    // don't mutate caller
    project = ld.cloneDeep(project) as ProjectContext;
  } else {
    project = await projectContext(input);
  }

  const projConfig = project?.config || {};

  const fixupPaths = (
    collection: Array<unknown> | Record<string, unknown>,
    parentKey?: unknown,
  ) => {
    ld.forEach(
      collection,
      (
        value: unknown,
        index: unknown,
        collection: Array<unknown> | Record<string, unknown>,
      ) => {
        const assign = (value: unknown) => {
          if (typeof (index) === "number") {
            (collection as Array<unknown>)[index] = value;
          } else if (typeof (index) === "string") {
            (collection as Record<string, unknown>)[index] = value;
          }
        };

        if (parentKey === kHtmlMathMethod && index === "method") {
          // don't fixup html-math-method
        } else if (Array.isArray(value)) {
          assign(fixupPaths(value));
        } else if (typeof (value) === "object") {
          assign(fixupPaths(value as Record<string, unknown>, index));
        } else if (typeof (value) === "string") {
          if (!isAbsolute(value)) {
            // if this is a valid file, then transform it to be relative to the input path
            const projectPath = join(project!.dir, value);

            // Paths could be invalid paths (e.g. with colons or other weird characters)
            try {
              if (existsSync(projectPath)) {
                const offset = relative(dirname(input), project!.dir);
                assign(pathWithForwardSlashes(join(offset, value)));
              }
            } catch {
              // Just ignore this error as the path must not be a local file path
            }
          }
        }
      },
    );
    return collection;
  };

  return fixupPaths(projConfig) as Metadata;
}

function projectInputFiles(
  dir: string,
  metadata?: ProjectConfig,
): { files: string[]; engines: string[] } {
  const files: string[] = [];
  const engines: string[] = [];
  const keepFiles: string[] = [];

  const outputDir = metadata?.project[kProjectOutputDir];

  const projIgnoreGlobs = projectIgnoreGlobs(dir) // standard ignores for all projects
    .concat(["**/_*", "**/_*/**"]) // underscore prefx
    .concat(["**/.*", "**/.*/**"]) // hidden (dot prefix)
    .concat(["**/README.?([Rrq])md"]); // README

  // map to regex
  const projectIgnores = projIgnoreGlobs.map((glob) =>
    globToRegExp(glob, { extended: true, globstar: true })
  );

  const addFile = (file: string) => {
    if (!outputDir || !file.startsWith(join(dir, outputDir))) {
      const engine = fileExecutionEngine(file);
      if (engine) {
        if (!engines.includes(engine.name)) {
          engines.push(engine.name);
        }
        files.push(file);
        const keep = executionEngineKeepFiles(engine, file);
        if (keep) {
          keepFiles.push(...keep);
        }
      }
    }
  };

  const addDir = (dir: string) => {
    // ignore selected other globs

    for (
      const walk of walkSync(
        dir,
        {
          includeDirs: false,
          // this was done b/c some directories e.g. renv/packrat and potentially python
          // virtualenvs include symblinks to R or Python libraries that are in turn
          // circular. much safer to not follow symlinks!
          followSymlinks: false,
          skip: [kSkipHidden],
        },
      )
    ) {
      const pathRelative = pathWithForwardSlashes(relative(dir, walk.path));
      if (!projectIgnores.some((regex) => regex.test(pathRelative))) {
        addFile(walk.path);
      }
    }
  };

  const renderFiles = metadata?.project[kProjectRender];
  if (renderFiles) {
    const exclude = projIgnoreGlobs.concat(outputDir ? [outputDir] : []);
    const resolved = resolvePathGlobs(dir, renderFiles, exclude);
    (ld.difference(resolved.include, resolved.exclude) as string[])
      .forEach((file) => {
        if (Deno.statSync(file).isDirectory) {
          addDir(file);
        } else {
          addFile(file);
        }
      });
  } else {
    addDir(dir);
  }

  const inputFiles = ld.difference(
    ld.uniq(files),
    ld.uniq(keepFiles),
  ) as string[];

  return { files: inputFiles, engines };
}

function projectConfigResources(
  dir: string,
  type: ProjectType,
  metadata: Metadata,
) {
  const resourceIgnoreFields = ["project"].concat(
    type.resourceIgnoreFields ? type.resourceIgnoreFields() : [],
  );
  const resources: string[] = [];
  const findResources = (
    collection: Array<unknown> | Record<string, unknown>,
    parentKey?: unknown,
  ) => {
    ld.forEach(
      collection,
      (value: unknown, index: unknown) => {
        if (parentKey === kHtmlMathMethod && index === "method") {
          // don't resolve html-math-method
        } else if (resourceIgnoreFields.includes(index as string)) {
          // project type specific ignore (e.g. site-navbar, site-sidebar)
        } else if (Array.isArray(value)) {
          findResources(value);
        } else if (typeof (value) === "object") {
          findResources(value as Record<string, unknown>, index);
        } else if (typeof (value) === "string") {
          const path = isAbsolute(value) ? value : join(dir, value);
          // Paths could be invalid paths (e.g. with colons or other weird characters)
          try {
            if (existsSync(path) && !Deno.statSync(path).isDirectory) {
              resources.push(Deno.realPathSync(path));
            }
          } catch {
            // Just ignore this error as the path must not be a local file path
          }
        }
      },
    );
  };

  findResources(metadata);
  return resources;
}
