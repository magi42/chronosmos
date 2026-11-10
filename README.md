# Chronosmos

A web editor for horizontal timelines, with an SVG canvas shared by the editor,
public viewer and exports. Python/Flask serves the application; the frontend uses
native JavaScript modules and CSS, with no frontend build step or CDN dependency.

## Run locally

Requires Python 3.10+.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m flask --app wsgi init-db --demo
.venv/bin/python -m flask --app wsgi set-password YOUR_USERNAME
.venv/bin/python -m flask --app wsgi run --port 8042
```

Open `http://127.0.0.1:8042/`. The example is at `/traditions`.
Visit `/manage` directly to sign in and edit. Public pages do not advertise the
login. There is no registration endpoint, default account or default password.
The password command prompts privately; passwords must have at least 12 characters.
Run `remove-user USERNAME` to revoke access. Changing a password also revokes that
user's existing sessions.

Local data, a persistent development signing key, and uploaded images are stored
in the ignored `instance/` directory. `init-db` without `--demo` starts with an
empty library. Schema creation is idempotent; it does not reset existing data.

## Compose and publish

- Open **/manage** to choose any draft or published timeline for editing. Use
  **New timeline** to create a composition, or **+** beside the editor selector.
  An editor can be linked directly as `/manage?timeline=ID`. Timeline
  settings control title, description, public path, date range, background,
  canvas height, scale placement, and millimeters per year.
- Add bars from the Bars tab. Set their dates, position, height, foreground and
  background colors, start/end fade durations, and optional merge target. A merge
  ends at the bar's end year, uses a cubic spline, and blends into the target color.
  The target must exist at that year; circular merges are rejected.
- In a bar's Properties, use **Add height-change period** to set a start year,
  end year and target height. Each non-overlapping period changes the thickness
  with a smooth cubic spline; the new height remains until the next period.
  Changes are centered on the bar by default. **Height-change alignment** can
  instead preserve the top or bottom edge. Captions and connections use the same
  height geometry in the viewer and exports.
- In **Bars**, select a source bar and use **Add branch** to connect it to a year
  on another bar. Branches appear beneath their source in a collapsible list.
  Composition rows have a 2 px gap. Both bars continue independently. The ribbon
  uses the bars' endpoint heights and
  blends their colors; forward, reverse and same-year connections are supported.
  Ribbon thickness is measured across the curve: equal bar heights stay constant,
  while differing heights blend smoothly between the two attachment points.
- Move a bar caption horizontally by dragging its text, or set **Caption year**
  in Properties. Choose **Bar caption position** to place it inside, right, left,
  above, below or freely relative to the bar. Captions outside the bar are not
  clipped; horizontal canvas margins expand to contain them. **Caption text size**
  defaults to Auto and can be set to a fixed font size. Caption color and offsets
  are editable separately. Dragging a caption switches it to free positioning.
  Uncheck **Show bar caption** to hide the text on the canvas and in exports.
  Its caption and translations remain the bar's name in the composition tree,
  anchor choices, merge choices and other selectors. Drag the colored bar itself
  to move the whole bar.
- Add text, boxes and illustrations from Overlays. Text supports line breaks and
  wraps within its configured width. Adjust position, dimensions, color and font
  size in Properties. Captions are also editable directly as bar properties.
- Use **Overlays → Curly bracket** to group items with a vertically stretchable
  brace. Set its height, overall width, bracket width, line width, color and font
  size. Separate **Top caption**, **Middle caption (right)** and **Bottom caption**
  fields each support English and Finnish. Leave a caption blank to omit it.
  The brace uses vector curls and straight arms so changing its height preserves
  line width and text size. Brackets can be moved, duplicated, anchored to bars,
  enlarged in the viewer and included in every export and timeline package.
- For text, boxes, brackets and illustrations, choose **Anchor to time bar**, an **Anchor
  year** within that bar, and an **Offset from bar top**. Negative offsets place
  items above the bar. Anchors follow its vertical position and merge curve;
  moving the whole bar also shifts anchor years and captions by the same elapsed
  years, including across 1 BCE / 1 CE. Resizing a bar clamps anchors to its date
  range. Choose **Free position** to detach an overlay without moving it; deleting
  its bar also detaches it and preserves its position.
- Upload PNG, JPEG or WebP illustrations to the media library. Images are decoded,
  stripped of metadata, and stored as PNG files, up to 4096 pixels per dimension.
  Uploads are limited to 12 MiB / 20 megapixels. Active SVG uploads are deliberately
  not accepted; rasterize SVG illustrations before uploading.
- Add Events for vertical lines with independent year, position, height, width,
  color, caption and under/over placement. Choose the **Line source** and **Line
  target** independently: the top axis, bottom axis, a time bar, or a free
  position. Bar endpoints can meet the top, center or bottom of the bar at the
  event year. Both bars must exist at that year. Endpoints follow bar movement,
  height changes and merges; deleting a bar preserves its endpoint as a free
  position. Axis endpoints follow the axis when the canvas height changes.
  Set **Event caption position** to top, bottom, center or free. Free captions
  have an editable vertical position and horizontal offset; dragging the text
  places it freely without moving the event line. Enable **Dotted line** for
  round dots; the default remains a solid line.
- Select layers or canvas objects to edit them. Drag a bar vertically by default;
  hold **Shift** to also move it in time. Its height-change periods, captions,
  anchored graphics, event lines and branch endpoints move with it. Overlays can be dragged
  freely. Use Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z for undo/redo, Ctrl/Cmd+S to
  save, and Delete to remove a selected element. The inspector offers duplication.
  **Tab** and **Shift+Tab** commit a field and move forward or backward through
  Properties, including translated text and height-change periods.
- Zoom horizontally with the controls or Ctrl/Cmd+scroll. Bar heights, vertical
  spacing, type sizes and illustration dimensions stay fixed. Fit shows the entire width. The ruler
  adds century, decade and annual ticks as you zoom in. In Timeline settings,
  set **Axis label interval** and **Minor tick interval** in actual years (for
  example 1000 and 100). A value of 0 uses automatic spacing. **Major ticks in
  background** adds vertical guides at label years behind the composition,
  spanning the two axes with short ticks beyond each axis. Dense labels are
  hidden until zoomed in, and very dense tick sets are bounded for long spans.
- **Save draft** persists editing changes. **Publish** saves and replaces the
  public snapshot. **Preview** shows the current draft without editing controls.
  **Unpublish** is in Timeline settings and keeps the editable draft.
- In the public viewer or editor Preview, drag with the mouse to pan the timeline.
  The bottom scrollbar has a larger handle. Click text, a box or an illustration
  to enlarge it; click anywhere again or press Escape to close the detail.
  Text boxes wrap using measured font widths, with explicit line breaks preserved.
- Each public path is unique, e.g. `/traditions` or `/history/religions`. A path
  change only affects the public page on publication. The previous public path
  remains reserved until then. Conflicting saves from other sessions are rejected
  instead of overwriting data. Download JSON before reloading after a conflict.

The interface supports English and Finnish. A `?lang=fi` or `?lang=en` URL
parameter takes precedence over saved preferences and browser detection; internal
navigation and login keep the chosen language. Otherwise it uses the browser's first
supported language preference. The language button stores an explicit preference.
The public timeline title, description and back navigation share a compact page
header so the timeline has more room.

English is the base language for authored content. In Properties, choose
**English (base)** or **Finnish** from the language selector above each title,
description, caption, text/box or event-label input. Each field selects its editing
language independently; switching preserves the text in both languages. Leave a
Finnish translation blank to show English. Use the page language button to preview
the chosen display language. The same per-field
fallback applies in the library, public viewer, editor preview and SVG/PNG/PDF
exports. JSON exports preserve the English fields and all translations together.
Existing timelines keep their current base text until edited.

## Dates and exports

Years use historical numbering: `-1` is 1 BCE, `1` is 1 CE. There is **no year
zero**. Their positions are one year apart. Bar and fade durations count elapsed
years across this boundary. `ordinal()` in Python and JavaScript implements this
mapping consistently. Dates from −1 trillion to +1 trillion years are supported.
For geological timelines, enter the actual year (for example `-65000000`), then
choose **Millions of years** for timescale labels. **Thousands of years** and
automatic labels are also available. Canvas coordinates and tick density adapt
to the date range, keeping long spans practical to view and edit. Print scale is
entered in millimeters per selected unit (for example 10 mm per million years);
the document always stores `mmPerYear`, and changing label units preserves it.

The Export dialog's **Horizontal stretch factor (%)** starts at the current
viewer or editor zoom expressed as a percentage. Set it before downloading SVG/PNG
or printing; the print dimensions update immediately. `100%` uses the configured
mm/year, and `200%` doubles horizontal
year spacing while keeping text, illustrations and vertical sizes fixed. The
export stretch does not change the saved composition or JSON/package contents.

**SVG** is a standalone vector export with embedded illustration data and physical
width/height in millimeters. The horizontal year distance matches the
configured mm/year multiplied by the stretch percentage divided by 100. Vertical
sizes and text use the timeline’s base print scale. The displayed
print dimensions include the outer canvas margins. Print at **100% / actual size**
to retain the scale. Very large timelines may need a large-format printer or
tiling in an external print application.

**PNG** uses the selected 96, 150, 300, 600 or 1200 DPI to calculate pixel dimensions
from the print size. Exports are limited to 50 megapixels and 30,000 pixels per edge
to keep browser memory bounded; use SVG for larger work. Browser PNG metadata may
report 96 DPI even at higher pixel dimensions. Use SVG for dimension-critical print.

**Print / Save as PDF** uses the browser print dialog and custom page dimensions;
browser/printer page-size limits still apply. **JSON** preserves the editable
version 1 composition. Import validates its structure before displaying it.
JSON references library media by ID; it does not include the image files. Back up
the database and filesystem media together when moving the complete installation.

**Package** downloads a `.chronosmos.zip` archive with all timeline settings,
texts/translations and referenced illustration files. Editor packages include the
current composition, including unsaved changes; public viewer packages contain
only the published snapshot. Use **Import timeline** in the editor or `/manage`
chooser to import a package. It creates a new unpublished draft and new media IDs;
name/path conflicts receive numeric suffixes, including paths reserved by an
older published snapshot. Existing timelines and media are preserved. Package
imports support up to 64 MiB and validate all members before creating the draft.
Archives are read without extracting their paths, and images are sanitized.
The portable format is a ZIP containing `manifest.json` (format
`chronosmos-package`, version 1), `timeline.json` (timeline format 1), and
`media/<media-id>.png` for each referenced image. A package contains only resources
used by that timeline; it does not include editor accounts or server configuration.

The supplied [original SVG](assets/religions-3000-fi.svg) and
[PNG reference](assets/religions-3000-fi.png) are preserved. The editable
[sample composition](examples/traditions.chronosmos.json) demonstrates the layout
and features; it is not a verified historical dataset or an automatic conversion
of the original SVG. General SVG-to-editable-object import is not implemented.

## Configuration and production

Production target: **https://chronosmos.magi.fi** on the existing UpCloud host.
Use PostgreSQL with a dedicated peer-authenticated role and database, immutable
application releases, Gunicorn at `127.0.0.1:8020`, Apache, and filesystem media.
No Node.js runtime is needed on the server.

The canonical server configuration lives under `services/chronosmos/` in a
separate UpCloud configuration repository. Its local checkout location belongs
in the ignored `chronosmos.local.json` file, not in tracked source or documentation.
[Prepared deployment files](deploy/upcloud/services/chronosmos/README.md) are
included here for review and synchronization; the operational copy in the server
repository is authoritative. Completed changes are deployed to production after
checks pass, unless local-only work is explicitly requested. Production accounts,
timelines and media are preserved when deploying application updates.

### Local workstation configuration

```sh
cp chronosmos.local.example.json chronosmos.local.json
```

Set `upcloud_repository` to your local UpCloud configuration checkout and
`ssh_host` to its production SSH alias. Optional
`source_checkout` and `reference_svg_export_filename` settings retain local
working and artwork export locations. These settings are for development tools;
the web application uses the environment variables below. Keep workstation paths,
credentials and editor-specific configuration out of tracked files.

The deployment preparation helper reads the local setting by default:

```sh
python3 scripts/sync-upcloud.py
```

An explicit destination argument or `--config` file can also be supplied. The
helper refuses to overwrite operational files with different contents; review
changes in the canonical deployment repository after the initial synchronization.

After committing a release, deploy it with:

```sh
python3 scripts/deploy.py
```

This runs the checks, packages the committed source, uses the canonical server
configuration, installs an immutable release, and verifies the public HTTPS site.
It never imports the development database during application updates.

| Environment variable | Meaning |
| --- | --- |
| `CHRONOSMOS_SECRET_KEY` | Long random production session signing key |
| `CHRONOSMOS_DATA_DIR` | Persistent data directory; defaults to `instance/` |
| `CHRONOSMOS_DATABASE_URL` | PostgreSQL connection string; empty selects local SQLite |
| `CHRONOSMOS_SECURE_COOKIES` | `1` for production HTTPS |
| `CHRONOSMOS_TRUST_PROXY` | `1` only behind the configured local Apache proxy |
| `CHRONOSMOS_HOSTS` | Comma-separated accepted hostnames |

`CHRONOSMOS_SECRET_KEY` signs session cookies and binds CSRF protection to the
session. Production deployment generates it once and preserves it on updates;
local development generates and persists a private `instance/secret.key` when
no environment value is supplied. To generate a value for a separate setup:

```sh
python3 -c 'import secrets; print(secrets.token_hex(32))'
```

Store that value only in private environment configuration. Keep it stable:
changing it invalidates existing login sessions. Environment-file editor
backups such as `.env~` are ignored too; never force-add them to Git.

See [.env.example](.env.example). Flask does not automatically load it: export the
variables or use the systemd EnvironmentFile. The application enforces CSRF tokens
on writes, checks editor authorization server-side, rate-limits failed logins in
the database, and prevents unreferenced draft media from being served publicly.
Published timeline content and its referenced images are intentionally public.
CSRF/session protections follow the [Flask security guidance](https://flask.palletsprojects.com/en/stable/web-security/).
Storage uses parameterized statements through the [Psycopg API](https://www.psycopg.org/psycopg3/docs/basic/usage.html).

## Verify

```sh
.venv/bin/python -m pytest -q
npm ci --ignore-scripts
npm test
```

Node.js 20+ is only used for development tests. The JavaScript suite uses jsdom
to exercise the editor and inspect generated SVG. It does not replace testing in
a real browser. To run the same server tests against a disposable PostgreSQL
database:

```sh
CHRONOSMOS_TEST_DATABASE_URL='postgresql:///chronosmos_test' .venv/bin/python -m pytest -q
```

The test account needs permission to create schemas. Each test creates and removes
its own schema; use a dedicated test database. Tests cover public/draft isolation,
publication and path changes, stale revisions, authentication, CSRF, rate limiting,
account revocation, media reference integrity, years, fades, spline geometry,
export dimensions, ruler placement, escaping, and editor interactions.

## AI-assisted editing

Configured editors can choose **New with AI** in `/manage`, or **AI assistant**
inside a timeline to research bars, joined periods and anchored events, or fill
missing Finnish translations. Documented marriages can become joined periods;
individual events connect an axis to a bar, and interpersonal events connect
the two people’s bars. The server uses OpenAI's Responses
API with `gpt-6.1-sol`, mandatory web search and a structured proposal. Review
all proposed years, uncertainty notes and clickable sources, select the additions,
then apply them to the unsaved draft. Saving and publishing remain explicit.
English remains the base language. New titles, descriptions and captions receive
Finnish translations by default. The assistant also proposes missing Finnish texts
on existing content, field by field, without replacing authored translations. Use
**Fill missing Finnish translations** for a translation-only request without web
research or dated additions. Deselecting a new bar disables connections that need it.
AI research cannot replace/delete existing bars or publish a timeline.

The normal deployment initializes the additive `ai_jobs` and `ai_job_context` tables automatically.
For an existing local database, run the usual `flask --app wsgi init-db` command.

Set `OPENAI_API_KEY` in the server's private environment file. For deployment,
put `OPENAI_API_KEY=...` in the ignored local `.env` (never in Git or chat), then
run `python3 scripts/configure_openai.py`. It reads the SSH target from ignored
local configuration, restricts the local file to mode 0600, transfers the key
only through SSH stdin, atomically updates the private server environment,
and restarts Chronosmos. With no file/key, it asks via a hidden terminal prompt.
No API key is sent to browsers or included in timeline exports/packages.

Requests and the existing timeline's texts, translations, dates and connections
are sent to OpenAI. Media, login credentials and unrelated content are excluded. API
usage is charged to the configured OpenAI account. Background research is
polled by authenticated editors; one pending job per account is allowed.
Completed proposals are cached privately until the next request. OpenAI
background requests use `store=false`; provider retention rules still apply.
Sources are preserved as bar, joined-period and event `research` metadata and
in timeline packages. Each proposal is validated against its private source
draft snapshot before review; the snapshot is removed when its job is replaced.
The server requires each source URL to have been returned by web research;
editors must still check whether it supports the dates and interpretation.

## Joined periods

Select a bar, then **Properties → Joined periods → + Joined period**. Choose
its peer bar, start/end years and transition length in elapsed years. The
transition uses smooth splines inside either end of the period; between them
the bars share a seam and each contributes half its normal thickness. Unequal
bar heights and thickness changes are retained proportionally. Outside the
period they resume their normal geometry. Periods must fit both bars and
cannot overlap another joined period on either bar or an end merge when saved.
While editing, conflicting values are retained: an inline warning explains the
conflict, and that period is temporarily omitted from the canvas. Change the peer
and dates in either order, then resolve conflicts before saving or publishing.

Drag the shared section to move both bars vertically; Shift also moves both
in time, including anchors and the joined interval. Drag outside it to move a
single bar. Single-bar horizontal moves keep joined dates within both bars.
The same geometry drives anchors, event endpoints, viewing and visual exports.

## Screen zoom

**100%** fills the available timeline width, including for short ranges such as
1902–2026. **Fit** resets to 100%. Zoom is relative to that responsive fit and
changes only horizontal time coordinates; vertical layout, text and images keep
their sizes. Resizing the window retains the relative percentage.

Screen fitting does not change stored `mmPerYear`. SVG/PNG/print still use that
physical print setting, with the export horizontal stretch initialized from the
relative screen zoom (100% at Fit). The editor and viewer display this distinction.
