# Changelog

## Local customization snapshot

### Added

- Added switchable corporate SSO support with `local`, `hybrid`, and `corporate_sso` modes.
- Added corporate identity mapping metadata, super-admin mapping APIs, optional contact-table gating, and local auto-provision/linking flow.
- Added local corporate SSO helper docs plus mock provider, smoke test, contacts sync, and same-origin proxy scripts.
- Added a local development Docker Compose stack for Postgres, Redis, and MinIO.
- Added project folder metadata for bases, including arbitrary-depth folders and table-to-folder assignment.
- Added project folder meta APIs for list, create, update, and delete, with folder validation and empty-folder delete safeguards.
- Added sidebar folder UI with nested folders, nested tables, folder create/rename/delete actions, and table creation inside folders.
- Added a folder creation dialog that matches the existing table creation modal styling.
- Added table view indentation support so a table's grid/view entry is shown as a child under the table even inside nested folders.
- Added roadmap TODOs for self-hosted AI, dashboards, documents, workflows, version history, API-key governance, and MCP access.

### Changed

- Extended table metadata and SDK types with `fk_folder_id` so folder placement stays metadata-only and does not affect table schema.
- Kept link, lookup, and rollup behavior model-id based; folders only organize sidebar navigation.
- Updated signin/signup/password flows to respect corporate SSO auth-mode settings while preserving local login in hybrid mode.
- Hardened the local same-origin proxy against websocket/socket reset errors during frontend HMR or browser disconnects.

### Verified

- Backend TypeScript check passed with `tsc -p packages/nocodb/tsconfig.json --noEmit`.
- `git diff --check` passed after the final edits.
- Local runtime was verified with backend on `3010`, Nuxt frontend on `3012`, and same-origin proxy on `3014`.
- Folder creation, nested folders, table creation inside folders, and view indentation were verified in the local browser.
