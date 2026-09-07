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
| S2 | `site/index.html` + `app.css`: Formular für alle `MD.cff`-Felder, zweispaltiges Layout | **im Browser bestätigt** (2026-09-07, Govan-2-Test) |
| S3 | `site/app.js`: State, Live-Validierung gegen `MD.cff-schema.yaml`, YAML-Export | **im Browser bestätigt** (2026-09-07) |
| S4 | Round-Trip-Laden (Drag&Drop `MD.cff`/YAML → Formular) | **im Browser bestätigt** (2026-09-07) |
| S5 | ZIP-Struktur-Validator (Drag&Drop `.zip`) | umgesetzt, **Browser-Verifikation aussteht** (noch kein ZIP getestet, nur `MD.cff` direkt) |
| S6 | Karte (Spatial Extent: Punkt + Bounding Box) | Bug gemeldet + gefixt (A6), **erneute Browser-Verifikation aussteht** |
| S7 | CITATION.cff-Ableitung für `fdo:3DDataFDO` | **im Browser bestätigt** (2026-09-07) |
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

### A6 Nachtrag 2026-09-07 (Feedback nach erstem Deploy)

Flo hat v0.1 im echten Browser getestet (Govan-2-Stone-`MD.cff` geladen):
Formular, Validierung, YAML-Preview und CITATION.cff-Ableitung funktionieren
wie gebaut. Zwei Bugs + eine Vereinfachung gemeldet und behoben:

- **Karte reagierte nicht auf geladene/eingegebene Koordinaten.** Ursache
  vermutlich Leaflets CSS-Scan-Auto-Erkennung der Standard-Marker-Icons
  (unzuverlässig via CDN) plus `panTo()` ohne Zoom (bei Zoomstufe 6 kaum
  sichtbar). Fix: `L.Icon.Default.mergeOptions()` mit expliziten, gepinnten
  Icon-URLs (`LEAFLET_IMAGES_BASE_URL`, neue Konstante,
  `py/md_generator_utils.py`/`config.js.j2`), und `syncMapMarker()` nutzt
  jetzt `setView(..., Math.max(currentZoom, 13))` statt `panTo()`.
- **UX-Wunsch:** explizite Buttons statt implizitem Klick-Verhalten — "set
  marker on map…" und "draw rectangle on map…" (mit "armed"-Zustand,
  visuell markiert), beide scharf schalten einen Modus, ein Klick auf die
  Karte ohne scharfgeschalteten Modus tut jetzt nichts (vorher: einfacher
  Klick setzte implizit immer den Punkt — das kollidierte gedanklich mit
  dem expliziten Bbox-Button und war laut Feedback verwirrend).
- **Distributions-Sektion komplett entfernt** (Formularfeld + State +
  Roundtrip-Erhalt) — Flo: "das sollte ja automatisch passieren". Ein
  geladenes `MD.cff` mit vorhandenem `distributions[]` verliert das beim
  erneuten Export aus diesem Tool jetzt einfach (`fdo-squirrel` berechnet
  es ohnehin aus dem tatsächlichen ZIP-Inhalt neu, A4 D7-Nachbarentscheidung
  — dieses Tool muss es also nicht mehr durchschleifen). Der ZIP-Validator
  (S5) liest `distributions[]` weiterhin direkt aus einer geladenen ZIP für
  den Checksummen-Abgleich — das ist ein separater Lesepfad, unverändert.

### A7 Nachtrag 2026-09-07, zweite Runde (Karte + Identifier-Kurzformen)

Nach A6 gemeldet (mit Firefox-Konsole, Netzwerk-Tab zeigte den Fehler
eindeutig):

- **Marker-Icon-Fix aus A6 war selbst fehlerhaft.** `L.Icon.Default`s
  `_getIconUrl` hängt `imagePath` IMMER vor `iconUrl`/`iconRetinaUrl`/
  `shadowUrl` (die als reine Dateinamen gedacht sind, kein `/`-Trenner wird
  von Leaflet ergänzt) — A6 hatte dort volle URLs reingesetzt, das ergab
  doppelt zusammengesetzte, kaputte Requests
  (`.../dist/images/https://cdn.jsdelivr.net/...`, im Netzwerk-Tab
  bestätigt). Korrekt: nur `imagePath` setzen (mit eigenem `/` am Ende,
  da Leaflet keinen einfügt), Rest bleibt bei Leaflets eigenen (relativen)
  Defaults. Verifiziert per `npm pack leaflet@1.9.4` und Lesen von
  `dist/leaflet-src.js` (Zeile ~7507) — nicht mehr geraten.
- **Start-Zoom**: jetzt Weltkarte (`[20, 0]`, Zoom 2) statt Irland-Default —
  Zoomen auf einen Punkt passiert weiterhin automatisch beim Setzen/Laden
  von Koordinaten (`syncMapMarker()`/`syncMapRectangle()`).
- **Bounding Box**: echtes Ziehen (mousedown/mousemove/mouseup direkt auf
  der Karte, `map.dragging` währenddessen deaktiviert) statt
  Zwei-Klick-Ecken — kein zusätzliches CDN-Paket (`leaflet-draw`) dafür,
  reine Leaflet-Kernfunktionalität.
- **Neu (Wunsch, nicht Bugfix): Wikidata-/OSM-Kurzformen** für alle
  `id`-Felder im Formular (Publishers/Creators/Contributors/Keywords/
  License/Heritage-Object-Unterfelder/Related-Resources-Target/Spatial/
  Temporal — alles, was durch `renderEntityList()`/`renderEntitySingle()`
  läuft, plus die beiden Sonderfälle `related_resources[].target` und
  `spatial.id`/`temporal.id`, die eigene Render-Pfade haben). Eine bloße
  Wikidata-Q-ID (`Q12345`) oder OSM-Referenz (`node/xyz`, `way/xyz`,
  `relation/xyz`) wird beim Verlassen des Feldes (`blur`, nicht bei jedem
  Tastenanschlag) zur vollen URL expandiert (`normalizeEntityId()`,
  `wireIdNormalize()`). **Bewusst nicht** an den Top-Level-`identifiers[]`
  gemacht — deren `scheme`-Enum kommt aus `fdo-squirrel`s Schema und ist
  von hier aus nicht erweiterbar; "wikidata"/"osm" passen semantisch auch
  eher zu Entitäten/Orten als zu Identifiern der Ressource selbst.

### A8 Nachtrag 2026-09-07, dritte Runde (Anzeige/Export getrennt + Koordinaten-Lookup)

- **Kurzform bleibt im Formular sichtbar, nur die exportierte Datei
  bekommt die Langform.** A6/A7 haben das Feld selbst beim Verlassen
  umgeschrieben (Q42 → volle URL, sichtbar im Input) — das wollte Flo
  nicht ("nur im file selbst"). Jetzt sauber getrennt:
  `shortenEntityId()` (Langform → Kurzform) läuft ausschließlich beim
  **Rendern** eines gespeicherten Werts in ein Input-Feld (egal ob der
  Wert vom Nutzer getippt oder aus einer geladenen `MD.cff` mit bereits
  voller URL stammt); `normalizeEntityId()` (Kurzform → Langform) läuft
  ausschließlich in `cleanEntity()`/`cleanSpatial()`/`cleanTemporal()`,
  also nur beim Bauen des Export-Objekts. Der interne State selbst bleibt
  unangetastet (genau das, was getippt/geladen wurde) — beide Funktionen
  sind reine Anzeige- bzw. Export-Transformationen, keine State-Mutation.
- **Koordinaten-Lookup** (Flos Idee, zweite Nachricht): Button "look up
  coordinates" neben dem Spatial-Identifier-Feld. Erkennt Wikidata-QID
  oder OSM-node/way/relation-Referenz (`parseWikidataOrOsmRef()`, auch aus
  bereits voller URL), holt bei Wikidata die Koordinate über
  `P625` (`wbgetentities`-API, `origin=*` für CORS), bei OSM über
  Nominatims `/lookup`-Endpunkt (liefert bei way/relation zusätzlich eine
  Bounding Box, wird gleich mit übernommen). Bewusst ein **Button, kein
  automatischer Fetch bei jedem Tastenanschlag/Blur** — sonst Netzlast bei
  jedem Zwischenstand, und würde der bisherigen "nichts verlässt den
  Browser ungefragt"-Linie widersprechen (README aktualisiert: dieser
  einzelne, nutzerausgelöste Request ist jetzt dort benannt).
- **Temporal/Chronontology bewusst nicht umgesetzt** — Flos eigener
  Hinweis ("etwas schwieriger") trifft es: anders als bei Wikidata/OSM
  gibt es keine 1:1-ID→Koordinate-Auflösung, sondern eine Perioden-Suche
  mit Namensmehrdeutigkeit und uneinheitlichen Datumskonventionen
  (BCE/CE, Kalenderreform-Fragen). Als Teil-D-Punkt vorgemerkt.

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
- **Chronontology-API für Temporal** (Flos Idee, A8): Periodennamen gegen
  https://chronontology.dainst.org/api/data/period/search auflösen, um
  `start`/`end`/`range` vorzuschlagen. Schwieriger als der Spatial-Fall
  (Namensmehrdeutigkeit, Datumskonventionen) — bewusst nicht in dieser
  Runde umgesetzt, siehe A8.
