/*
* register.ts
*
* registers available project types for use in quarto.
*
* Copyright (C) 2022-2023 Posit, PBC
*
*/

import { bookProjectType } from "./book/book.ts";
import { defaultProjectType } from "./project-default.ts";
import { websiteProjectType } from "./website/website.ts";
import { registerProjectType } from "./project-types.ts";

registerProjectType(bookProjectType);
registerProjectType(defaultProjectType);
registerProjectType(websiteProjectType);
