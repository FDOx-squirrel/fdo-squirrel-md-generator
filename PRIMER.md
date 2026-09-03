# PRIMER.md — fdo-squirrel-md-generator

Arbeitsplan für einen `MD.cff`-Initializer (Web-Formular), parallel zu
[`cff-initializer-javascript`](https://github.com/citation-file-format/cff-initializer-javascript),
aber für das `MD.cff`-Schema aus
[`fdo-squirrel`](https://github.com/Research-Squirrel-Engineers/fdo-squirrel).

## Teil A — Immer gültig

### A1 Ausgangslage

| Repo | Rolle |
|---|---|
| `citation-file-format/cff-initializer-javascript` | Vorbild-App: Vue3/Quasar-Stepper zum Erzeugen von `CITATION.cff`, Validierung gegen `schema.json` (JSON Schema draft-07) |
| `Research-Squirrel-Engineers/fdo-squirrel` | Quelle des `MD.cff`-Schemas und der Python-Pipeline, die `MD.cff` strikt dagegen validiert |
| `Research-Squirrel-Engineers/fdo-squirrel-md-generator` | Zielrepo dieses Projekts — existiert bereits auf GitHub, ist aber leer, kein Commit (geprüft 2026-09-03 per `git clone`) |

**Befunde (geprüft 2026-09-03, per Clone + lokaler Validierung):**

1. `fdo-squirrel` enthält **zwei widersprüchliche** `MD.cff`-Schemata: das
   veraltete Root-File `MD.cff.schema.yaml` (informelles YAML, keine
   JSON-Schema-Syntax) und `schemas/md_cff/MD.cff-schema.yaml` (echtes JSON
   Schema, draft 2020-12, `$id: https://w3id.org/n4o/fdo/md-cff/schema/0.1`).
   `main.py` (Zeile 362) lädt ausschließlich Letzteres und validiert strikt
   mit `jsonschema.Draft202012Validator` (`ingest/metadata_ingest.py`). →
   **Letzteres ist für uns maßgeblich.**
2. Beide mitgelieferten Beispiel-Instanzen (`example_fdo/MD.cff`,
   `examples/md_cff/MF.cff.minimal.yaml`) validieren **nicht** gegen das
   aktuelle Schema (selbst mit `Draft202012Validator` getestet): `description`
   und `publishers` (Pflichtfelder) fehlen, `abstract`/`publisher` sind wegen
   `additionalProperties: false` nicht erlaubt, `keywords` müssten
   `{label, id?}`-Objekte statt Strings sein, `license` müsste ein Objekt
   statt ein String sein. Das ist genau das Problem, das ein Initializer lösen
   soll.
3. Der Crosswalk (`crosswalks/md_cff_crosswalk.py`) ist toleranter als das
   Schema — er akzeptiert sowohl `publisher` (Singular, legacy) als auch
   `publishers` (Liste, aktuell). Schema und tatsächlich verarbeiteter Code
   laufen also leicht auseinander.
4. `fdo-squirrel` nutzt selbst bereits `cffinit`, um seine eigene
   `CITATION.cff` zu erzeugen (Kommentarzeile im File) — das Vorbild ist im
   Einsatz, nur eben nicht für `MD.cff`.
5. `cff-initializer-javascript` ist **kein** reiner Schema→Form-Generator,
   sondern eine handgebaute Vue3/Quasar-Stepper-App (eigene Screen-Komponente
   pro CFF-Abschnitt, z. B. `ScreenAuthors.vue`, `ScreenLicense.vue`) mit
   AJV-artiger Validierung gegen `schema.json`; ca. 11 MB Quellcode, eigener
   Cypress-/Jest-Unterbau. Eine 1:1-Nachbildung dieses Stacks wäre ein großes,
   eigenständiges JS-Projekt und würde vom sonst Python/Jinja2/Pyodide-
   geprägten Familienmuster (siehe `wdt-sparql`) abweichen → Entscheidung
   nötig, siehe S0.
6. Lizenz-/Autorenkonvention aus `fdo-squirrel` übernehmbar: Florian Thiery,
   ORCID `0000-0002-3246-3531`, Research Squirrel Engineers Network, MIT.
7. `raw.githubusercontent.com` liefert für die Schema-Datei
   `access-control-allow-origin: *` (geprüft 2026-09-03 per `curl -I`) — ein
   clientseitiger `fetch()` aus dem Browser funktioniert also ohne Proxy oder
   Backend. Das war die technische Voraussetzung für die S0-Entscheidung
   „Live-Fetch" unten.

**Befunde 8–14 aus einem Handoff der `fdo-squirrel`-Session (fünf Patches,
zuletzt Commit `25cf916`) — von dort selbst am echten Code verifiziert und
hier zusätzlich am eigenen frischen Klon von `main@25cf916` unabhängig
nachvollzogen (geprüft 2026-09-03):**

8. ~~`identifiers` (MD.cff) ist komplett tot~~ — **überholt seit Commit
   `b7b6e58` ("Fix MD.cff identifiers never producing any RDF"), geprüft
   2026-09-03.** War bis dahin korrekt (Crosswalk befüllte `cw.identifiers`
   nie; `fdo_rdf.py` suchte ohnehin falsche Keys). Jetzt über denselben
   mapping-getriebenen Dispatcher wie `keywords`/`related_resources`
   verdrahtet, liest direkt aus dem rohen `identifiers`-Feld. Selbst
   end-to-end durchgetestet (drei Einträge `doi`/`url`/`orcid` durch
   `md_cff_to_crosswalk` + `crosswalk_to_rdf_turtle` gejagt → drei
   `dct:identifier`-Tripel). Verhalten, das für die UI relevant ist: `doi`
   wird zu `https://doi.org/<value>` kanonisiert, ein `value`, der schon mit
   `http(s)://` beginnt, wird direkt als IRI übernommen — alle anderen
   Schemes (`orcid`, `ror`, `handle`, `ark`, `isbn`, `issn`, `swhid`,
   `other`) bleiben **literale Strings**, keine automatische URI-Bildung
   (bewusste Entscheidung laut Commit-Message, keine sichere generische
   Regel). → **v0.1 des Formulars: Feld aufnehmen**, mit Hinweistext, dass
   nur `doi` und bereits-vollständige URLs zu klickbaren IRIs werden.
9. `distributions` (MD.cff-eigenes Feld) kommt in
   `schemas/md_cff/crosswalk_md_cff_to_rdf.yaml` an keiner Stelle als
   Mapping-Eintrag vor (0 Treffer). Reale Distributionen im `.ttl` werden
   ausschließlich aus dem ZIP-Inhalt berechnet (Dateiname, Größe, SHA256 —
   automatisch). → **Keine UI-Fläche nötig, das Feld beschreibt nichts, was
   die Pipeline nicht ohnehin selbst ableitet.**
10. `keywords`/`related_resources` waren bis Commit `25cf916` ebenfalls tot
    (der generische Emit-Dispatcher in `fdo_rdf.py` behandelte
    `multiple: true`-Listenwerte wie einzelne Dicts) — im Diff dieses
    Commits nachvollzogen (`multiple = bool(spec.get("multiple")); items =
    val if (multiple and isinstance(val, list)) else [val]`). Ab diesem
    Commit funktionieren beide Felder korrekt. → **v0.1 des Formulars kann
    beide bedenkenlos aufnehmen, vorausgesetzt der `fdo-squirrel`-Stand hat
    `25cf916` oder neuer.**
11. Drei geschlossene Vokabulare (`enum` + `additionalProperties: false` im
    Elternobjekt, Freitext würde also unklare Validierungsfehler
    produzieren):

    | Feld | Erlaubte Werte |
    |---|---|
    | `fdo_type` | `fdo:SoftwareFDO`, `fdo:AnalysisFDO`, `fdo:3DDataFDO` |
    | `identifiers[].scheme` | `doi`, `url`, `orcid`, `ror`, `handle`, `ark`, `isbn`, `issn`, `swhid`, `other` |
    | `related_resources[].relation` | `isSupplementTo`, `isReferencedBy`, `references`, `isPartOf`, `hasPart`, `isDerivedFrom`, `isDocumentedBy` |

    `fdo_type` ist zusätzlich funktional relevant: steuert in
    `classification_rules.yaml`, welche Rolle jede ZIP-Datei bei der
    RDF-Generierung bekommt.
12. Wiederkehrendes Baumuster `{label, id?}` (`$defs/idLabelEntityOptionalId`
    im Schema) in sechs Feldern: `license`, `publishers[]`, `creators[]`,
    `contributors[]`, `keywords[]`, `heritage_object.object_type`/`.material`
    — lohnt sich als **eine** UI-Komponente statt sechsmal einzeln gebaut.
    Ausnahme: `spatial` — dort liegen `id`/`label` als direkte
    Geschwisterfelder auf dem `spatial`-Objekt selbst (`$defs/spatialExtent`),
    nicht in diesem verschachtelten Muster.
13. `spatial.lat`/`.lon`-Datentyp-Bug (ganzzahlige Koordinate kam als
    `xsd:integer` statt `xsd:decimal` raus) ist seit `25cf916` gefixt — im
    Diff von `_ttl_lit()` nachvollzogen. Für einen `fdo-squirrel`-Stand ab
    diesem Commit braucht der Generator keinen Workaround; nur gegen ältere
    Kopien getestet kann das kurz verwirren.
14. `spatial.bounding_box` hat ein strenges Pattern (vier komma-getrennte
    Zahlen, Reihenfolge **west,south,east,north**) — ein 4-Zahlenfelder-
    Formular ist hier robuster als ein Freitextfeld.

**Befunde 15–19 zu einer möglichen `MD.cff` → `CITATION.cff`-Ableitung für
Nicht-Software (geprüft 2026-09-03, gegen
`citation-file-format/citation-file-format@main`, `schema-guide.md`):**

15. CFF unterstützt offiziell `type: dataset` (neben `software`, Default
    `software`). Pflichtfelder sind nur vier: `authors`, `cff-version`,
    `message`, `title` — alles Weitere optional.
16. Es gibt bereits ein echtes Präzedenzbeispiel **im `fdo-squirrel`-Repo
    selbst**: `example_fdo/CITATION.cff` nutzt schon `type: dataset` für ein
    3D-Werk, mit vollem `person`-Autor (`given-names`/`family-names`/
    `orcid`). Bestätigt genau die von dir beschriebene Praxis.
17. `authors` akzeptiert gemischt `person`-Objekte
    (`given-names`+`family-names`, optional `orcid`/`website`) oder
    `entity`-Objekte (`name`, optional `orcid`/`website`). MD.cffs
    `{label, id?}`-Muster (Befund A1.12, genutzt für `creators`/
    `publishers`) unterscheidet aber nicht Person/Organisation und trennt
    Namen nicht in Vor-/Nachname — eine automatische Ableitung muss also
    entweder raten (z. B. Komma-Split „Nachname, Vorname" → `person`) oder
    generisch als `entity` (nur `name`) emittieren. Entscheidung nötig.
18. `identifiers[].type` in CITATION.cff kennt nur vier Werte (`doi`, `url`,
    `swh`, `other`) — MD.cffs `identifiers[].scheme` (Befund A1.11) kennt
    zehn. 1:1 nur für `doi`/`url`, `swhid`→`swh`; die übrigen sechs
    (`orcid`, `ror`, `handle`, `ark`, `isbn`, `issn`, `other`) müssten auf
    `other` fallen (Original-Scheme ginge nicht verloren, wenn man es
    zusätzlich in CFFs optionales `description`-Feld pro Identifier
    schreibt).
19. CFF `authors` ist **required**, MD.cffs `creators` ist **optional**
    (nur `publishers` ist Pflicht, Befund A1 Schema). Eine Ableitung braucht
    also einen Fallback: `creators`, falls vorhanden, sonst `publishers`.

### A2 Zielbild

```
py/templates/index.html.j2          (Formular-Template, Quelle in diesem Repo)
        │  main.py rendert (kein Netz nötig, rein lokal)
        ▼
docs/index.html                     (statischer Initializer, GitHub Pages)
        │  beim Seitenaufruf im Browser:
        │  fetch() → raw.githubusercontent.com/.../MD.cff-schema.yaml
        │  (CORS erlaubt, Befund A1.7) → js-yaml parst → ajv2020 validiert
        ▼
Nutzer:in füllt Formular aus, Live-Validierung gegen das gerade geladene,
also immer aktuelle Schema
        ▼
MD.cff  (Download, YAML, per js-yaml serialisiert)
```

Eigenschaften, die das fertige Ding erfüllen muss (prüfbar):

- Jede über die Seite erzeugte `MD.cff`-Datei validiert fehlerfrei gegen das
  gerade von `fdo-squirrel` geladene Schema (mit demselben
  `jsonschema`-Code wie dort nachprüfbar).
- Kein Server nötig — die Seite läuft rein statisch auf GitHub Pages; das
  Schema selbst kommt live vom Browser aus, nicht vom Python-Build.
- `python main.py` baut die Seite deterministisch und **ohne Netzzugriff**:
  zwei Läufe → `git status` bleibt sauber. Das Schema wird nie in dieses
  Repo eingebettet, sondern ausschließlich zur Laufzeit im Browser geladen.
- Schlägt der Live-Fetch fehl (offline, GitHub nicht erreichbar), sagt die
  Seite das klar statt ein falsches/leeres Formular zu zeigen.

### A3 Querschnittsregeln

- Reuse = Kopieren, nicht Referenzieren — **Ausnahme hier laut S0-Beschluss:**
  das `MD.cff`-Schema wird bewusst *nicht* kopiert/vendort, sondern live
  referenziert (siehe A2, A4). Kein `data/raw/` für das Schema.
- Kein `datetime.now()` im Output; Datum kommt aus `RELEASE`-Konstante.
- Zweimal laufen lassen, `git status` muss sauber bleiben.
- Netzwerkzugriff nur an einer Stelle — hier aber bewusst **nicht** im
  Python-Build, sondern im Browser: `main.py` selbst braucht nie Netz, der
  Live-Fetch des Schemas passiert ausschließlich clientseitig beim
  Seitenaufruf (S0-Entscheidung, siehe A4). Das ist die Familienregel „ein
  Netz-Schritt, Rest offline" auf die Laufzeitumgebung übertragen.
- Kommunikation: informelles Deutsch; Code/README/Kommentare: britisches
  Englisch; Windows-`cmd`-Befehle, je einzeilig.

### A4 Beschlusslage

| Frage | Beschluss | seit |
|---|---|---|
| Welches `MD.cff`-Schema ist maßgeblich? | `schemas/md_cff/MD.cff-schema.yaml` aus `fdo-squirrel` (JSON Schema draft 2020-12) — das lädt `main.py` dort und validiert strikt dagegen. Das veraltete Root-File wird ignoriert. | 2026-09-03 |
| Tech-Stack für den Initializer | Statische Seite: einfaches HTML/JS, **kein** Vue/Quasar-Nachbau (Begründung: A1.5). Validierung mit AJV — da das Schema draft 2020-12 ist, wird `ajv/dist/2020` (Ajv2020) gebraucht, nicht das Standard-`Ajv` (das nur bis draft-07 kann). YAML-Handling (Schema parsen, Ausgabe serialisieren) mit `js-yaml`. Beide Libraries per CDN eingebunden, kein npm-Bundler nötig. | 2026-09-03 |
| Schema-Quelle | Live-Fetch von `raw.githubusercontent.com/Research-Squirrel-Engineers/fdo-squirrel/.../MD.cff-schema.yaml` bei jedem Seitenaufruf, clientseitig. Kein Vendoring, keine Kopie in `data/raw/`. Technisch bestätigt durch Befund A1.7 (CORS erlaubt). Offene Frage dazu in Teil D: welcher Branch/Tag wird referenziert. | 2026-09-03 |
| Strenge / Legacy-Kompatibilität | Formular erzeugt ausschließlich schema-valide Dokumente (aktuelles Schema strikt) — kein Legacy-`publisher`-Singular, keine String-`license`, auch wenn der Crosswalk das toleriert. | 2026-09-03 |
| S7: wann `CITATION.cff` ableiten? | Automatisch, aber vorerst **nur** für `fdo_type: fdo:3DDataFDO` — nicht für `fdo:AnalysisFDO` (das kommt evtl. später, siehe Teil D). Kein manueller Knopf. | 2026-09-03 |
| S7: Autoren-Mapping | Immer als CFF `entity` (nur `name`, optional `orcid`/`website` aus `id`) — nie `person` mit geratenem Vor-/Nachname-Split. | 2026-09-03 |
| S7: Identifier-Scheme-Mapping | Alle sechs nicht direkt passenden MD.cff-Schemes (`orcid`, `ror`, `handle`, `ark`, `isbn`, `issn`) werden als CFF `type: other` übernommen; das ursprüngliche Scheme steht im `description`-Feld des jeweiligen Identifiers. | 2026-09-03 |

### A5 Was in welchem Chat hochgeladen wird

Solange nur `PRIMER.md` existiert, reicht das Hochladen der Datei selbst.
Sobald der Skeleton (S1) steht:

```cmd
cd fdo-squirrel-md-generator && robocopy . ..\bundle /E /XD .git node_modules __pycache__ docs && cd .. && powershell Compress-Archive -Path bundle\* -DestinationPath bundle.zip -Force
```

Nicht hochladen: `.git/`, `node_modules/` (falls JS-Tooling dazukommt),
generierte `docs/`.

## Teil B — Schrittübersicht

| ID | Schritt | hängt ab von | Status |
|---|---|---|---|
| S0 | Festlegungen: Tech-Stack, Schema-Quelle, Strenge | — | erledigt 2026-09-03 |
| S1 | Skeleton: Repolayout, `main.py`, `CITATION.cff`, `LICENSE`, `requirements.txt` | S0 | offen |
| S2 | Client-seitiger Schema-Fetch + AJV2020/js-yaml-Grundgerüst in `docs/index.html` | S1 | offen |
| S3 | Kernformular: Pflichtfelder (`fdo_type`, `id`, `title`, `description`, `publishers`, …) | S2 | offen |
| S4 | Erweiterte Felder: `creators`, `identifiers`, `related_resources`, `distributions`, `spatial`, `temporal`, `heritage_object`, `technique` | S3 | offen |
| S5 | Preview & Export (YAML-Vorschau, Download) | S3 | offen |
| S6 | GitHub Pages Deployment | S3 | offen |
| S7 | `CITATION.cff` aus `MD.cff` ableiten (automatisch für `fdo_type: fdo:3DDataFDO`) | S3 | offen |

S3–S6 können teilweise parallel laufen, sobald S2 steht; S4 ist keine
Voraussetzung für einen ersten nutzbaren Stand.

## Teil C — Die Schritte

### S0 — Festlegungen

**Ziel:** Tech-Stack, Schema-Handling und Strenge sind entschieden und in A4
bestätigt (kein „Vorschlag" mehr).

**Uploads:** keine zusätzlichen.

Offene Fragen siehe Formular im Chat; Antworten wandern mit heutigem Datum
in A4.

**Abnahme:** A4 enthält zu diesen drei Fragen keine „Vorschlag"-Zeile mehr.

### Erledigt 2026-09-03

Entschieden: leichtgewichtige statische Seite (kein Vue/Quasar), Schema per
Live-Fetch (kein Vendoring), streng schema-konforme Ausgabe. Das ändert A2
(kein `data/raw/` mehr für das Schema, kein Netz im Python-Build) und S2
(wird zu „Fetch + AJV/js-yaml im Browser" statt „Python-Sync-Schritt") — beide
oben bereits angepasst. Neu aufgeworfen und nach Teil D verschoben: welcher
Branch/Tag/Commit von `fdo-squirrel` referenziert wird, und Fallback-Verhalten
bei nicht erreichbarem GitHub.

### S1 — Skeleton

**Ziel:** `python main.py --list` läuft und zeigt alle Schritte; `git status`
ist nach einem Lauf sauber.

**Uploads:** Standardbundle (A5).

Layout wie im primer-repo-Skelettmuster, angepasst: kein `img/`, dafür
`docs/` als Pages-Ziel.

**Abnahme:** `python main.py` läuft durch und meldet für jeden Schritt
„nothing to do"; `CITATION.cff`, `LICENSE`, `requirements.txt` vorhanden.

### S2 — Client-seitiger Schema-Fetch

**Ziel:** `docs/index.html` lädt beim Aufruf
`schemas/md_cff/MD.cff-schema.yaml` per `fetch()` von
`raw.githubusercontent.com` (URL fix verdrahtet, Branch/Tag siehe Teil D),
parst es mit `js-yaml`, validiert Formulareingaben live mit `ajv/dist/2020`
(Ajv2020 — Standard-Ajv kann kein draft 2020-12). Kein Python-Netzzugriff.

**Uploads:** Standardbundle.

**Abnahme:** Seite lokal öffnen (oder via GitHub Pages), Netzwerk-Tab zeigt
genau einen Request auf die Schema-URL, Schema wird geparst und im Formular
sichtbar (z. B. als Grundlage der Pflichtfeld-Liste aus S3). Kappt man das
Netz, zeigt die Seite eine klare Fehlermeldung statt eines leeren Formulars.

### S3 — Kernformular

**Ziel:** Formular für die sechs Pflichtfelder aus dem Schema
(`md_cff_version`, `fdo_type`, `id`, `title`, `description`, `publishers`),
Live-Validierung gegen das per S2 geladene Schema.

`fdo_type` als Dropdown (Befund A1.11 — drei feste Werte, zusätzlich
funktional wichtig für die Dateiklassifikation in `fdo-squirrel`).
`publishers` nutzt von Anfang an die gemeinsame `{label, id?}`-Komponente
(Befund A1.12), da sie in S4 an fünf weiteren Stellen wiederverwendet wird.
AJV-Fehlermeldungen für `enum`/`additionalProperties: false` sind kryptisch
(Handoff-Hinweis) — eigene Fehlertexte für genau diese beiden Fälle lohnen
sich hier schon, nicht erst in S4.

**Abnahme:** ein manuell ausgefülltes Minimalbeispiel validiert fehlerfrei
gegen das Schema (gleicher Check wie Befund A1.2, diesmal ohne Fehler).

### S4 — Erweiterte Felder

**Ziel:** restliche Schema-Properties abbildbar — mit Prioritäten aus den
Befunden A1.8–14:

- `keywords`, `related_resources`, `identifiers`: aufnehmen — funktionieren
  seit `25cf916` bzw. `b7b6e58` (Befunde A1.10, A1.8). Bei `identifiers`:
  Hinweistext, dass nur `scheme: doi` und bereits-vollständige URLs zu
  klickbaren IRIs werden, andere Schemes bleiben literale Strings.
- `distributions`: **keine UI-Fläche in v0.1** — wird automatisch aus dem
  ZIP abgeleitet (Befund A1.9).
- `creators`, `contributors`, `license`, `heritage_object.object_type`/
  `.material`: gemeinsame `{label, id?}`-Komponente aus S3 wiederverwenden.
- `spatial`: 4-Zahlenfelder-Eingabe für `bounding_box`
  (west,south,east,north, Befund A1.14) statt Freitext; `lat`/`lon` als
  normale Dezimalfelder — kein Workaround nötig, sofern der referenzierte
  `fdo-squirrel`-Stand `25cf916`+ ist (Befund A1.13).

**Abnahme:** ein vollständig ausgefülltes Beispiel (inkl. `heritage_object`,
`technique`) validiert fehlerfrei.

### S5 — Preview & Export

**Ziel:** Nutzer:in sieht eine YAML-Vorschau und kann `MD.cff` herunterladen.

**Abnahme:** heruntergeladene Datei ist byte-identisch mit der Vorschau.

### S6 — GitHub Pages Deployment

**Ziel:** Seite ist unter
`research-squirrel-engineers.github.io/fdo-squirrel-md-generator/` erreichbar.

**Abnahme:** Workflow läuft grün, Live-URL zeigt das Formular.

### S7 — `CITATION.cff` aus `MD.cff` ableiten

**Ziel:** Für `fdo_type: fdo:3DDataFDO` erzeugt die Seite automatisch (kein
Knopf, keine Nachfrage) zusätzlich eine gültige `CITATION.cff` aus denselben
Formulardaten — `fdo-squirrel` verlangt laut README ohnehin beide Dateien im
ZIP, Nutzer:innen sollen nicht beides von Hand parallel pflegen müssen
(Präzedenz: Befund A1.16). `fdo:AnalysisFDO` vorerst **nicht** eingeschlossen
(A4, Teil D).

Mapping (Befunde A1.15–19, Entscheidungen A4):

| CITATION.cff | ← MD.cff | Regel |
|---|---|---|
| `cff-version` | — | konstant `1.2.0` |
| `type` | — | konstant `dataset` (nur 3D-Data-Zweig) |
| `title` | `title` | direkt |
| `abstract` | `description` | direkt |
| `version` | `version` | direkt |
| `date-released` | `date_released` | direkt |
| `license` | `license.id` (SPDX) | direkt, falls vorhanden |
| `authors` | `creators`, Fallback `publishers` | immer als `entity` (`name` = `label`, `orcid`/`website` = `id` falls vorhanden) — nie Person-Split |
| `identifiers` | `identifiers` | `doi`→`doi`, `url`→`url`, `swhid`→`swh`; die übrigen sechs Schemes → `other`, Original-Scheme in `description` |
| `message` | — | Standardsatz für `dataset` |

**Uploads:** Standardbundle.

**Abnahme:** aus dem Ogham-Beispiel (Befund A1.16) erzeugte `CITATION.cff`
validiert gegen das offizielle CFF-Schema und ist inhaltlich gleichwertig
zur handgeschriebenen `example_fdo/CITATION.cff`.

## Teil D — Offene Punkte

- **Welchen Branch/Tag von `fdo-squirrel` referenziert der Live-Fetch?**
  `main` liefert immer den neuesten Stand, kann sich aber unter dem
  Initializer ändern, ohne dass jemand es merkt (anders als bei einer
  vendorten Kopie, wo eine Änderung als Diff sichtbar wäre). Ein Tag/Release
  wäre stabiler, aber müsste bei jeder `fdo-squirrel`-Version manuell
  nachgezogen werden. **Nicht mehr nur theoretisch:** während dieser
  Chat-Session sind auf `main` inzwischen drei neue Commits eingetroffen
  (`da3ba37`, `25cf916`, `b7b6e58`) — Letzterer behebt just den
  `identifiers`-Bug aus A1.8, während dieser PRIMER geschrieben wurde. Vor
  S2 entscheiden.
- **Eigenständiges `validate_md_cff.py`** wurde von der `fdo-squirrel`-Seite
  angeboten (CLI, kein Netzwerk, nur Schema-Check — nützlich für S5 und/oder
  CI). Annehmen und in S5 einplanen, oder mit eigener Zwei-Zeilen-Prüfung
  (`Draft202012Validator(...).validate(...)`) selbst bauen? Vor S5
  entscheiden.
- **S7 auf `fdo:AnalysisFDO` erweitern?** Bewusst vorerst nicht eingeschlossen
  (A4) — 3D-Daten sind der bekannte, tatsächlich genutzte Fall (Befund
  A1.16), bei Analysis-FDOs ist unklar, ob `type: dataset` genauso passt.
  Erst entscheiden, wenn ein echter Analysis-Anwendungsfall ansteht.
- **S7:** gegen welches CFF-Schema wird die abgeleitete `CITATION.cff`
  validiert — vendorte Kopie (CFF 1.2.0 ist ein stabiler, abgeschlossener
  Standard, anders als das sich noch bewegende `MD.cff`) oder aus Konsistenz
  zu S0 ebenfalls Live-Fetch? Vor S7 entscheiden.
- Soll `fdo-squirrel` selbst das veraltete Root-`MD.cff.schema.yaml`
  entfernen/umbenennen? Betrifft nicht dieses Repo direkt, aber die
  Verwirrung bleibt sonst bestehen — evtl. dort als Issue melden.
- Round-Trip: bestehende `MD.cff` wieder ins Formular laden (wie
  `LayoutUpdate.vue` im Vorbild)? Nicht in v0.1.
- Autocomplete für `publishers`/`creators`-IDs gegen Wikidata/ROR/ORCID (wie
  `EntityCardEditing.vue` im Vorbild)? Nicht in v0.1, evtl. später S4b.
- Mehrere Schema-Versionen parallel unterstützen, sobald `fdo-squirrel` eine
  v0.2 hat? Noch nicht real, erst entscheiden wenn es eintritt.
