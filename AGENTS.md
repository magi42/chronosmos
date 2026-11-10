# Chronosmos

- Keep historical year numbering consistent: -1 is 1 BCE, +1 is 1 CE, zero is invalid.
  The Python and JavaScript ordinal conversions must stay in agreement.
- `/manage` without a timeline shows the private chooser. `?timeline=ID` opens
  an editor; preserve the parameter through login. New timelines start unsaved.
- Dates support up to ±1 trillion years. Use adaptive horizontal coordinates and
  bounded ruler ticks; `timeUnit` controls labels and print-input units, while
  stored `mmPerYear` always means actual millimeters per year.
- Use the shared SVG renderer for editor, public view and SVG/PNG/print exports.
  Preserve actual SVG millimeter dimensions and embedded export illustrations.
- Visual exports have a horizontal zoom factor initialized from the current
  viewer/editor zoom each time the dialog opens. Use it consistently for SVG
  geometry, live print dimensions, PNG pixel sizing and print page dimensions.
  1× uses stored mmPerYear; text/media/vertical sizes remain fixed. JSON/package
  exports preserve the source composition without baking in the export zoom.
- Timeline zoom changes only the horizontal time scale. Keep vertical positions,
  bar heights, text sizes and illustration proportions fixed, including while dragging.
- Bar dragging changes only vertical position unless Shift is held. Horizontal
  moves must shift captions, anchors, height periods and connected branch endpoints.
- In the Bars tab, group branches beneath their source bar in collapsible lists;
  selecting or creating a branch keeps that tab active. Composition row gaps are 2 px.
- Properties Tab/Shift+Tab must commit pending edits and resolve focus after DOM
  replacement, including language selectors and height-period inputs; allow exit.
- Optional `labelInterval` and `minorTickInterval` are integer elapsed years;
  0 means automatic. `majorGrid` draws label-year lines behind content with
  short outward ticks at both axes. Bound tick counts and never introduce year 0.
- Optional `heightPeriods` change bar thickness smoothly between start/end years;
  targets persist and periods cannot overlap. `heightAlignment` defaults to
  center; top and bottom preserve the respective initial edge. Optional `branches`
  connect two different bars at independent years. Share their geometry with anchors and exports.
- Viewer and Preview support drag-to-pan and click-to-enlarge overlays. Suppress
  enlargement after a pan gesture; a subsequent click anywhere closes the detail.
- Bar `showCaption` defaults to true. False hides only the rendered caption
  and its layout margin; retain label/translations in all lists, selectors and data.
- Event `dotted` defaults to false. Draw round dots proportional to line width,
  with a continuous transparent editor hit target; use shared export rendering.
- Overlay type `brace` is a vertically stretched SVG curly bracket. Its middle
  caption is text, endpoints are topText/bottomText, each independently translated.
  Keep braceWidth/strokeWidth and font size fixed under horizontal zoom, support
  existing anchors, and preserve all three captions in viewer details and packages.
- Bar `captionPosition` supports inside/right/left/above/below/free. Outside
  captions are unclipped and horizontal margins must include their translated
  text at the chosen font size; `captionFontSize` defaults to auto. Caption drag
  switches to free positioning. Preserve horizontal-only zoom and print scale.
- Event `labelPosition` supports top/bottom/center/free; free uses labelY and
  labelOffsetX. Dragging event text must move the caption without moving the line.
- Package ZIP exports include the complete composition and referenced media only.
  Public exports use published snapshots; editor exports may include unsaved edits.
  Imports always create new drafts/media IDs and unused names/paths, preserving
  existing data. Validate archive members, sizes and PNGs before DB changes;
  never extract archive paths. Roll back installed files on import failure.
- Optional `captionYear` positions bar captions. Overlay `anchorBarId`, `year`
  and `offsetY` bind graphics to a year on a bar; preserve the absolute `y` fallback.
  Whole-bar moves shift anchor years and captions using historical ordinals;
  detaching or deleting the parent bar preserves the overlay's displayed position.
- Event `startBarId`/`endBarId` and `startEdge`/`endEdge` attach independent
  endpoints to shared bar geometry at one event year. `startAxis`/`endAxis`
  instead select top/bottom axes. Whole-bar time moves shift attached event years
  within both bars' active ranges; deletion detaches to absolute startY/endY.
  Preserve legacy y/height event lines and optional endBarId/endY documents.
- Plain title/description/label/text fields are the English base. Optional
  `translations[language][field]` supplies authored translations; missing or blank
  values fall back to English per field. Use the shared content lookup in headers,
  library cards, canvas labels, accessibility text, previews and exports.
- Each authored text input has its own English/Finnish editing-language selector.
  Keep editing-language selections independent of the page display language and
  of each other, and preserve pending text when switching languages.
- Editor access is provisioned server-side through the CLI. Do not add public
  registration, default credentials, or a public login link without a user request.
- Saving a draft must not change a published composition or its public path.
- Store illustration files outside the database; protect unpublished media.
- Run `.venv/bin/python -m pytest -q` and `npm test` for behavior changes.
  Node dependencies are development-only; production does not require Node.
- Read `chronosmos.local.json` (ignored by Git) for machine-specific paths.
  UpCloud deployment configuration is maintained under `services/chronosmos/`
  in the repository identified by its `upcloud_repository` setting. Read that
  repository's `AGENTS.md`, `README.md`, and current state before server changes. This project's
  `deploy/upcloud/` holds the initial preparation copy; the operational repository
  is authoritative after synchronization. Write operational documentation in Finnish.
- Do not commit secrets, runtime databases, media uploads or backups.
- Keep local checkout locations and workstation paths in ignored local configuration,
  never in tracked documentation, source, or artwork metadata. Use portable examples
  and repository-relative paths in public files.
- Deploy completed application changes to production by default, as requested by
  the user. Run the relevant checks, commit the release, use `scripts/deploy.py`,
  and verify the live site. Skip deployment only when the user explicitly requests
  local-only work or when a concrete deployment blocker must be reported.
- Production is authoritative for editor accounts, timelines and media after the
  initial migration. Never replace production data with a development database
  during subsequent deployments.
