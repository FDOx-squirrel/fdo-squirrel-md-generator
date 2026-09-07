"""Shared constants, paths and build helpers for fdo-squirrel-md-generator.

Import this from every step module rather than re-deriving RELEASE or the
path layout twice. See PRIMER.md A3 for the rules this module exists to
enforce.

Unlike the other repos in the family, this repo's "pipeline" builds a
static web page, not a data product -- there is deliberately no
write_canonical_turtle()/write_json() here (no RDF, no JSON output). The
one thing that *is* generated is docs/config.js, a handful of constants
the browser-side app needs, kept here in Python so there is exactly one
place that says which schema URL / library versions are current --
PRIMER.md A4 ("single source of truth", decided 2026-09-07).
"""
from __future__ import annotations

from pathlib import Path

# No datetime.now() anywhere in this repo's generator (PRIMER.md A3). Bump
# this by hand when the shipped page is meant to change.
RELEASE = "0.1.0"

REPO_ROOT = Path(__file__).resolve().parent.parent
SITE = REPO_ROOT / "site"          # hand-authored source of the static app
SCHEMAS = REPO_ROOT / "schemas"    # vendored, stable specs (CFF, classification rules)
DOCS = REPO_ROOT / "docs"          # GitHub Pages root (generated, not a source)

# --------------------------------------------------------------------------
# PRIMER.md A4 (2026-09-07): the MD.cff schema itself is the one deliberate
# exception to "reuse means copying" (PRIMER.md A3) -- it is fetched live,
# client-side, on every page load, from fdo-squirrel's default branch, so
# the generator always validates against whatever fdo-squirrel currently
# ships. Confirmed here (2026-09-07) that "master" is fdo-squirrel's
# default branch -- fdo-3d-packager's own vendored copy of this same file
# cites the identical URL shape (schemas/md_cff/MD.cff-schema.yaml on
# .../blob/master/...). This resolves PRIMER.md Teil D's open branch/tag
# question: branch, not a pinned commit -- matches A2's "immer aktuelles
# Schema" intent. If fdo-squirrel ever renames its default branch this
# constant is the one place to fix.
# --------------------------------------------------------------------------
MD_CFF_SCHEMA_URL = (
    "https://raw.githubusercontent.com/FDOx-squirrel/fdo-squirrel/"
    "master/schemas/md_cff/MD.cff-schema.yaml"
)

# CDN library versions -- every one pinned to an exact version (PRIMER.md
# A4: "kein npm-Bundler nötig" does not mean "no version discipline").
# Verified to exist on npm 2026-09-07 (`npm pack <name>@<version>`) before
# being wired in here -- see PRIMER.md A1 Befund 20 for how each dist
# bundle/global was confirmed.
JS_YAML_VERSION = "4.3.2"
JSZIP_VERSION = "3.10.1"
AJV_VERSION = "8.20.0"
LEAFLET_VERSION = "1.9.4"

JS_YAML_CDN = f"https://cdn.jsdelivr.net/npm/js-yaml@{JS_YAML_VERSION}/dist/js-yaml.min.js"
JSZIP_CDN = f"https://cdn.jsdelivr.net/npm/jszip@{JSZIP_VERSION}/dist/jszip.min.js"
LEAFLET_CSS_CDN = f"https://cdn.jsdelivr.net/npm/leaflet@{LEAFLET_VERSION}/dist/leaflet.css"
LEAFLET_JS_CDN = f"https://cdn.jsdelivr.net/npm/leaflet@{LEAFLET_VERSION}/dist/leaflet.js"
# ajv 8's published npm package ships no browser UMD bundle any more (only
# dist/2020.js as a CommonJS module -- confirmed 2026-09-07 by unpacking
# the actual npm tarball, see PRIMER.md A1 Befund 20b). jsDelivr's `+esm`
# endpoint compiles any npm entry point to a browser-ready ES module on the
# fly; loaded from a `<script type="module">`, which needs no bundler
# either -- still satisfies A4's "kein npm-Bundler nötig". Needs a real
# browser to confirm (PRIMER.md Teil D: browser-verify).
AJV_2020_ESM_CDN = f"https://cdn.jsdelivr.net/npm/ajv@{AJV_VERSION}/dist/2020.js/+esm"
AJV_DRAFT07_ESM_CDN = f"https://cdn.jsdelivr.net/npm/ajv@{AJV_VERSION}/dist/ajv.js/+esm"

# Same-origin vendored copies (PRIMER.md A3 "reuse means copying" -- the
# default rule; MD_CFF_SCHEMA_URL above is the one documented exception).
# Both are small, comparatively stable specs, unlike MD.cff which is still
# moving -- see PRIMER.md A4 for why each one is vendored, not fetched.
CITATION_CFF_SCHEMA_SRC = SCHEMAS / "citation_cff" / "schema.json"
CLASSIFICATION_RULES_SRC = SCHEMAS / "classification_rules.yaml"
CITATION_CFF_SCHEMA_DOCS_PATH = "schemas/citation-cff-schema.json"
CLASSIFICATION_RULES_DOCS_PATH = "schemas/classification_rules.yaml"


def ensure_dirs() -> None:
    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / "schemas").mkdir(parents=True, exist_ok=True)


def write_text(text: str, path: Path) -> None:
    """Deterministic text write: exact bytes in, trailing newline enforced
    once (not doubled if the source already ends in one), no datetime
    anywhere in the pipeline (PRIMER.md A3)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if not text.endswith("\n"):
        text += "\n"
    path.write_text(text, encoding="utf-8")


def copy_verbatim(src: Path, dst: Path) -> None:
    """Byte-identical copy -- used for site/* files that need no templating
    (index.html, app.css, app.js) so the single Python build step still
    owns every file under docs/, per the family's main.py orchestrator
    pattern (PRIMER.md A2), without forcing static content through Jinja2
    for no reason."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(src.read_bytes())
