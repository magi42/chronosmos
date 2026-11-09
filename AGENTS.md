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
- Timeline zoom changes only the horizontal time scale. Keep vertical positions,
  bar heights, text sizes and illustration proportions fixed, including while dragging.
- Bar dragging changes only vertical position unless Shift is held. Horizontal
  moves must shift captions, anchors, height periods and connected branch endpoints.
- Optional `heightPeriods` change bar thickness smoothly between start/end years;
  targets persist and periods cannot overlap. `heightAlignment` defaults to
  center; top and bottom preserve the respective initial edge. Optional `branches`
  connect two different bars at independent years. Share their geometry with anchors and exports.
- Viewer and Preview support drag-to-pan and click-to-enlarge overlays. Suppress
  enlargement after a pan gesture; a subsequent click anywhere closes the detail.
- Optional `captionYear` positions bar captions. Overlay `anchorBarId`, `year`
  and `offsetY` bind graphics to a year on a bar; preserve the absolute `y` fallback.
  Whole-bar moves shift anchor years and captions using historical ordinals;
  detaching or deleting the parent bar preserves the overlay's displayed position.
- Event `endBarId` and `endEdge` attach line endpoints to the shared bar section
  at the event year. Whole-bar time moves shift attached event years; deletion
  detaches to absolute `endY` without moving the endpoint.
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
