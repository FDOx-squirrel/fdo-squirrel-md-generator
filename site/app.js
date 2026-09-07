// fdo-squirrel-md-generator — app.js
//
// Runs entirely client-side (PRIMER.md A2). Loaded as a native ES module
// (index.html: <script type="module" src="app.js">) so `ajv` -- which
// ships no browser UMD bundle any more -- can be pulled in as an ES
// module via jsDelivr's `+esm` endpoint without a bundler
// (py/md_generator_utils.py has the full reasoning). js-yaml, JSZip and
// Leaflet ARE still classic <script> globals (window.jsyaml/JSZip/L),
// loaded before this module in index.html -- both approaches coexist
// fine, classic scripts execute before a module script ever runs.
//
// State shape lives in emptyState() below and mirrors MD.cff-schema.yaml
// closely but not exactly: spatial/temporal store their bounding-box and
// range fields as separate scalars (bbox_w/s/e/n, range_a/range_b) for
// easy two-way binding to four/two separate inputs and the map; these get
// composed back into the schema's actual shapes (a single bounding_box
// string, a range array) only in buildCleanObject(), right before
// validation/export. Nothing else about the schema shape is reinterpreted.

import {
  RELEASE, MD_CFF_SCHEMA_URL, CITATION_CFF_SCHEMA_PATH,
  CLASSIFICATION_RULES_PATH, AJV_2020_ESM_URL, AJV_DRAFT07_ESM_URL,
  LEAFLET_IMAGES_BASE_URL,
} from './config.js';

const yamlLib = window.jsyaml;
const JSZipLib = window.JSZip;

console.info(`fdo-squirrel-md-generator ${RELEASE}`);

// Leaflet's own auto-detection of its default marker icon images (scanning
// loaded stylesheets for "leaflet.css") is unreliable via CDN in practice
// -- pin explicitly instead of debugging the heuristic (feedback
// 2026-09-07: markers rendered invisible). IMPORTANT: Icon.Default's own
// _getIconUrl ALWAYS prepends `imagePath` in front of iconUrl/
// iconRetinaUrl/shadowUrl (they're meant to be bare filenames, e.g. its
// own default 'marker-icon.png') -- setting those three to already-full
// URLs, as a first attempt here did, makes Leaflet concatenate its
// detected base path with a second full URL, producing a malformed
// request (confirmed in the browser console, 2026-09-07). Setting only
// `imagePath` and leaving the three *Url options at Leaflet's own
// (correct, relative) defaults is the actual fix.
if (window.L) {
  window.L.Icon.Default.mergeOptions({ imagePath: `${LEAFLET_IMAGES_BASE_URL}/` });
}

const ENUMS = {
  fdoType: ['fdo:SoftwareFDO', 'fdo:AnalysisFDO', 'fdo:3DDataFDO', 'fdo:RegistryFDO'],
  identifierScheme: ['doi', 'url', 'orcid', 'ror', 'handle', 'ark', 'isbn', 'issn', 'swhid', 'other'],
  relatedRelation: ['isSupplementTo', 'isReferencedBy', 'references', 'isPartOf', 'hasPart', 'isDerivedFrom', 'isDocumentedBy'],
};

const AUTOSAVE_KEY = 'fdo-squirrel-md-generator:draft:v1';

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------

function newEntity() { return { label: '', id: '' }; }

function newSpatial() {
  return { label: '', id: '', wkt: '', lat: null, lon: null, bbox_w: null, bbox_s: null, bbox_e: null, bbox_n: null };
}

function newTemporal() {
  return { label: '', id: '', start: null, end: null, range_a: null, range_b: null };
}

function newHeritage() {
  return {
    object_type: newEntity(), monument: newEntity(), material: newEntity(),
    context: '', documentation_purpose: '', overall_condition: '', conservation_urgency: '',
  };
}

function newTechnique() {
  return {
    acq_method: '', acq_hardware: '', acq_images_count: '', processing: '',
    programming_languages: [], repo_type: '', repo_url: '', repo_status: '',
  };
}

function emptyState() {
  return {
    md_cff_version: '0.1', fdo_type: '', id: '', title: '', description: '',
    version: '', date_created: '', date_released: '', date_modified: [], funding: [],
    publishers: [], creators: [], contributors: [], license: null, keywords: [],
    identifiers: [], related_resources: [],
    spatial: null, temporal: null, heritage_object: null, technique: null,
  };
}

let state = emptyState();

let mdSchema = null, mdValidator = null;
let cffSchema = null, cffValidator = null;
let classificationRules = null;

let map = null, marker = null, rectangle = null;
let markerDrawArmed = false;
let bboxDrawArmed = false, bboxDragStart = null, bboxPreviewRect = null;

let validateTimer = null;
let autosaveTimer = null;

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str == null ? '' : str); }

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function trimmedOrNull(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function ensureSpatial() { if (!state.spatial) state.spatial = newSpatial(); return state.spatial; }
function ensureTemporal() { if (!state.temporal) state.temporal = newTemporal(); return state.temporal; }
function ensureHeritage() { if (!state.heritage_object) state.heritage_object = newHeritage(); return state.heritage_object; }
function ensureTechnique() { if (!state.technique) state.technique = newTechnique(); return state.technique; }

function parseBboxString(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.split(',').map(Number);
  return parts.length === 4 && parts.every(n => !Number.isNaN(n)) ? parts : null;
}

function looksLikeSpdx(v) {
  return !!v && /^[A-Za-z][A-Za-z0-9]*([.+-][A-Za-z0-9]+)*$/.test(v) && !v.toUpperCase().startsWith('TODO');
}

// Shorthand recognition for `id` fields throughout the form: a bare
// Wikidata QID or an OSM "node/way/relation/<id>" reference is expanded
// into its full URI, but ONLY at export time (in clean*() below) -- the
// form field itself always keeps showing exactly what was typed/loaded
// (feedback 2026-09-07: the earlier version rewrote the visible input on
// blur, which was unwanted -- the short form should stay visible, only
// the exported file should carry the long form). shortenEntityId() is the
// reverse, used wherever a stored `id` gets rendered into an input, so a
// loaded MD.cff's full Wikidata/OSM URL also displays as the short form.
function normalizeEntityId(raw) {
  const v = (raw || '').trim();
  if (!v) return v;
  // http (not https), and Wikidata's canonical Linked-Data entity
  // namespace (/entity/, not the human-readable /wiki/ page) -- feedback
  // 2026-09-07: matches the URI form already used elsewhere in the
  // family's data, and is the actual RDF resource URI (the `wd:` prefix
  // in Wikidata's own ontology is http://www.wikidata.org/entity/).
  // These are never fetched by this page (just written into the YAML),
  // so http vs. https here has no mixed-content implication, unlike the
  // CDN/tile/schema URLs elsewhere, which must stay https.
  if (/^Q[1-9]\d*$/.test(v)) return `http://www.wikidata.org/entity/${v}`;
  const osm = v.match(/^(node|way|relation)\/(\d+)$/i);
  if (osm) return `http://www.openstreetmap.org/${osm[1].toLowerCase()}/${osm[2]}`;
  return v;
}

function shortenEntityId(raw) {
  const v = (raw || '').trim();
  if (!v) return v;
  const wd = v.match(/^https?:\/\/(?:www\.)?wikidata\.org\/(?:wiki|entity)\/(Q[1-9]\d*)/i);
  if (wd) return wd[1];
  const osm = v.match(/^https?:\/\/(?:www\.)?openstreetmap\.org\/(node|way|relation)\/(\d+)/i);
  if (osm) return `${osm[1].toLowerCase()}/${osm[2]}`;
  return v;
}

// Parses a Wikidata/OSM reference (short or full-URL form) into a
// structured {kind, id} / {kind, type, id} for the coordinate-lookup
// feature below -- separate from the two functions above because it needs
// to recover the *type* (node/way/relation), not just produce a string.
function parseWikidataOrOsmRef(raw) {
  const v = (raw || '').trim();
  if (!v) return null;
  let m = v.match(/^Q([1-9]\d*)$/) || v.match(/^https?:\/\/(?:www\.)?wikidata\.org\/(?:wiki|entity)\/Q([1-9]\d*)/i);
  if (m) return { kind: 'wikidata', id: `Q${m[1]}` };
  m = v.match(/^(node|way|relation)\/(\d+)$/i) || v.match(/^https?:\/\/(?:www\.)?openstreetmap\.org\/(node|way|relation)\/(\d+)/i);
  if (m) return { kind: 'osm', type: m[1].toLowerCase(), id: m[2] };
  return null;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeDump(obj) {
  try {
    return yamlLib.dump(obj, { noRefs: true, lineWidth: 100, sortKeys: false });
  } catch (err) {
    console.error('YAML dump failed:', err, obj);
    return `# could not render preview: ${err.message}`;
  }
}

// ---------------------------------------------------------------------
// state -> schema-shaped object (only non-empty optional fields survive;
// required fields always emitted, even empty, so Ajv reports the real
// "required"/"minItems" error instead of this code guessing one)
// ---------------------------------------------------------------------

function cleanEntity(e) {
  if (!e) return null;
  const label = trimmedOrNull(e.label);
  if (!label) return null;
  const out = { label };
  const id = trimmedOrNull(e.id);
  if (id) out.id = normalizeEntityId(id);
  return out;
}

function cleanEntityListRequired(arr) {
  return (arr || []).map(cleanEntity).filter(Boolean);
}

function cleanEntityListOptional(arr) {
  const cleaned = (arr || []).map(cleanEntity).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
}

function cleanStringListOptional(arr) {
  const cleaned = (arr || []).map(v => trimmedOrNull(v)).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
}

function cleanSpatial(s) {
  if (!s) return null;
  const label = trimmedOrNull(s.label);
  if (!label) return null; // required if the block is present at all
  const out = { label };
  const id = trimmedOrNull(s.id); if (id) out.id = normalizeEntityId(id);
  const wkt = trimmedOrNull(s.wkt); if (wkt) out.wkt = wkt;
  if (s.lat != null && !Number.isNaN(s.lat)) out.lat = s.lat;
  if (s.lon != null && !Number.isNaN(s.lon)) out.lon = s.lon;
  const parts = [s.bbox_w, s.bbox_s, s.bbox_e, s.bbox_n];
  if (parts.every(p => p != null && !Number.isNaN(p))) out.bounding_box = parts.join(',');
  return out;
}

function cleanTemporal(t) {
  if (!t) return null;
  const label = trimmedOrNull(t.label);
  if (!label) return null;
  const out = { label };
  const id = trimmedOrNull(t.id); if (id) out.id = normalizeEntityId(id);
  if (t.start != null && !Number.isNaN(t.start)) out.start = t.start;
  if (t.end != null && !Number.isNaN(t.end)) out.end = t.end;
  if (t.range_a != null && t.range_b != null && !Number.isNaN(t.range_a) && !Number.isNaN(t.range_b)) {
    out.range = [t.range_a, t.range_b];
  }
  return out;
}

function cleanHeritage(h) {
  if (!h) return null;
  const out = {};
  const objectType = cleanEntity(h.object_type); if (objectType) out.object_type = objectType;
  const monument = cleanEntity(h.monument); if (monument) out.monument = monument;
  const material = cleanEntity(h.material); if (material) out.material = material;
  const context = trimmedOrNull(h.context); if (context) out.context = context;
  const purpose = trimmedOrNull(h.documentation_purpose); if (purpose) out.documentation_purpose = purpose;
  const condition = trimmedOrNull(h.overall_condition); if (condition) out.overall_condition = condition;
  const urgency = trimmedOrNull(h.conservation_urgency); if (urgency) out.conservation_urgency = urgency;
  return Object.keys(out).length ? out : null;
}

function cleanTechnique(t) {
  if (!t) return null;
  const out = {};
  const acquisition = {};
  const method = trimmedOrNull(t.acq_method); if (method) acquisition.method = method;
  const hardware = trimmedOrNull(t.acq_hardware); if (hardware) acquisition.hardware = hardware;
  const images = trimmedOrNull(t.acq_images_count); if (images) acquisition.images_count = images;
  if (Object.keys(acquisition).length) out.acquisition = acquisition;

  const processing = trimmedOrNull(t.processing); if (processing) out.processing = processing;
  const langs = cleanStringListOptional(t.programming_languages); if (langs) out.programming_languages = langs;

  const repository = {};
  const rtype = trimmedOrNull(t.repo_type); if (rtype) repository.type = rtype;
  const rurl = trimmedOrNull(t.repo_url); if (rurl) repository.url = rurl;
  const rstatus = trimmedOrNull(t.repo_status); if (rstatus) repository.development_status = rstatus;
  if (Object.keys(repository).length) out.repository = repository;

  return Object.keys(out).length ? out : null;
}

function buildCleanObject() {
  const out = {};
  out.md_cff_version = '0.1';
  out.fdo_type = state.fdo_type || '';
  out.id = state.id || '';
  out.title = state.title || '';
  out.description = state.description || '';

  const version = trimmedOrNull(state.version); if (version) out.version = version;
  const dc = trimmedOrNull(state.date_created); if (dc) out.date_created = dc;
  const dr = trimmedOrNull(state.date_released); if (dr) out.date_released = dr;
  const dm = cleanStringListOptional(state.date_modified); if (dm) out.date_modified = dm;

  out.publishers = cleanEntityListRequired(state.publishers);
  const creators = cleanEntityListOptional(state.creators); if (creators) out.creators = creators;
  const contributors = cleanEntityListOptional(state.contributors); if (contributors) out.contributors = contributors;
  const license = cleanEntity(state.license); if (license) out.license = license;
  const keywords = cleanEntityListOptional(state.keywords); if (keywords) out.keywords = keywords;

  const identifiers = (state.identifiers || [])
    .filter(i => trimmedOrNull(i.scheme) || trimmedOrNull(i.value))
    .map(i => {
      const o = { scheme: i.scheme || '', value: i.value || '' };
      const label = trimmedOrNull(i.label); if (label) o.label = label;
      return o;
    });
  if (identifiers.length) out.identifiers = identifiers;

  const related = (state.related_resources || [])
    .filter(r => trimmedOrNull(r.relation) || (r.target && trimmedOrNull(r.target.label)))
    .map(r => {
      const o = { relation: r.relation || '', target: cleanEntity(r.target) || { label: '' } };
      const note = trimmedOrNull(r.note); if (note) o.note = note;
      return o;
    });
  if (related.length) out.related_resources = related;

  const funding = cleanStringListOptional(state.funding); if (funding) out.funding = funding;

  const spatial = cleanSpatial(state.spatial); if (spatial) out.spatial = spatial;
  const temporal = cleanTemporal(state.temporal); if (temporal) out.temporal = temporal;
  const heritage = cleanHeritage(state.heritage_object); if (heritage) out.heritage_object = heritage;
  const technique = cleanTechnique(state.technique); if (technique) out.technique = technique;

  return out;
}

// ---------------------------------------------------------------------
// Repeatable-row widgets
// ---------------------------------------------------------------------

function renderEntityList(key) {
  const container = document.querySelector(`.entity-list[data-key="${key}"]`);
  if (!container) return;
  const arr = state[key] || [];
  container.innerHTML = '';
  arr.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'entity-row';
    row.innerHTML = `
      <input type="text" placeholder="label" value="${escapeAttr(item.label)}">
      <input type="text" placeholder="id (URI, optional)" value="${escapeAttr(shortenEntityId(item.id))}">
      <button type="button" class="row-remove" aria-label="remove">✕</button>`;
    const [labelInput, idInput] = row.querySelectorAll('input');
    labelInput.addEventListener('input', () => { item.label = labelInput.value; scheduleValidate(); scheduleAutosave(); });
    idInput.addEventListener('input', () => { item.id = idInput.value; scheduleValidate(); scheduleAutosave(); });
    row.querySelector('.row-remove').addEventListener('click', () => {
      arr.splice(i, 1); renderEntityList(key); scheduleValidate(); scheduleAutosave();
    });
    container.appendChild(row);
  });
}

function renderEntitySingle(key) {
  const container = document.querySelector(`.entity-single[data-key="${key}"]`);
  if (!container) return;
  const parts = key.split('.');
  const leafKey = parts.pop();
  const parentPath = parts.join('.');
  const parent = parentPath ? getPath(state, parentPath) : state;
  if (!parent) { container.innerHTML = ''; return; }
  if (!parent[leafKey]) parent[leafKey] = newEntity();
  const item = parent[leafKey];
  container.innerHTML = `
    <div class="entity-row">
      <input type="text" placeholder="label" value="${escapeAttr(item.label)}">
      <input type="text" placeholder="id (URI, optional)" value="${escapeAttr(shortenEntityId(item.id))}">
      <button type="button" class="row-remove" aria-label="clear">clear</button>
    </div>`;
  const [labelInput, idInput] = container.querySelectorAll('input');
  labelInput.addEventListener('input', () => { item.label = labelInput.value; scheduleValidate(); scheduleAutosave(); });
  idInput.addEventListener('input', () => { item.id = idInput.value; scheduleValidate(); scheduleAutosave(); });
  container.querySelector('.row-remove').addEventListener('click', () => {
    item.label = ''; item.id = ''; labelInput.value = ''; idInput.value = '';
    scheduleValidate(); scheduleAutosave();
  });
}

function renderStringList(key) {
  const container = document.querySelector(`.string-list[data-key="${key}"]`);
  if (!container) return;
  const itemType = container.dataset.itemType || 'text';
  const arr = getPath(state, key);
  container.innerHTML = '';
  if (!arr) return;
  arr.forEach((val, i) => {
    const row = document.createElement('div');
    row.className = 'string-row';
    const inputType = itemType === 'date' ? 'date' : 'text';
    row.innerHTML = `
      <input type="${inputType}" value="${escapeAttr(val)}">
      <button type="button" class="row-remove" aria-label="remove">✕</button>`;
    const input = row.querySelector('input');
    input.addEventListener('input', () => { arr[i] = input.value; scheduleValidate(); scheduleAutosave(); });
    row.querySelector('.row-remove').addEventListener('click', () => {
      arr.splice(i, 1); renderStringList(key); scheduleValidate(); scheduleAutosave();
    });
    container.appendChild(row);
  });
}

function renderIdentifierList() {
  const container = document.querySelector('.identifier-list[data-key="identifiers"]');
  const arr = state.identifiers;
  container.innerHTML = '';
  arr.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'identifier-row';
    const options = ENUMS.identifierScheme.map(s => `<option value="${s}" ${item.scheme === s ? 'selected' : ''}>${s}</option>`).join('');
    row.innerHTML = `
      <select aria-label="scheme"><option value="" disabled ${!item.scheme ? 'selected' : ''}>scheme…</option>${options}</select>
      <input type="text" placeholder="value" value="${escapeAttr(item.value)}">
      <input type="text" placeholder="label (optional)" value="${escapeAttr(item.label || '')}">
      <button type="button" class="row-remove" aria-label="remove">✕</button>`;
    const select = row.querySelector('select');
    const [valueInput, labelInput] = row.querySelectorAll('input');
    select.addEventListener('change', () => { item.scheme = select.value; scheduleValidate(); scheduleAutosave(); });
    valueInput.addEventListener('input', () => { item.value = valueInput.value; scheduleValidate(); scheduleAutosave(); });
    labelInput.addEventListener('input', () => { item.label = labelInput.value; scheduleValidate(); scheduleAutosave(); });
    row.querySelector('.row-remove').addEventListener('click', () => {
      arr.splice(i, 1); renderIdentifierList(); scheduleValidate(); scheduleAutosave();
    });
    container.appendChild(row);
  });
}

function renderRelatedList() {
  const container = document.querySelector('.related-list[data-key="related_resources"]');
  const arr = state.related_resources;
  container.innerHTML = '';
  arr.forEach((item, i) => {
    if (!item.target) item.target = newEntity();
    const row = document.createElement('div');
    row.className = 'related-row';
    const options = ENUMS.relatedRelation.map(r => `<option value="${r}" ${item.relation === r ? 'selected' : ''}>${r}</option>`).join('');
    row.innerHTML = `
      <select aria-label="relation"><option value="" disabled ${!item.relation ? 'selected' : ''}>relation…</option>${options}</select>
      <input type="text" placeholder="target label" value="${escapeAttr(item.target.label)}">
      <input type="text" placeholder="target id (optional)" value="${escapeAttr(shortenEntityId(item.target.id))}">
      <input type="text" placeholder="note (optional)" value="${escapeAttr(item.note || '')}">
      <button type="button" class="row-remove" aria-label="remove">✕</button>`;
    const select = row.querySelector('select');
    const [targetLabel, targetId, note] = row.querySelectorAll('input');
    select.addEventListener('change', () => { item.relation = select.value; scheduleValidate(); scheduleAutosave(); });
    targetLabel.addEventListener('input', () => { item.target.label = targetLabel.value; scheduleValidate(); scheduleAutosave(); });
    targetId.addEventListener('input', () => { item.target.id = targetId.value; scheduleValidate(); scheduleAutosave(); });
    note.addEventListener('input', () => { item.note = note.value; scheduleValidate(); scheduleAutosave(); });
    row.querySelector('.row-remove').addEventListener('click', () => {
      arr.splice(i, 1); renderRelatedList(); scheduleValidate(); scheduleAutosave();
    });
    container.appendChild(row);
  });
}

function renderAllLists() {
  ['publishers', 'creators', 'contributors', 'keywords'].forEach(renderEntityList);
  renderEntitySingle('license');
  renderEntitySingle('heritage_object.object_type');
  renderEntitySingle('heritage_object.monument');
  renderEntitySingle('heritage_object.material');
  renderStringList('date_modified');
  renderStringList('funding');
  renderStringList('technique.programming_languages');
  renderIdentifierList();
  renderRelatedList();
}

// ---------------------------------------------------------------------
// Full-form (re)render from state — used after a file load / draft restore
// ---------------------------------------------------------------------

function renderCoreFormFromState() {
  document.getElementById('field-fdo_type').value = state.fdo_type || '';
  document.getElementById('field-id').value = state.id || '';
  document.getElementById('field-title').value = state.title || '';
  document.getElementById('field-description').value = state.description || '';
  document.getElementById('field-version').value = state.version || '';
  document.getElementById('field-date_created').value = state.date_created || '';
  document.getElementById('field-date_released').value = state.date_released || '';
  toggleCitationBlock();
}

function renderSpatialFormFromState() {
  const s = state.spatial || newSpatial();
  document.getElementById('field-spatial-label').value = s.label || '';
  document.getElementById('field-spatial-id').value = shortenEntityId(s.id) || '';
  document.getElementById('field-spatial-wkt').value = s.wkt || '';
  document.getElementById('field-spatial-lat').value = s.lat ?? '';
  document.getElementById('field-spatial-lon').value = s.lon ?? '';
  document.getElementById('field-spatial-bbox-w').value = s.bbox_w ?? '';
  document.getElementById('field-spatial-bbox-s').value = s.bbox_s ?? '';
  document.getElementById('field-spatial-bbox-e').value = s.bbox_e ?? '';
  document.getElementById('field-spatial-bbox-n').value = s.bbox_n ?? '';
  syncMapMarker();
  syncMapRectangle();
}

function renderTemporalFormFromState() {
  const t = state.temporal || newTemporal();
  document.getElementById('field-temporal-label').value = t.label || '';
  document.getElementById('field-temporal-id').value = shortenEntityId(t.id) || '';
  document.getElementById('field-temporal-start').value = t.start ?? '';
  document.getElementById('field-temporal-end').value = t.end ?? '';
  document.getElementById('field-temporal-range-a').value = t.range_a ?? '';
  document.getElementById('field-temporal-range-b').value = t.range_b ?? '';
}

function renderHeritageFormFromState() {
  const h = state.heritage_object || newHeritage();
  document.getElementById('field-heritage-context').value = h.context || '';
  document.getElementById('field-heritage-purpose').value = h.documentation_purpose || '';
  document.getElementById('field-heritage-condition').value = h.overall_condition || '';
  document.getElementById('field-heritage-urgency').value = h.conservation_urgency || '';
}

function renderTechniqueFormFromState() {
  const t = state.technique || newTechnique();
  document.getElementById('field-tech-acq-method').value = t.acq_method || '';
  document.getElementById('field-tech-acq-hardware').value = t.acq_hardware || '';
  document.getElementById('field-tech-acq-images').value = t.acq_images_count || '';
  document.getElementById('field-tech-processing').value = t.processing || '';
  document.getElementById('field-tech-repo-type').value = t.repo_type || '';
  document.getElementById('field-tech-repo-url').value = t.repo_url || '';
  document.getElementById('field-tech-repo-status').value = t.repo_status || '';
}

function renderFullForm() {
  renderCoreFormFromState();
  renderAllLists();

  const spatialOn = !!state.spatial;
  document.getElementById('toggle-spatial').checked = spatialOn;
  document.getElementById('spatial-fields').hidden = !spatialOn;
  if (spatialOn) { renderSpatialFormFromState(); initMapIfNeeded(); }

  const temporalOn = !!state.temporal;
  document.getElementById('toggle-temporal').checked = temporalOn;
  document.getElementById('temporal-fields').hidden = !temporalOn;
  if (temporalOn) renderTemporalFormFromState();

  const heritageOn = !!state.heritage_object;
  document.getElementById('toggle-heritage').checked = heritageOn;
  document.getElementById('heritage-fields').hidden = !heritageOn;
  if (heritageOn) {
    renderHeritageFormFromState();
    renderEntitySingle('heritage_object.object_type');
    renderEntitySingle('heritage_object.monument');
    renderEntitySingle('heritage_object.material');
  }

  const techOn = !!state.technique;
  document.getElementById('toggle-technique').checked = techOn;
  document.getElementById('technique-fields').hidden = !techOn;
  if (techOn) { renderTechniqueFormFromState(); renderStringList('technique.programming_languages'); }
}

// ---------------------------------------------------------------------
// Wiring: static fields
// ---------------------------------------------------------------------

function wireStaticFieldListeners() {
  const fdoTypeEl = document.getElementById('field-fdo_type');
  fdoTypeEl.addEventListener('change', () => {
    state.fdo_type = fdoTypeEl.value;
    toggleCitationBlock();
    scheduleValidate(); scheduleAutosave();
  });
  const simple = [
    ['field-id', 'id'], ['field-title', 'title'], ['field-description', 'description'],
    ['field-version', 'version'], ['field-date_created', 'date_created'], ['field-date_released', 'date_released'],
  ];
  simple.forEach(([id, prop]) => {
    document.getElementById(id).addEventListener('input', (e) => {
      state[prop] = e.target.value;
      scheduleValidate(); scheduleAutosave();
    });
  });
}

function wireSpatialFields() {
  const textMap = [['field-spatial-label', 'label'], ['field-spatial-id', 'id'], ['field-spatial-wkt', 'wkt']];
  textMap.forEach(([id, prop]) => {
    document.getElementById(id).addEventListener('input', (e) => {
      ensureSpatial()[prop] = e.target.value;
      scheduleValidate(); scheduleAutosave();
    });
  });

  const latEl = document.getElementById('field-spatial-lat');
  const lonEl = document.getElementById('field-spatial-lon');
  latEl.addEventListener('input', () => { ensureSpatial().lat = numOrNull(latEl.value); syncMapMarker(); scheduleValidate(); scheduleAutosave(); });
  lonEl.addEventListener('input', () => { ensureSpatial().lon = numOrNull(lonEl.value); syncMapMarker(); scheduleValidate(); scheduleAutosave(); });

  ['w', 's', 'e', 'n'].forEach(dir => {
    const el = document.getElementById(`field-spatial-bbox-${dir}`);
    el.addEventListener('input', () => {
      ensureSpatial()[`bbox_${dir}`] = numOrNull(el.value);
      syncMapRectangle(); scheduleValidate(); scheduleAutosave();
    });
  });

  document.getElementById('marker-draw-toggle').addEventListener('click', () => {
    if (markerDrawArmed) disarmMarkerDraw(); else armMarkerDraw();
  });
  document.getElementById('marker-clear').addEventListener('click', () => {
    clearMapPoint();
    scheduleValidate(); scheduleAutosave();
  });
  document.getElementById('bbox-draw-toggle').addEventListener('click', () => {
    if (bboxDrawArmed) disarmBboxDraw(); else armBboxDraw();
  });
  document.getElementById('bbox-clear').addEventListener('click', () => {
    clearMapBbox();
    scheduleValidate(); scheduleAutosave();
  });

  document.getElementById('spatial-id-lookup').addEventListener('click', lookupSpatialCoordinates);
}

// Wikidata (P625, "coordinate location") and OpenStreetMap (via Nominatim,
// which resolves a node/way/relation id to a point + bounding box) both
// have free, key-less, CORS-enabled lookup APIs -- feedback 2026-09-07:
// "could entering a QID/OSM reference extract the coordinate automatically?"
// Deliberately a manual button, not automatic-on-blur: a network request
// on every keystroke/blur while someone is still typing an id would be
// both wasteful and a surprise, given this page otherwise only contacts
// the network for things the person explicitly asked for.
// A request-sequencing token: if the identifier is changed and looked up
// again before the first lookup's response arrives, the two fetches can
// resolve in either order. Without this guard, an in-flight first
// response arriving *after* a second, newer one would silently overwrite
// the newer (correct) result with the stale one -- feedback 2026-09-07
// ("replacing the identifier and querying again keeps the previous
// result"). Every call gets its own token; a response is only applied if
// no newer lookup has started since.
let coordLookupToken = 0;

// Wikidata's P1332/P1333/P1334/P1335 ("coordinates of the north-/south-/
// east-/west-most point") together describe an item's extent as a
// bounding box, separately from P625's single point -- feedback
// 2026-09-07. Each is a coordinate-shaped claim just like P625; only the
// relevant axis of each is used. Returns null unless all four are present
// -- a partial box would be silently wrong, not just incomplete.
function extractWikidataBbox(entity) {
  const at = (prop) => {
    const claim = entity && entity.claims && entity.claims[prop] && entity.claims[prop][0];
    return claim && claim.mainsnak && claim.mainsnak.datavalue && claim.mainsnak.datavalue.value;
  };
  const north = at('P1332'), south = at('P1333'), east = at('P1334'), west = at('P1335');
  if (!(north && south && east && west)) return null;
  return { n: north.latitude, s: south.latitude, e: east.longitude, w: west.longitude };
}

async function lookupSpatialCoordinates() {
  const myToken = ++coordLookupToken;
  const idEl = document.getElementById('field-spatial-id');
  const statusEl = document.getElementById('spatial-id-lookup-status');
  const ref = parseWikidataOrOsmRef(idEl.value);
  if (!ref) {
    statusEl.textContent = 'Not a recognized Wikidata Q-id or OpenStreetMap node/way/relation reference.';
    statusEl.className = 'hint warn-item';
    return;
  }
  statusEl.textContent = 'Looking up…';
  statusEl.className = 'hint muted';
  try {
    if (ref.kind === 'wikidata') {
      const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ref.id}&props=claims&format=json&origin=*`;
      const res = await fetch(url, { cache: 'no-store' });
      if (myToken !== coordLookupToken) return; // superseded by a newer lookup, discard
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (myToken !== coordLookupToken) return;
      const entity = data.entities && data.entities[ref.id];
      const claim = entity && entity.claims && entity.claims.P625 && entity.claims.P625[0];
      const coord = claim && claim.mainsnak && claim.mainsnak.datavalue && claim.mainsnak.datavalue.value;
      if (!coord) throw new Error(`${ref.id} has no coordinate location (P625) on Wikidata.`);
      ensureSpatial();
      state.spatial.lat = coord.latitude;
      state.spatial.lon = coord.longitude;
      document.getElementById('field-spatial-lat').value = coord.latitude.toFixed(6);
      document.getElementById('field-spatial-lon').value = coord.longitude.toFixed(6);
      // Some (mostly larger/administrative) Wikidata items also carry an
      // extent via P1332-P1335 (coordinates of the north/south/east/west-
      // most point) -- feedback 2026-09-07 ("from wikidata you might also
      // get a bbox"). Use it when all four are present, otherwise this
      // lookup is point-only and should replace any earlier bbox, not
      // leave it stale (same "clear the other one" reasoning as the
      // map-drawing actions above).
      const bbox = extractWikidataBbox(entity);
      let bboxNote = '';
      if (bbox) {
        state.spatial.bbox_w = bbox.w; state.spatial.bbox_s = bbox.s; state.spatial.bbox_e = bbox.e; state.spatial.bbox_n = bbox.n;
        document.getElementById('field-spatial-bbox-w').value = bbox.w.toFixed(6);
        document.getElementById('field-spatial-bbox-s').value = bbox.s.toFixed(6);
        document.getElementById('field-spatial-bbox-e').value = bbox.e.toFixed(6);
        document.getElementById('field-spatial-bbox-n').value = bbox.n.toFixed(6);
        syncMapRectangle();
        bboxNote = ' and bounding box (P1332–P1335)';
      } else {
        clearMapBbox();
      }
      syncMapMarker();
      statusEl.textContent = `Set from Wikidata ${ref.id} (P625 coordinate location${bboxNote}).`;
      statusEl.className = 'hint ok-item';
    } else {
      const prefix = { node: 'N', way: 'W', relation: 'R' }[ref.type];
      const url = `https://nominatim.openstreetmap.org/lookup?osm_ids=${prefix}${ref.id}&format=jsonv2`;
      const res = await fetch(url, { cache: 'no-store' });
      if (myToken !== coordLookupToken) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const results = await res.json();
      if (myToken !== coordLookupToken) return;
      const hit = results && results[0];
      if (!hit) throw new Error(`OpenStreetMap ${ref.type}/${ref.id} not found via Nominatim.`);
      ensureSpatial();
      state.spatial.lat = Number(hit.lat);
      state.spatial.lon = Number(hit.lon);
      document.getElementById('field-spatial-lat').value = state.spatial.lat.toFixed(6);
      document.getElementById('field-spatial-lon').value = state.spatial.lon.toFixed(6);
      let bboxNote = '';
      if (Array.isArray(hit.boundingbox) && hit.boundingbox.length === 4) {
        const [s, n, w, e] = hit.boundingbox.map(Number);
        state.spatial.bbox_w = w; state.spatial.bbox_s = s; state.spatial.bbox_e = e; state.spatial.bbox_n = n;
        document.getElementById('field-spatial-bbox-w').value = w.toFixed(6);
        document.getElementById('field-spatial-bbox-s').value = s.toFixed(6);
        document.getElementById('field-spatial-bbox-e').value = e.toFixed(6);
        document.getElementById('field-spatial-bbox-n').value = n.toFixed(6);
        syncMapRectangle();
        bboxNote = ' and bounding box';
      } else {
        clearMapBbox();
      }
      syncMapMarker();
      statusEl.textContent = `Set from OpenStreetMap ${ref.type}/${ref.id} (Nominatim) — point${bboxNote}.`;
      statusEl.className = 'hint ok-item';
    }
    scheduleValidate(); scheduleAutosave();
  } catch (err) {
    if (myToken !== coordLookupToken) return; // a newer lookup is already in flight/done, don't show this one's error over it
    statusEl.textContent = `Lookup failed: ${err.message}`;
    statusEl.className = 'hint warn-item';
  }
}

function wireTemporalFields() {
  const map_ = [
    ['field-temporal-label', 'label', v => v], ['field-temporal-id', 'id', v => v],
    ['field-temporal-start', 'start', numOrNull], ['field-temporal-end', 'end', numOrNull],
    ['field-temporal-range-a', 'range_a', numOrNull], ['field-temporal-range-b', 'range_b', numOrNull],
  ];
  map_.forEach(([id, prop, transform]) => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => { ensureTemporal()[prop] = transform(el.value); scheduleValidate(); scheduleAutosave(); });
  });
}

function wireHeritageFields() {
  const map_ = [
    ['field-heritage-context', 'context'], ['field-heritage-purpose', 'documentation_purpose'],
    ['field-heritage-condition', 'overall_condition'], ['field-heritage-urgency', 'conservation_urgency'],
  ];
  map_.forEach(([id, prop]) => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => { ensureHeritage()[prop] = el.value; scheduleValidate(); scheduleAutosave(); });
  });
}

function wireTechniqueFields() {
  const map_ = [
    ['field-tech-acq-method', 'acq_method'], ['field-tech-acq-hardware', 'acq_hardware'],
    ['field-tech-acq-images', 'acq_images_count'], ['field-tech-processing', 'processing'],
    ['field-tech-repo-type', 'repo_type'], ['field-tech-repo-url', 'repo_url'], ['field-tech-repo-status', 'repo_status'],
  ];
  map_.forEach(([id, prop]) => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => { ensureTechnique()[prop] = el.value; scheduleValidate(); scheduleAutosave(); });
  });
}

function wireListAddButtons() {
  document.querySelectorAll('.add-btn[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.add;
      if (key === 'identifiers') {
        state.identifiers.push({ scheme: '', value: '', label: '' });
        renderIdentifierList();
      } else if (key === 'related_resources') {
        state.related_resources.push({ relation: '', target: newEntity(), note: '' });
        renderRelatedList();
      } else if (key === 'date_modified' || key === 'funding' || key === 'technique.programming_languages') {
        const arr = getPath(state, key);
        if (arr) { arr.push(''); renderStringList(key); }
      } else {
        state[key].push(newEntity());
        renderEntityList(key);
      }
      scheduleValidate(); scheduleAutosave();
    });
  });
}

function wireToggle(checkboxId, panelId, onToggle) {
  const checkbox = document.getElementById(checkboxId);
  const panel = document.getElementById(panelId);
  checkbox.addEventListener('change', () => {
    panel.hidden = !checkbox.checked;
    onToggle(checkbox.checked);
    scheduleValidate(); scheduleAutosave();
  });
}

function wireToggles() {
  wireToggle('toggle-spatial', 'spatial-fields', on => {
    if (on) { if (!state.spatial) state.spatial = newSpatial(); renderSpatialFormFromState(); initMapIfNeeded(); }
    else { state.spatial = null; disarmBboxDraw(); disarmMarkerDraw(); }
  });
  wireToggle('toggle-temporal', 'temporal-fields', on => {
    if (on) { if (!state.temporal) state.temporal = newTemporal(); renderTemporalFormFromState(); }
    else { state.temporal = null; }
  });
  wireToggle('toggle-heritage', 'heritage-fields', on => {
    if (on) {
      if (!state.heritage_object) state.heritage_object = newHeritage();
      renderHeritageFormFromState();
      renderEntitySingle('heritage_object.object_type');
      renderEntitySingle('heritage_object.monument');
      renderEntitySingle('heritage_object.material');
    } else { state.heritage_object = null; }
  });
  wireToggle('toggle-technique', 'technique-fields', on => {
    if (on) {
      if (!state.technique) state.technique = newTechnique();
      renderTechniqueFormFromState();
      renderStringList('technique.programming_languages');
    } else { state.technique = null; }
  });
}

// ---------------------------------------------------------------------
// Map (spatial extent)
// ---------------------------------------------------------------------

function initMapIfNeeded() {
  if (map) { requestAnimationFrame(() => map.invalidateSize()); return; }
  const container = document.getElementById('map-spatial');
  if (!container || !window.L) return;
  // Whole-world view by default (feedback 2026-09-07) -- the Ireland
  // centring was too presumptuous as a *starting* point even though the
  // family's real test data (Anne-Karoline's photogrammetry models) is
  // Irish heritage sites; zooming/panning to loaded or typed coordinates
  // happens in syncMapMarker()/syncMapRectangle() regardless.
  map = window.L.map(container).setView([20, 0], 2);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);
  map.on('click', onMapClick);
  requestAnimationFrame(() => map.invalidateSize());
  syncMapMarker();
  syncMapRectangle();
}

function onMapClick(e) {
  if (!markerDrawArmed) return; // bbox is drag-based (mousedown/move/up below), not click-based
  ensureSpatial();
  state.spatial.lat = e.latlng.lat;
  state.spatial.lon = e.latlng.lng;
  document.getElementById('field-spatial-lat').value = state.spatial.lat.toFixed(6);
  document.getElementById('field-spatial-lon').value = state.spatial.lon.toFixed(6);
  // Setting a point this way replaces any earlier bounding box rather than
  // adding to it (feedback 2026-09-07: a stale bbox from an earlier
  // lookup/drawing was left behind after setting just a point).
  clearMapBbox();
  syncMapMarker();
  disarmMarkerDraw();
  scheduleValidate(); scheduleAutosave();
}

function armMarkerDraw() {
  markerDrawArmed = true;
  disarmBboxDraw();
  const btn = document.getElementById('marker-draw-toggle');
  btn.textContent = 'click the map to set the point…';
  btn.classList.add('armed');
}
function disarmMarkerDraw() {
  markerDrawArmed = false;
  const btn = document.getElementById('marker-draw-toggle');
  if (btn) { btn.textContent = 'set marker on map…'; btn.classList.remove('armed'); }
}

// Bounding box is a real click-and-drag rectangle directly on the map
// (feedback 2026-09-07 -- an earlier two-click-corners version worked but
// felt unnatural), using Leaflet's own mouse events rather than adding the
// leaflet-draw plugin as a dependency for one interaction. Map panning is
// disabled for the duration of the drag so it doesn't fight the gesture.
function armBboxDraw() {
  if (!map) return;
  bboxDrawArmed = true; bboxDragStart = null;
  disarmMarkerDraw();
  map.dragging.disable();
  map.on('mousedown', onBboxMouseDown);
  const btn = document.getElementById('bbox-draw-toggle');
  btn.textContent = 'drag a rectangle on the map…';
  btn.classList.add('armed');
}
function disarmBboxDraw() {
  bboxDrawArmed = false; bboxDragStart = null;
  if (map) {
    map.dragging.enable();
    map.off('mousedown', onBboxMouseDown);
    map.off('mousemove', onBboxMouseMove);
    map.off('mouseup', onBboxMouseUp);
    if (bboxPreviewRect) { map.removeLayer(bboxPreviewRect); bboxPreviewRect = null; }
  }
  const btn = document.getElementById('bbox-draw-toggle');
  if (btn) { btn.textContent = 'draw rectangle on map…'; btn.classList.remove('armed'); }
}

function onBboxMouseDown(e) {
  bboxDragStart = e.latlng;
  map.on('mousemove', onBboxMouseMove);
  map.on('mouseup', onBboxMouseUp);
  if (e.originalEvent) e.originalEvent.preventDefault();
}
function onBboxMouseMove(e) {
  if (!bboxDragStart) return;
  const bounds = window.L.latLngBounds(bboxDragStart, e.latlng);
  if (!bboxPreviewRect) {
    bboxPreviewRect = window.L.rectangle(bounds, { color: '#935a34', weight: 2, fillOpacity: 0.08, dashArray: '4' }).addTo(map);
  } else {
    bboxPreviewRect.setBounds(bounds);
  }
}
function onBboxMouseUp(e) {
  if (!bboxDragStart) return;
  const a = bboxDragStart, b = e.latlng;
  ensureSpatial();
  state.spatial.bbox_w = Math.min(a.lng, b.lng);
  state.spatial.bbox_e = Math.max(a.lng, b.lng);
  state.spatial.bbox_s = Math.min(a.lat, b.lat);
  state.spatial.bbox_n = Math.max(a.lat, b.lat);
  document.getElementById('field-spatial-bbox-w').value = state.spatial.bbox_w.toFixed(6);
  document.getElementById('field-spatial-bbox-s').value = state.spatial.bbox_s.toFixed(6);
  document.getElementById('field-spatial-bbox-e').value = state.spatial.bbox_e.toFixed(6);
  document.getElementById('field-spatial-bbox-n').value = state.spatial.bbox_n.toFixed(6);
  // Symmetric with onMapClick above: drawing a bbox this way replaces any
  // earlier point rather than leaving it behind.
  clearMapPoint();
  syncMapRectangle();
  disarmBboxDraw();
  scheduleValidate(); scheduleAutosave();
}

function syncMapMarker() {
  if (!map || !state.spatial) return;
  const { lat, lon } = state.spatial;
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) {
    if (marker) { map.removeLayer(marker); marker = null; }
    return;
  }
  if (!marker) {
    marker = window.L.marker([lat, lon], { draggable: true }).addTo(map);
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      ensureSpatial();
      state.spatial.lat = pos.lat; state.spatial.lon = pos.lng;
      document.getElementById('field-spatial-lat').value = pos.lat.toFixed(6);
      document.getElementById('field-spatial-lon').value = pos.lng.toFixed(6);
      scheduleValidate(); scheduleAutosave();
    });
  } else {
    marker.setLatLng([lat, lon]);
  }
  // setView (not just panTo) so the point is actually visible up close --
  // at a wide starting zoom a panTo alone barely moved the visible frame
  // (feedback 2026-09-07). Math.max keeps an already-closer zoom as is.
  map.setView([lat, lon], Math.max(map.getZoom(), 13));
}

function syncMapRectangle() {
  if (!map || !state.spatial) return;
  const { bbox_w, bbox_s, bbox_e, bbox_n } = state.spatial;
  const vals = [bbox_w, bbox_s, bbox_e, bbox_n];
  if (vals.some(v => v == null || Number.isNaN(v))) { clearMapRectangle(); return; }
  const bounds = [[bbox_s, bbox_w], [bbox_n, bbox_e]];
  if (!rectangle) {
    rectangle = window.L.rectangle(bounds, { color: '#935a34', weight: 2, fillOpacity: 0.08 }).addTo(map);
  } else {
    rectangle.setBounds(bounds);
  }
  map.fitBounds(bounds, { maxZoom: 14 });
}

function clearMapRectangle() {
  if (rectangle) { map.removeLayer(rectangle); rectangle = null; }
}

// A spatial extent is treated as either a point or a bounding box at any
// given moment when drawn/looked-up interactively (feedback 2026-09-07:
// setting a new point via a click, or a new bbox via a drag, left the
// *other* one over from an earlier lookup/drawing). Explicit "clear
// point"/"clear bounding box" buttons already only ever touched their own
// half; these two helpers are what both those buttons and every
// point/bbox-setting action below now share, so the "clear the other one"
// behaviour lives in exactly one place.
function clearMapPoint() {
  ensureSpatial();
  state.spatial.lat = null; state.spatial.lon = null;
  const latEl = document.getElementById('field-spatial-lat');
  const lonEl = document.getElementById('field-spatial-lon');
  if (latEl) latEl.value = '';
  if (lonEl) lonEl.value = '';
  syncMapMarker();
}

function clearMapBbox() {
  ensureSpatial();
  ['bbox_w', 'bbox_s', 'bbox_e', 'bbox_n'].forEach(k => { state.spatial[k] = null; });
  ['w', 's', 'e', 'n'].forEach(dir => {
    const el = document.getElementById(`field-spatial-bbox-${dir}`);
    if (el) el.value = '';
  });
  clearMapRectangle();
}

// ---------------------------------------------------------------------
// File loading: MD.cff / CITATION.cff (YAML) and .zip bundles
// ---------------------------------------------------------------------

function wireDropzone() {
  const zone = document.getElementById('dropzone');
  ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.remove('drag-over'); }));
  zone.addEventListener('drop', e => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
}

function wireFileInput() {
  document.getElementById('file-input').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
    e.target.value = '';
  });
}

function showLoadReport(message, kind) {
  const el = document.getElementById('load-report');
  el.hidden = false;
  el.innerHTML = `<p class="${kind}-item">${escapeHtml(message)}</p>`;
}
function hideReport(id) {
  const el = document.getElementById(id);
  el.hidden = true;
  el.innerHTML = '';
}

async function handleFile(file) {
  const name = file.name.toLowerCase();
  hideReport('load-report');
  hideReport('zip-report');

  if (name.endsWith('.zip')) { await handleZipFile(file); return; }

  const text = await file.text();
  let doc;
  try {
    doc = yamlLib.load(text);
  } catch (err) {
    showLoadReport(`Could not parse "${file.name}" as YAML: ${err.message}`, 'error');
    return;
  }
  if (!doc || typeof doc !== 'object') {
    showLoadReport(`"${file.name}" did not parse to a YAML mapping.`, 'error');
    return;
  }
  if (doc['cff-version'] && !doc.md_cff_version) {
    showLoadReport(
      `"${file.name}" looks like a CITATION.cff, not an MD.cff. This tool edits MD.cff — for ` +
      `fdo:3DDataFDO a matching CITATION.cff is derived automatically from it (see the sidebar ` +
      `once you've loaded/filled in an MD.cff). Drop the MD.cff instead.`, 'warn');
    return;
  }
  populateFormFromMdCff(doc);
  showLoadReport(`Loaded "${file.name}" into the form below.`, 'ok');
}

function normalizeEntityArray(arr) {
  return Array.isArray(arr) ? arr.map(e => ({ label: (e && e.label) || '', id: (e && e.id) || '' })) : [];
}

function populateFormFromMdCff(doc) {
  const s = emptyState();
  s.fdo_type = doc.fdo_type || '';
  s.id = doc.id || '';
  s.title = doc.title || '';
  s.description = doc.description || '';
  s.version = doc.version || '';
  s.date_created = doc.date_created || '';
  s.date_released = doc.date_released || '';
  s.date_modified = Array.isArray(doc.date_modified) ? [...doc.date_modified] : [];
  s.funding = Array.isArray(doc.funding) ? [...doc.funding] : [];
  s.publishers = normalizeEntityArray(doc.publishers);
  s.creators = normalizeEntityArray(doc.creators);
  s.contributors = normalizeEntityArray(doc.contributors);
  s.license = doc.license ? { label: doc.license.label || '', id: doc.license.id || '' } : null;
  s.keywords = normalizeEntityArray(doc.keywords);
  s.identifiers = Array.isArray(doc.identifiers)
    ? doc.identifiers.map(i => ({ scheme: (i && i.scheme) || '', value: (i && i.value) || '', label: (i && i.label) || '' }))
    : [];
  s.related_resources = Array.isArray(doc.related_resources)
    ? doc.related_resources.map(r => ({
      relation: (r && r.relation) || '',
      target: (r && r.target) ? { label: r.target.label || '', id: r.target.id || '' } : newEntity(),
      note: (r && r.note) || '',
    }))
    : [];
  // doc.distributions is deliberately not read into form state at all --
  // fdo-squirrel computes it from a package's actual ZIP contents, this
  // tool never edits or round-trips it (feedback 2026-09-07).

  if (doc.spatial) {
    const bbox = parseBboxString(doc.spatial.bounding_box);
    s.spatial = {
      label: doc.spatial.label || '', id: doc.spatial.id || '', wkt: doc.spatial.wkt || '',
      lat: doc.spatial.lat ?? null, lon: doc.spatial.lon ?? null,
      bbox_w: bbox ? bbox[0] : null, bbox_s: bbox ? bbox[1] : null, bbox_e: bbox ? bbox[2] : null, bbox_n: bbox ? bbox[3] : null,
    };
  }
  if (doc.temporal) {
    s.temporal = {
      label: doc.temporal.label || '', id: doc.temporal.id || '',
      start: doc.temporal.start ?? null, end: doc.temporal.end ?? null,
      range_a: Array.isArray(doc.temporal.range) ? (doc.temporal.range[0] ?? null) : null,
      range_b: Array.isArray(doc.temporal.range) ? (doc.temporal.range[1] ?? null) : null,
    };
  }
  if (doc.heritage_object) {
    const h = doc.heritage_object;
    s.heritage_object = {
      object_type: h.object_type ? { label: h.object_type.label || '', id: h.object_type.id || '' } : newEntity(),
      monument: h.monument ? { label: h.monument.label || '', id: h.monument.id || '' } : newEntity(),
      material: h.material ? { label: h.material.label || '', id: h.material.id || '' } : newEntity(),
      context: h.context || '', documentation_purpose: h.documentation_purpose || '',
      overall_condition: h.overall_condition || '', conservation_urgency: h.conservation_urgency || '',
    };
  }
  if (doc.technique) {
    const t = doc.technique;
    const acquisition = t.acquisition || {};
    const repository = t.repository || {};
    s.technique = {
      acq_method: acquisition.method || '', acq_hardware: acquisition.hardware || '', acq_images_count: acquisition.images_count || '',
      processing: typeof t.processing === 'string' ? t.processing : (t.processing ? yamlLib.dump(t.processing).trim() : ''),
      programming_languages: Array.isArray(t.programming_languages) ? [...t.programming_languages] : [],
      repo_type: repository.type || '', repo_url: repository.url || '', repo_status: repository.development_status || '',
    };
  }

  state = s;
  renderFullForm();
  scheduleValidate();
  scheduleAutosave();
}

// ---------------------------------------------------------------------
// ZIP bundle structural validator
// ---------------------------------------------------------------------

async function handleZipFile(file) {
  let zip;
  try {
    const buf = await file.arrayBuffer();
    zip = await JSZipLib.loadAsync(buf);
  } catch (err) {
    const el = document.getElementById('zip-report');
    el.hidden = false;
    el.innerHTML = `<p class="error-item">Could not open "${escapeHtml(file.name)}" as a ZIP: ${escapeHtml(err.message)}</p>`;
    return;
  }
  const report = await validateZipBundle(zip, file.name);
  renderZipReport(report);
}

function ruleMatches(rule, base, ext, path) {
  const m = rule.match || {};
  if (m.filename) return m.filename.includes(base);
  if (m.filename_prefix) {
    if (!m.filename_prefix.some(p => base.startsWith(p))) return false;
    return m.extension ? m.extension.includes(ext) : true;
  }
  if (m.extension) return m.extension.includes(ext);
  if (m.path_prefix) return m.path_prefix.some(p => path.startsWith(p));
  return false;
}

function classifyFile(path, rules) {
  if (!rules) return 'unclassified';
  const base = path.split('/').pop();
  const ext = base.includes('.') ? '.' + base.split('.').pop().toLowerCase() : '';
  for (const rule of (rules.rules || [])) {
    if (ruleMatches(rule, base, ext, path)) return rule.role;
  }
  return rules.default_role || 'unclassified';
}

async function validateZipBundle(zip, filename) {
  const errors = [];
  const warnings = [];
  const rootNames = Object.keys(zip.files).filter(n => !zip.files[n].dir);

  const mdEntry = zip.file('MD.cff');
  const citationEntry = zip.file('CITATION.cff');

  let mdDoc = null;
  if (!mdEntry) {
    errors.push('No MD.cff at the ZIP root — fdo-squirrel classifies files by exact root filename, a nested copy will not be picked up.');
  } else {
    const mdText = await mdEntry.async('string');
    try {
      mdDoc = yamlLib.load(mdText);
      if (mdValidator) {
        const ok = mdValidator(mdDoc);
        if (!ok) mdValidator.errors.forEach(e => errors.push(`MD.cff: ${friendlyMessage(e)}`));
      } else {
        warnings.push('MD.cff schema not loaded (yet) — could not schema-check MD.cff inside the ZIP.');
      }
    } catch (err) {
      errors.push(`MD.cff inside the ZIP is not valid YAML: ${err.message}`);
    }
  }

  if (!citationEntry) {
    warnings.push('No CITATION.cff at the ZIP root.');
  } else {
    const citationText = await citationEntry.async('string');
    try {
      const citationDoc = yamlLib.load(citationText);
      if (cffValidator) {
        const ok = cffValidator(citationDoc);
        if (!ok) cffValidator.errors.forEach(e => errors.push(`CITATION.cff: ${(e.instancePath || '(root)')}: ${e.message}`));
      }
    } catch (err) {
      errors.push(`CITATION.cff inside the ZIP is not valid YAML: ${err.message}`);
    }
  }

  const fdoType = mdDoc && mdDoc.fdo_type;
  const rules = (classificationRules && fdoType && classificationRules.fdo_classes)
    ? classificationRules.fdo_classes[fdoType] : null;
  if (fdoType && !rules) {
    warnings.push(`fdo_type "${fdoType}" is not in the vendored classification_rules.yaml — every file below will say "unclassified".`);
  }

  const fileReport = [];
  let payloadCount = 0;
  for (const name of rootNames.sort()) {
    const entry = zip.files[name];
    const bytes = await entry.async('uint8array');
    const sha256 = await sha256Hex(bytes);
    const role = classifyFile(name, rules);
    if (role === 'model' || role === 'data') payloadCount++;
    fileReport.push({ path: name, role, size: bytes.length, sha256 });
  }
  if (fdoType && rules && payloadCount === 0) {
    warnings.push(`No file classified as "model" or "data" for fdo_type "${fdoType}" — this package may be empty of its actual payload.`);
  }

  if (mdDoc && Array.isArray(mdDoc.distributions)) {
    for (const dist of mdDoc.distributions) {
      if (!dist || !dist.checksum || !dist.checksum.value) continue;
      if (dist.checksum.algorithm !== 'sha256') continue; // the only algorithm this tool can check without another library
      const match = fileReport.find(f => f.path === dist.id || f.path.endsWith('/' + dist.id));
      if (!match) {
        warnings.push(`distributions[] entry "${dist.id}" has a checksum but no matching file was found in the ZIP by that id/path.`);
      } else if (match.sha256 !== String(dist.checksum.value).toLowerCase()) {
        errors.push(`distributions[] entry "${dist.id}": checksum mismatch (MD.cff says ${dist.checksum.value}, ZIP contains ${match.sha256}).`);
      }
    }
  }

  return { filename, ok: errors.length === 0, errors, warnings, fileReport, mdDoc };
}

function renderZipReport(report) {
  const el = document.getElementById('zip-report');
  el.hidden = false;
  const parts = [`<h3>${report.ok ? '✓' : '✗'} ${escapeHtml(report.filename)}</h3>`];
  if (report.errors.length) parts.push(`<ul>${report.errors.map(e => `<li class="error-item">${escapeHtml(e)}</li>`).join('')}</ul>`);
  if (report.warnings.length) parts.push(`<ul>${report.warnings.map(w => `<li class="warn-item">${escapeHtml(w)}</li>`).join('')}</ul>`);
  if (!report.errors.length && !report.warnings.length) {
    parts.push('<p class="ok-item">Structural checks passed: MD.cff and CITATION.cff present at root, MD.cff is schema-valid.</p>');
  }
  parts.push('<table><thead><tr><th>path</th><th>role</th><th>size</th><th>sha256</th></tr></thead><tbody>');
  report.fileReport.forEach(f => {
    parts.push(`<tr><td class="mono">${escapeHtml(f.path)}</td><td>${escapeHtml(f.role)}</td><td>${f.size.toLocaleString()} B</td><td class="mono">${f.sha256.slice(0, 16)}…</td></tr>`);
  });
  parts.push('</tbody></table>');
  parts.push('<p class="hint">Structural/schema checks only, run entirely in this browser — not the RDF/SHACL conformance check fdo-squirrel itself runs on actual ingest.</p>');
  if (report.mdDoc) parts.push('<button type="button" id="load-zip-mdcff" class="add-btn">Load this ZIP\u2019s MD.cff into the form for editing</button>');
  el.innerHTML = parts.join('');
  if (report.mdDoc) {
    document.getElementById('load-zip-mdcff').addEventListener('click', () => {
      populateFormFromMdCff(report.mdDoc);
      showLoadReport(`Loaded MD.cff from "${report.filename}" into the form below.`, 'ok');
      document.getElementById('section-core').scrollIntoView({ behavior: 'smooth' });
    });
  }
}

// ---------------------------------------------------------------------
// CITATION.cff derivation (fdo:3DDataFDO only — PRIMER.md S7 / A4)
// ---------------------------------------------------------------------

const CFF_IDENTIFIER_MAP = { doi: 'doi', url: 'url', swhid: 'swh' };

function deriveCitationCff(clean) {
  const authorsSource = (clean.creators && clean.creators.length) ? clean.creators : (clean.publishers || []);
  const authors = authorsSource.map(e => {
    const a = { name: e.label };
    if (e.id) a.website = e.id;
    return a;
  });
  const citation = {
    'cff-version': '1.2.0',
    type: 'dataset',
    title: clean.title || '',
    message: 'If you use this dataset, please cite it using the metadata from this file.',
    authors: authors.length ? authors : [{ name: '' }],
  };
  if (clean.description) citation.abstract = clean.description;
  if (clean.version) citation.version = clean.version;
  if (clean.date_released) citation['date-released'] = clean.date_released;
  if (clean.license) {
    if (looksLikeSpdx(clean.license.id)) citation.license = clean.license.id;
    else if (looksLikeSpdx(clean.license.label)) citation.license = clean.license.label;
  }
  if (clean.identifiers && clean.identifiers.length) {
    citation.identifiers = clean.identifiers.map(i => {
      const type = CFF_IDENTIFIER_MAP[i.scheme] || 'other';
      const o = { type, value: i.value };
      if (type === 'other' && i.scheme) o.description = `original scheme: ${i.scheme}`;
      return o;
    });
  }
  return citation;
}

function toggleCitationBlock() {
  document.getElementById('citation-block').hidden = state.fdo_type !== 'fdo:3DDataFDO';
}

function updateCitationPreview(clean) {
  const block = document.getElementById('citation-block');
  if (clean.fdo_type !== 'fdo:3DDataFDO') { block.hidden = true; return; }
  block.hidden = false;
  const citation = deriveCitationCff(clean);
  document.getElementById('citation-preview').textContent = safeDump(citation);

  const status = document.getElementById('citation-status');
  if (!cffValidator) {
    status.textContent = 'CFF schema not loaded yet — derived file shown unvalidated.';
  } else {
    const ok = cffValidator(citation);
    status.textContent = ok ? 'Valid against CFF 1.2.0.' : `${cffValidator.errors.length} issue(s) against CFF 1.2.0 — see browser console.`;
    status.className = ok ? 'hint ok-item' : 'hint warn-item';
    if (!ok) console.warn('CITATION.cff validation errors:', cffValidator.errors);
  }
}

// ---------------------------------------------------------------------
// Live validation against MD.cff-schema.yaml
// ---------------------------------------------------------------------

function friendlyMessage(err) {
  const path = err.instancePath || '(root)';
  if (err.keyword === 'enum') {
    const allowed = (err.params && err.params.allowedValues) || [];
    return `${path}: must be one of ${allowed.join(', ')}`;
  }
  if (err.keyword === 'additionalProperties') {
    const prop = err.params && err.params.additionalProperty;
    return `${path}: unexpected field "${prop}" is not allowed here by the schema`;
  }
  if (err.keyword === 'required') {
    return `${path === '(root)' ? '' : path + ' — '}missing required field "${err.params.missingProperty}"`;
  }
  return `${path}: ${err.message}`;
}

const TOP_LEVEL_FIELD_IDS = {
  fdo_type: 'field-fdo_type', id: 'field-id', title: 'field-title', description: 'field-description',
  version: 'field-version', date_created: 'field-date_created', date_released: 'field-date_released',
};

function markInvalidFields(errors) {
  Object.values(TOP_LEVEL_FIELD_IDS).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('field-invalid');
  });
  errors.forEach(e => {
    const seg = (e.instancePath || '').split('/')[1];
    const id = TOP_LEVEL_FIELD_IDS[seg];
    if (id) { const el = document.getElementById(id); if (el) el.classList.add('field-invalid'); }
  });
}

function scheduleValidate() {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(runValidate, 250);
}

function runValidate() {
  const clean = buildCleanObject();
  const reportEl = document.getElementById('validation-report');
  const previewEl = document.getElementById('yaml-preview');

  previewEl.textContent = safeDump(clean);

  if (!mdValidator) {
    reportEl.innerHTML = '<p class="muted">Schema not loaded yet — showing the document as built; full validation starts once the schema fetch above succeeds.</p>';
    updateCitationPreview(clean);
    return;
  }

  const valid = mdValidator(clean);
  const errors = valid ? [] : mdValidator.errors.slice();
  markInvalidFields(errors);

  const items = [];
  errors.forEach(e => items.push(`<li class="error-item">${escapeHtml(friendlyMessage(e))}</li>`));

  reportEl.innerHTML = items.length
    ? `<p>${items.length} issue(s):</p><ul>${items.join('')}</ul>`
    : '<p class="ok-item">Valid against MD.cff-schema.yaml.</p>';

  updateCitationPreview(clean);
}

// ---------------------------------------------------------------------
// Autosave (localStorage — this is a real deployed page, not a Claude
// artifact sandbox, so browser storage is fine here and genuinely useful:
// nobody should lose an hour of form-filling to an accidental reload)
// ---------------------------------------------------------------------

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state)); } catch (e) { /* private browsing / quota — not essential, skip silently */ }
  }, 600);
}

function restoreDraftIfAny() {
  let saved;
  try { saved = localStorage.getItem(AUTOSAVE_KEY); } catch (e) { return; }
  if (!saved) return;
  let parsed;
  try { parsed = JSON.parse(saved); } catch (e) { return; }
  if (!parsed || typeof parsed !== 'object') return;
  const hasContent = parsed.title || parsed.description || parsed.id || (parsed.publishers && parsed.publishers.length);
  if (!hasContent) return;
  state = Object.assign(emptyState(), parsed);
  renderFullForm();
  showLoadReport('Restored your last unsaved draft from this browser. Use "Clear form" below to discard it.', 'ok');
}

// ---------------------------------------------------------------------
// Schema loading
// ---------------------------------------------------------------------

async function loadMdSchema() {
  const banner = document.getElementById('schema-banner');
  try {
    const [{ default: Ajv2020 }, res] = await Promise.all([
      import(AJV_2020_ESM_URL),
      fetch(MD_CFF_SCHEMA_URL, { cache: 'no-store' }),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching MD.cff-schema.yaml`);
    const text = await res.text();
    mdSchema = yamlLib.load(text);
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    mdValidator = ajv.compile(mdSchema);
    banner.className = 'banner banner-ok';
    banner.innerHTML = 'Loaded <code>MD.cff-schema.yaml</code> from fdo-squirrel\u2019s <code>master</code> branch — this form validates live against exactly this schema.';
  } catch (err) {
    banner.className = 'banner banner-error';
    banner.innerHTML = `Could not load the live schema (${escapeHtml(String(err && err.message || err))}). The form still works, but full schema validation is unavailable until this succeeds — reload once you're back online, or check an ad/tracker blocker isn't blocking cdn.jsdelivr.net / raw.githubusercontent.com.`;
  }
}

async function loadCffSchema() {
  try {
    const [{ default: Ajv }, res] = await Promise.all([
      import(AJV_DRAFT07_ESM_URL),
      fetch(CITATION_CFF_SCHEMA_PATH, { cache: 'no-store' }),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cffSchema = await res.json();
    const ajv = new Ajv({ allErrors: true, strict: false });
    cffValidator = ajv.compile(cffSchema);
  } catch (err) {
    console.warn('CITATION.cff schema (vendored) failed to load — derived CITATION.cff will be shown unvalidated:', err);
  }
}

async function loadClassificationRules() {
  try {
    const res = await fetch(CLASSIFICATION_RULES_PATH, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    classificationRules = yamlLib.load(await res.text());
  } catch (err) {
    console.warn('classification_rules.yaml (vendored) failed to load — ZIP validator role column will say "unclassified":', err);
  }
}

// ---------------------------------------------------------------------
// Downloads & reset
// ---------------------------------------------------------------------

function downloadYaml(obj, filename) {
  const text = safeDump(obj);
  const blob = new Blob([text], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function wireButtons() {
  document.getElementById('download-mdcff').addEventListener('click', () => downloadYaml(buildCleanObject(), 'MD.cff'));
  document.getElementById('download-citation').addEventListener('click', () => downloadYaml(deriveCitationCff(buildCleanObject()), 'CITATION.cff'));
  document.getElementById('reset-form').addEventListener('click', () => {
    if (!confirm('Clear the whole form? This cannot be undone.')) return;
    state = emptyState();
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) { /* ignore */ }
    disarmBboxDraw();
    disarmMarkerDraw();
    clearMapRectangle();
    if (marker && map) { map.removeLayer(marker); marker = null; }
    renderFullForm();
    hideReport('load-report'); hideReport('zip-report');
    scheduleValidate();
  });
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

async function boot() {
  wireStaticFieldListeners();
  wireSpatialFields();
  wireTemporalFields();
  wireHeritageFields();
  wireTechniqueFields();
  wireListAddButtons();
  wireToggles();
  wireDropzone();
  wireFileInput();
  wireButtons();

  restoreDraftIfAny();
  renderAllLists();
  toggleCitationBlock();

  await Promise.all([loadMdSchema(), loadCffSchema(), loadClassificationRules()]);
  scheduleValidate();
}

boot();
