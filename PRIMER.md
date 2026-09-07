# PRIMER.md — fdo-squirrel-md-generator

Arbeitsplan für einen `MD.cff`/`CITATION.cff`-Initializer als statische
Web-Seite, für die [FDOx-squirrel](https://github.com/FDOx-squirrel)-Familie.
Läuft komplett im Browser (GitHub Pages), kein Server, kein Build-Schritt zur
Laufzeit.

## Teil A — Immer gültig

### A1 Ausgangslage & Befunde (2026-09-07)

Vorheriger Stand (geprüft 2026-09-03, siehe Git-Historie dieser Datei):
Repo existierte nur mit dieser PRIMER.md, kein Code. Für diese Session neu
geprüft, mit wichtigen Korrekturen gegenüber dem alten Stand:

1. **`fdo-3d-packager` ist inzwischen komplett** (S0–S9 alle erledigt,
   Stand heute 2026-09-07) — der Generator ist also kein Vorgriff mehr,
   sondern deckt den echten Alltag ab: `fdo-3d-packager`s `step_mdcff.py`
   schreibt `MD.cff` mit fester Platzhalter-`id` ("TODO: id not set..."),
   `fdo_type` immer `fdo:3DDataFDO`, `publishers`/`creators`/`license` als
   `{label,id?}`, `keywords` mit Wikidata-Defaults. Genau dieses File landet
   künftig regelmäßig hier zum Fixup, bevor ein Zenodo-Release rausgeht.
2. **Korrektur:** `fdo_type` hat **vier** Enum-Werte, nicht drei wie in der
   Vorgänger-PRIMER notiert: `fdo:SoftwareFDO`, `fdo:AnalysisFDO`,
   `fdo:3DDataFDO`, `fdo:RegistryFDO` (`schemas/md_cff/MD.cff-schema.yaml`
   in `fdo-squirrel`, Commit `504b7af5...`, 2026-09-04).
3. **`fdo-3d-packager/py/step_bundle.py`** legt das verbindliche ZIP-Layout
   für Bundles fest: `MD.cff`/`CITATION.cff` an der Wurzel,
   `data/model/*`, `data/textures/*` (optional), `data/images/preview.png`,
   `viewer/*` (3DHOP). `fdo-squirrel/fdo/classification_rules.yaml`
   klassifiziert Dateien pro `fdo_type` anhand von Dateiname/Endung/Pfad —
   bewusst allgemeiner als nur der 3D-Packager-Fall (auch für zukünftige
   `fdo-git-packager`-ZIPs relevant, `fdo:SoftwareFDO`).
4. **ajv 8 liefert kein Browser-UMD-Bundle mehr** — das npm-Paket enthält
   nur `dist/2020.js` als CommonJS-Modul (per `npm pack ajv@8.20.0` selbst
   entpackt und geprüft, 2026-09-07). Gelöst über jsDelivrs `+esm`-Endpunkt:
   `import Ajv2020 from ".../ajv@8.20.0/dist/2020.js/+esm"` in einem
   `<script type="module">` — bleibt bundlerfrei, siehe A4.
5. **CDN-Versionen real geprüft** (nicht nur angenommen), per `npm pack`
   bzw. `npm view` gegen die echte npm-Registry: `js-yaml@4.3.2` (globaler
   Name `jsyaml`, klassisches UMD), `jszip@3.10.1` (global `JSZip`),
   `leaflet@1.9.4` (global `L`), `ajv@8.20.0` (kein Browser-Global, s.o.).

### A2 Zielbild

```
py/templates/config.js.j2  ──┐
site/index.html              ├─→ main.py (step_build) ─→ docs/  ─→ GitHub Pages
site/app.css                 │      (kein Netz, rein lokal)
site/app.js                  │
schemas/*                   ─┘
```

`docs/` ist vollständig generiert (nichts davon ist eine Quelle) und wird
trotzdem committet — GitHub Pages liest `main`/`docs` direkt, kein
Workflow-YAML nötig (Settings → Pages → Deploy from a branch → `main`
`/docs`). `site/index.html`/`app.css`/`app.js` werden 1:1 kopiert (kein
Jinja2 nötig, keine Variablen darin); nur `docs/config.js` wird aus
`py/templates/config.js.j2` gerendert — das ist die einzige Datei mit
echten Build-Variablen (RELEASE, Schema-URLs, CDN-Pins), damit es genau
eine Quelle der Wahrheit dafür gibt (`py/md_generator_utils.py`).

### A3 Regeln (repo-übergreifend, siehe primer-repo-Skill)

- Offline: `main.py` fasst nie das Netz an. Der Live-Schema-Fetch passiert
  ausschließlich im Browser, beim Seitenaufruf.
- Reuse = Kopieren: `schemas/citation_cff/schema.json` und
  `schemas/classification_rules.yaml` sind vendorte Kopien (mit
  Herkunfts-`$comment`/Kommentarkopf), nicht live nachgeladen — beides
  vergleichsweise stabile Spezifikationen. **Einzige bewusste Ausnahme:**
  `MD.cff-schema.yaml` selbst, live von `fdo-squirrel`s `master`-Branch
  gefetcht (A4), weil dieses Schema sich noch bewegt.
- Determinismus: kein `datetime.now()` im Build, `docs/` ist byte-identisch
  bei zwei Läufen (geprüft, siehe PATCH-README "Verified here").
- CLI-Kontrakt: `--list/--only/--from/--skip/--dry-run/--strict`, auch wenn
  es hier nur einen Schritt gibt (Konsistenz mit der Familie).

### A4 Beschlusslage (2026-09-07)

| # | Entscheidung | Begründung |
|---|---|---|
| D1 | MD.cff-Schema live von `fdo-squirrel`, Branch `master` (nicht Tag/Commit) | einzige Ausnahme von "Reuse=Kopieren", A2/A3; löst die alte Teil-D-Frage nach dem Branch |
| D2 | CITATION.cff-Schema (CFF 1.2.0, draft-07) vendort, `$comment`-Provenienz, Pin auf Commit `0c5b4aa...` (2026-01-20) | stabile, geschlossene Spec |
| D3 | `classification_rules.yaml` vendort (same-origin `fetch`), nur für die ZIP-Validator-Rollenanzeige, nicht sicherheitskritisch | same-origin, kein CORS, kein externer Ausfallpunkt |
| D4 | js-yaml/jszip/leaflet klassisch per `<script>`-CDN (Browser-Globals), ajv per ESM-`+esm`-Import in `<script type="module">` | ajv liefert kein UMD-Bundle mehr, Rest bleibt beim etablierten Muster |
| D5 | Alle vier CDN-Versionen exakt gepinnt, `--strict` lintet `site/index.html` dagegen | verhindert stillen Drift auf `@latest` |
| D6 | **Round-Trip-Laden ist Kern-Feature ab v0.1**, nicht wie in der Vorgänger-PRIMER auf "später" verschoben | ist der tägliche Workflow mit `fdo-3d-packager`s Platzhalter-`id`, nicht hypothetisch |
| D7 | **ZIP-Validierung**: strukturelle/Schema-Vorprüfung **client-seitig** (JSZip + dieselben Ajv-Instanzen), explizit **kein** Ersatz für `fdo-squirrel`s RDF/SHACL-Konformanzprüfung beim echten Ingest | Nutzeranfrage 2026-09-07 ("kannst du entscheiden"); volle SHACL-Prüfung bräuchte Pyodide+rdflib+pyshacl im Browser — zu schwer für eine schnelle Vorprüfung, siehe Teil D |
| D8 | Bounding-Box-Zeichnen: einfaches "zwei Ecken anklicken" statt `leaflet-draw`-Plugin | eine CDN-Abhängigkeit weniger, weniger Fläche für einen Bug, den ich ohne echten Browser nicht testen kann |
| D9 | Formular-Autosave in `localStorage` | echte ausgelieferte Seite, kein Claude-Artifact-Sandbox-Kontext — hier ist Browser-Storage angemessen und nützlich |
| D10 | Karte standardmäßig auf Irland zentriert (`[53.4, -8.0]`, Zoom 6) | Anne-Karolines Photogrammetrie-Testdaten (irische Heritage-Sites) |

### A5 Upload-Bundle für neue Sessions

```
zip -r bundle.zip PRIMER.md main.py py/ site/ schemas/ README.md CITATION.cff requirements.txt .gitignore -x '**/__pycache__/*'
```
(`docs/` nicht mitschicken — wird von `python main.py` neu erzeugt.)

## Teil B — Schritte

| Schritt | Beschreibung | Status |
|---|---|---|
| S1 | Repo-Skeleton, `main.py`, `step_build.py`, `md_generator_utils.py` | erledigt (2026-09-07) |
| S2 | `site/index.html` + `app.css`: Formular für alle `MD.cff`-Felder, zweispaltiges Layout | umgesetzt, **Browser-Verifikation aussteht** |
| S3 | `site/app.js`: State, Live-Validierung gegen `MD.cff-schema.yaml`, YAML-Export | umgesetzt, **Browser-Verifikation aussteht** |
| S4 | Round-Trip-Laden (Drag&Drop `MD.cff`/YAML → Formular) | umgesetzt, **Browser-Verifikation aussteht** |
| S5 | ZIP-Struktur-Validator (Drag&Drop `.zip`) | umgesetzt, **Browser-Verifikation aussteht** |
| S6 | Karte (Spatial Extent: Punkt + Bounding Box) | umgesetzt, **Browser-Verifikation aussteht** |
| S7 | CITATION.cff-Ableitung für `fdo:3DDataFDO` | umgesetzt, **Browser-Verifikation aussteht** |
| S8 | RSE-Compliance (README/LICENSE/CITATION.cff/.gitignore/requirements.txt) | erledigt (2026-09-07) |

**Zu "Browser-Verifikation aussteht":** In dieser Sandbox gibt es keinen
echten Browser. Geprüft wurde: `python main.py --strict` läuft, ist
deterministisch (zwei Läufe → byte-identisches `docs/`); `node --check`
bestätigt syntaktisch valides ES-Modul; ein jsdom+vm-Testharness hat
`boot()` gegen die echte `site/index.html`-DOM-Struktur ausgeführt und
bestätigt, dass alle `getElementById`/`querySelector`-Aufrufe passende
Elemente finden (kein synchroner Absturz beim Verdrahten der Formular-
Widgets, Toggle-Felder, Add-Buttons). **Nicht** geprüft: tatsächliches
Rendering, die echten CDN-Fetches (`cdn.jsdelivr.net` ist in dieser
Sandbox nicht erreichbar), die Karte (Leaflet im jsdom-Test nur gestubbt),
das tatsächliche Aussehen. Nach dem ersten `python main.py` bitte
`python -m http.server 8000 --directory docs` und `http://localhost:8000/`
im echten Browser öffnen, bevor S2–S7 als "erledigt" gelten (Prinzip aus
`fdo-3d-packager`s PRIMER: "Eine Seite ist erst bewiesen, wenn ein Browser
sie gerendert hat").

## Teil C — Schritte im Detail

### S1 — Skeleton
`main.py` folgt dem Familien-CLI-Kontrakt, hat aber nur einen Schritt
(`build`), weil dieses Repo eine statische Seite baut, keine
Datenpipeline — siehe `py/step_build.py`s Docstring für die ausführliche
Begründung, warum trotzdem ein main.py-Orchestrator existiert (Konsistenz)
und warum `index.html`/`app.css`/`app.js` nur kopiert, nicht templated
werden (keine echten Substitutionen nötig).

### S2/S3 — Formular & Validierung
Formularfelder sind statisch in `site/index.html` verdrahtet (nicht aus
einem UI-Schema generiert) — bewusst einfacher/testbarer gehalten, weil
ich das Ergebnis nicht in einem echten Browser sehen kann. Repeatable
Felder (`publishers`, `creators`, `contributors`, `keywords`,
`identifiers`, `related_resources`, Datumslisten) werden dynamisch von
`app.js` gerendert. `buildCleanObject()` in `app.js` baut aus dem
internen State ein schema-förmiges Objekt: Pflichtfelder werden immer
emittiert (auch leer, damit Ajv den echten "required"/"minItems"-Fehler
zeigt statt dass dieser Code einen vortäuscht), optionale Felder nur wenn
nicht leer. `spatial`/`temporal` halten Bounding-Box/Range intern als
einzelne Skalare (`bbox_w/s/e/n`, `range_a/range_b`) für einfaches
Zwei-Wege-Binding an vier/zwei Inputs + Karte; werden erst beim Export zu
den Schema-Formen (`bounding_box`-String, `range`-Array) zusammengesetzt.

Fehlermeldungen: für `enum`/`additionalProperties`/`required` gibt es
lesbarere Texte (`friendlyMessage()`); Feld-Highlighting (`.field-invalid`)
nur für die Top-Level-Felder (Core-Sektion) — tiefes Array-Pfad-
Highlighting bewusst als v0.1-Vereinfachung ausgelassen, der Fehlertext
zeigt trotzdem den vollen JSON-Pfad.

### S4 — Round-Trip
`populateFormFromMdCff()` übernimmt jedes bekannte Top-Level-Feld aus einer
geladenen `MD.cff` in den State und rendert das komplette Formular neu.
Ein bereits vorhandenes `distributions`-Array geht dabei **nicht**
verloren — es landet unverändert als YAML-Rohtext in einem "advanced"
Textarea-Feld (`distributions_raw`), weil `fdo-squirrel` Distributions
selbst aus dem tatsächlichen ZIP-Inhalt ableitet, nicht aus `MD.cff`
liest — dieses Repo soll da nicht vorgreifen (Beschlusslage der
Vorgänger-PRIMER, hier übernommen).

### S5 — ZIP-Validator
`validateZipBundle()`: prüft `MD.cff`/`CITATION.cff` an der ZIP-Wurzel,
validiert beide gegen ihr jeweiliges Schema (dieselben Ajv-Instanzen wie
das Formular), klassifiziert jede Datei per vendorter
`classification_rules.yaml` (nur Anzeige, nicht sicherheitsrelevant),
berechnet SHA-256 je Datei (`crypto.subtle.digest`, nativ im Browser) und
gleicht das gegen `MD.cff`s `distributions[].checksum` ab, falls vorhanden
(nur `sha256`-Algorithmus wird geprüft — der einzige, den dieser Code ohne
weitere Bibliothek berechnen kann). Explizit **keine** RDF/SHACL-Prüfung —
das bleibt `fdo-squirrel`s Aufgabe beim echten Ingest (siehe Banner-Text
im ZIP-Report selbst).

### S6 — Karte
Leaflet, OSM-Tiles, kein API-Key. Ein Klick setzt/verschiebt den
Punkt-Marker; über den Button "draw bounding box on map…" wird ein
Zwei-Klick-Modus scharfgeschaltet (erste Ecke, zweite Ecke → Rechteck +
die vier Zahlenfelder). Lazy-initialisiert erst beim ersten Öffnen der
Spatial-Sektion (`initMapIfNeeded()`), weil Leaflet in einem zu dem
Zeitpunkt `hidden`-Container sonst mit Größe 0 initialisiert — inklusive
`invalidateSize()` danach.

### S7 — CITATION.cff-Ableitung
Nur für `fdo_type === 'fdo:3DDataFDO'`. Autoren immer als CFF-`entity`
(nie ein geratener Vor-/Nachname-Split); `creators` falls vorhanden, sonst
`publishers`. Identifier-Mapping: `doi→doi`, `url→url`, `swhid→swh`, alles
andere → `other` mit dem ursprünglichen Schema-Namen in der Beschreibung.
Lizenz nur übernommen, wenn Label/Id wie eine SPDX-Kennung aussieht
(`looksLikeSpdx()`) — verhindert, dass `fdo-3d-packager`s
`TODO`-Platzhalter versehentlich als Lizenz-String landet.

## Teil D — Offene Punkte

- **Tiefes Feld-Highlighting** für Array-Elemente (z. B. `publishers[2].label`)
  fehlt noch — aktuell nur Top-Level-Felder markiert, s. S2/S3.
- **`leaflet-draw`** als Alternative zum eigenen Zwei-Klick-Bbox-Zeichnen,
  falls das eigene UX zu hakelig ist (D8) — bewusst nicht in v0.1.
- **Volle RDF/SHACL-Prüfung im Browser** (Pyodide + rdflib + pyshacl) als
  möglicher Ausbau des ZIP-Validators — die Familie hat mit Pyodide für
  SPARQL im Browser bereits Erfahrung (`wdt-sparql`-Skill), wäre also nicht
  bei null. Für v0.1 bewusst nicht gemacht (Ladezeit/Payload), siehe D7.
- **`fdo-architecture/registry.yaml`** hat für dieses Repo noch den alten
  Stand ("Decisions done, no code yet") — Update lebt in einem anderen
  Repo, hier nur vermerkt statt im selben Patch mitgeliefert (Konvention:
  ein Repo pro Chat/Patch).
- **Browser-Verifikation** (Teil B) ist der wichtigste offene Punkt vor
  einem echten Release.
