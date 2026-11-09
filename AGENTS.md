# Chronosmos

- Keep historical year numbering consistent: -1 is 1 BCE, +1 is 1 CE, zero is invalid.
  The Python and JavaScript ordinal conversions must stay in agreement.
- Use the shared SVG renderer for editor, public view and SVG/PNG/print exports.
  Preserve actual SVG millimeter dimensions and embedded export illustrations.
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
