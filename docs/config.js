// GENERATED FILE -- do not edit by hand.
// Rendered by py/step_build.py from py/templates/config.js.j2 (main.py's
// "build" step). Source of truth for these constants is
// py/md_generator_utils.py -- edit there, then `python main.py`.
//
// Release 0.1.0.

export const RELEASE = "0.1.0";

// Live-fetched on every page load (PRIMER.md A4: the one deliberate
// exception to "reuse means copying" -- see py/md_generator_utils.py for
// why "master", not a pinned commit).
export const MD_CFF_SCHEMA_URL = "https://raw.githubusercontent.com/FDOx-squirrel/fdo-squirrel/master/schemas/md_cff/MD.cff-schema.yaml";

// Same-origin vendored copies (schemas/, copied into docs/schemas/ by this
// same build step) -- fetched relative to this page, no CORS involved.
export const CITATION_CFF_SCHEMA_PATH = "schemas/citation-cff-schema.json";
export const CLASSIFICATION_RULES_PATH = "schemas/classification_rules.yaml";

// ajv 8 ships no browser UMD bundle any more -- loaded as an ES module via
// jsDelivr's `+esm` endpoint instead (py/md_generator_utils.py has the
// full reasoning). Two separate entry points: MD.cff is draft 2020-12,
// CITATION.cff (vendored, CFF 1.2.0) is draft-07 -- one Ajv class each.
export const AJV_2020_ESM_URL = "https://cdn.jsdelivr.net/npm/ajv@8.20.0/dist/2020.js/+esm";
export const AJV_DRAFT07_ESM_URL = "https://cdn.jsdelivr.net/npm/ajv@8.20.0/dist/ajv.js/+esm";
