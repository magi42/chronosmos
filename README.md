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

- Use **+** next to the timeline selector to create a composition. Timeline
  settings control title, description, public path, date range, background,
  canvas height, scale placement, and millimeters per year.
- Add bars from the Bars tab. Set their dates, position, height, foreground and
  background colors, start/end fade durations, and optional merge target. A merge
  ends at the bar's end year, uses a cubic spline, and blends into the target color.
  The target must exist at that year; circular merges are rejected.
- Add text, boxes and illustrations from Overlays. Text supports line breaks and
  wraps within its configured width. Adjust position, dimensions, color and font
  size in Properties. Captions are also editable directly as bar properties.
- Upload PNG, JPEG or WebP illustrations to the media library. Images are decoded,
  stripped of metadata, and stored as PNG files, up to 4096 pixels per dimension.
  Uploads are limited to 12 MiB / 20 megapixels. Active SVG uploads are deliberately
  not accepted; rasterize SVG illustrations before uploading.
- Add Events for vertical lines with independent year, position, height, width,
  color, caption and under/over placement.
- Select layers or canvas objects to edit them. Drag to move them horizontally
  and vertically. Use Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z for undo/redo, Ctrl/Cmd+S to
  save, and Delete to remove a selected element. The inspector offers duplication.
- Zoom horizontally with the controls or Ctrl/Cmd+scroll. Bar heights, vertical
  spacing, type sizes and illustration dimensions stay fixed. Fit shows the entire width. The ruler
  adds century, decade and annual ticks as you zoom in.
- **Save draft** persists editing changes. **Publish** saves and replaces the
  public snapshot. **Preview** shows the current draft without editing controls.
  **Unpublish** is in Timeline settings and keeps the editable draft.
- Each public path is unique, e.g. `/traditions` or `/history/religions`. A path
  change only affects the public page on publication. The previous public path
  remains reserved until then. Conflicting saves from other sessions are rejected
  instead of overwriting data. Download JSON before reloading after a conflict.

The interface supports English and Finnish. On first visit, Finnish is selected
when it is among the browser's preferred languages; otherwise English is used.
The language button stores an explicit preference in the browser. Authored content
is preserved in its original language.

## Dates and exports

Years use historical numbering: `-1` is 1 BCE, `1` is 1 CE. There is **no year
zero**. Their positions are one year apart. Bar and fade durations count elapsed
years across this boundary. `ordinal()` in Python and JavaScript implements this
mapping consistently.

**SVG** is a standalone vector export with embedded illustration data and physical
width/height in millimeters. The horizontal year distance exactly matches the
configured mm/year. Canvas height and type scale proportionally; the displayed
print dimensions include the outer canvas margins. Print at **100% / actual size**
to retain the scale. Very large timelines may need a large-format printer or
tiling in an external print application.

**PNG** uses the selected 96, 150 or 300 DPI to calculate pixel dimensions from
the print size. Exports are limited to 50 megapixels and 30,000 pixels per edge
to keep browser memory bounded; use SVG for larger work. Browser PNG metadata may
report 96 DPI even at higher pixel dimensions. Use SVG for dimension-critical print.

**Print / Save as PDF** uses the browser print dialog and custom page dimensions;
browser/printer page-size limits still apply. **JSON** preserves the editable
version 1 composition. Import validates its structure before displaying it.
JSON references library media by ID; it does not include the image files. Back up
the database and filesystem media together when moving the complete installation.

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
