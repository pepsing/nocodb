# TODO

## Switchable corporate SSO and local identity mapping

Context:

- The `pr_review` repo already has a reusable pattern for company SSO: an `AUTH_ENABLED` switch, SSO login/callback/token exchange, claim normalization, server-side session cookies, frontend route guards, and local employee-code allowlist checks.
- NocoDB should not copy the FastAPI/Next.js implementation directly, but should reuse the architecture: provider adapter, runtime config, route guard, session bridge, and local identity mapping.
- This must be switchable: when disabled, NocoDB keeps the normal local/email login flow; when enabled, browser users authenticate through the company login service.
- Machine access should stay separate from browser SSO and use API keys/service accounts.
- We need a local table to match company SSO users to NocoDB users, roles, and workspace/base memberships.

Tasks:

- [ ] Add an auth mode switch, e.g. `local`, `corporate_sso`, and optionally `hybrid` for break-glass local admin access.
- [ ] Add company SSO provider configuration: base URL, login path, token path, app key, app secret, redirect URI, claim names, TLS verification, token-signature verification, cookie settings, and debug logging.
- [ ] Implement company SSO login, callback, state validation, token exchange, claim decoding, logout, and `/me` endpoints in the NocoDB backend.
- [ ] Normalize SSO claims into a stable identity object: subject, employee code, display name, email, department, and raw claims.
- [ ] Add a local identity mapping table, e.g. `nc_corp_identity_mappings`, keyed by provider + subject / employee code, linked to the NocoDB user id.
- [ ] Support allowlist mode: users must exist in the local mapping table before login succeeds.
- [ ] Support optional auto-provision mode: first SSO login can create or link a NocoDB user after passing domain/employee-code rules.
- [ ] Store mapping status, roles, default workspace membership, last login time, last claims snapshot, disabled flag, and audit metadata.
- [ ] Add admin UI for importing, searching, linking, disabling, and auditing corporate identity mappings.
- [ ] Integrate SSO identities with existing NocoDB workspace/base roles, teams, permissions, audit logs, and user display components.
- [ ] Ensure API keys, service accounts, MCP tokens, webhooks, and background jobs bypass browser SSO but remain scoped and auditable.
- [ ] Add tests for auth-mode switching, login callback errors, claim mapping, employee-code allowlist denial, user linking, logout, cookie expiry, and local fallback.

## Self-hosted AI capability

Context:

- The local CE source build does not currently expose usable AI / NocoAI entry points.
- Official NocoAI covers natural-language creation or recommendation for bases, tables, fields, views, filters, formulas, and select options.
- Official NocoAI is Cloud Plus+ by default; self-hosted AI requires configuring a private AI integration on higher plans.
- The codebase already contains AI surface area: AI Text / AI Button field metadata, plan feature flags, backend schema entries, and core AI integration abstractions.
- `packages/noco-integrations/README.md` references provider packages such as `ai-openai`, but this checkout only contains `packages/noco-integrations/core`.
- Current UI gating hides non-database integration categories in the CE path.

Tasks:

- [ ] Add a self-hosted AI provider implementation, starting with OpenAI-compatible endpoints.
- [ ] Add provider configuration UI for model, base URL, API key, and capability selection.
- [ ] Wire the AI integration into existing AI Text / AI Button field flows.
- [ ] Expose useful NocoAI actions for generating bases, tables, fields, views, filters, formulas, and select options.
- [ ] Add natural-language querying over tables and views, with generated filters/sorts/aggregations previewed before execution.
- [ ] Add AI-assisted text generation, summarization, translation, and classification for selected records and document blocks.
- [ ] Add AI-driven automation suggestions that can create workflow drafts from a user prompt.
- [ ] Add an internal prompt/tool contract so AI actions can call table metadata, records, documents, dashboards, and workflows through audited APIs.
- [ ] Decide how MCP-based AI access should fit with the self-hosted build.
- [ ] Add tests around provider config validation, prompt execution, token/error handling, and UI gating.

## Unified change history, versioning, and rollback

Context:

- The current CE build has record-level audit/revision traces and undo / redo plumbing, but no complete table/base version rollback workflow.
- Official record Revision History is read-only: it shows who changed a record and when, but does not provide record-version restore from that panel.
- Official NocoDocs has true document Version History: saved versions, diff preview, author/time, and restore.
- Official Base Snapshots are point-in-time backups, but restoring a snapshot creates a new base; the current base is not modified.
- Official Base Trash can restore deleted records, tables, views, fields, dashboards, widgets, workflows, scripts, and extensions within retention, but it is recovery from deletion rather than arbitrary version rollback.
- The desired capability is closer to DingTalk-style version management: inspect modification history with before/after values and restore a selected historical state safely.

Tasks:

- [ ] Add a unified history timeline at base, table, view, field, record, document, dashboard, workflow, and script levels.
- [ ] Store before/after values for record data, links, attachments, field definitions, view settings, table schema, document content, dashboard widgets, workflow definitions, and script code.
- [ ] Support rollback for a selected record revision, including links/lookups/attachments where possible.
- [ ] Support rollback for selected field/view/table/base versions, with dependency and conflict checks before applying changes.
- [ ] Support document version history with diff preview and restore, aligned with NocoDocs behavior.
- [ ] Support base snapshots for long-term point-in-time backups, with both official-style restore-as-new-base and an internal restore-in-place option after diff confirmation.
- [ ] Support base trash as deletion recovery for records, tables, views, fields, dashboards, widgets, workflows, scripts, documents, and extensions.
- [ ] Add a preview diff before rollback, including fields/records that will be changed, deleted, restored, or conflicted.
- [ ] Keep rollback itself auditable, including operator, source revision, affected rows/fields, and timestamp.
- [ ] Define retention policy and storage limits for revision data.
- [ ] Add permission checks: who can browse history, view old values, restore records, restore schema, restore documents, and restore base-level snapshots.

## Self-hosted workflows and scripts

Context:

- NocoDB SaaS / licensed self-hosted editions expose Workflows and Scripts for automation.
- The current CE source build contains workflow schema, API descriptions, translations, and navigation traces, but the actual UI stores and backend model are stubbed out.
- Workflows should be treated as a first-class automation layer, not just webhooks.

Tasks:

- [ ] Restore/implement workflow CRUD for self-hosted CE-derived builds.
- [ ] Add the workflow tab, list, editor canvas, create modal, and execution history UI.
- [ ] Support trigger nodes such as manual trigger, schedule, record created, and record updated.
- [ ] Support action and flow nodes, starting with NocoDB record operations, webhook/API calls, conditional branches, and loops.
- [ ] Add script management and script execution as an optional workflow action.
- [ ] Add workflow execution storage, status tracking, logs, retries, and retention policy.
- [ ] Ensure workflows execute under an explicit permission context and are fully auditable.

## First-class API access and API key governance

Context:

- Local integration and migration tasks should not depend on a browser session, copied JWT, or manually generated runtime token.
- Self-hosted deployments need stable machine-to-machine access for import/export, automation, AI agents, sync jobs, and external systems.
- API credentials should be managed as product objects with explicit ownership, scope, expiry, rotation, and audit trails.

Tasks:

- [ ] Add API key CRUD for users and service accounts.
- [ ] Support scoped keys at workspace, base, table, view, and operation levels.
- [ ] Add key expiry, rotation, disable/revoke, last-used timestamp, and secret hashing.
- [ ] Add request auditing for API key usage, including actor, key id, source IP, endpoint, status, and affected resource.
- [ ] Add rate limits and optional per-key quotas.
- [ ] Add a service-account model for unattended jobs, separate from human browser sessions.
- [ ] Expose API key management UI under workspace/base settings.
- [ ] Provide documented REST examples for table metadata, records, links, lookups, attachments, import/export, and workflow triggers.
- [ ] Add tests for permission scope enforcement, revocation, audit logging, and leaked/invalid key handling.

## Self-hosted NocoDocs and document tree

Context:

- The current CE source build does not expose a usable in-project document creation flow.
- The frontend document store is stubbed and returns empty/null results.
- The backend document model/service is also stubbed, so forcing the UI entry open would not create real documents.
- Official NocoDocs positions documents as first-class base content, shown alongside tables and dashboards.
- Official NocoDocs includes a nested document tree, drag-and-drop reordering, rich block editing, attachments, embeds, comments, AI assistant, version history, export, public sharing, and document permissions.

Tasks:

- [ ] Implement document CRUD in the backend, including list, get, create, update, delete, and reorder.
- [ ] Add the project document creation entry and document navigation UI.
- [ ] Add a nested document tree with parent/child relationships, order, icon/cover metadata, lazy loading, expand/collapse state, active document highlighting, and breadcrumb navigation.
- [ ] Support drag-and-drop document reorder, move between parents, duplicate, rename, and subtree delete safeguards.
- [ ] Define document storage format, ownership, permissions, and audit behavior.
- [ ] Support rich block editing: headings, lists, callouts, code blocks, math equations, tables, slash commands, collapsible headings, and links to tables/records/views/dashboards.
- [ ] Support media and embeds: file attachments, images, videos, external embeds, URL preview cards, and embedded NocoDB shared views.
- [ ] Add document-level permissions for visibility and editing, inheriting from base roles by default.
- [ ] Add realtime collaboration with presence/cursors, plus an opt-out single-user autosave mode for self-hosted deployments.
- [ ] Add inline comments, threads, reactions, and comment count sync.
- [ ] Add document version history with author/time, diff preview, restore, and retention policy.
- [ ] Add search and replace inside documents, document-tree search, and full-text indexing for AI retrieval.
- [ ] Add document export to Markdown, HTML, and PDF.
- [ ] Add public document sharing with optional subtree sharing, revocation, and noindex public reader.
- [ ] Add tests for document permissions, persistence, tree ordering, realtime merge behavior, version restore, sharing, and export.

## Workspace navigation and organization

Context:

- The desired product shape is closer to a unified workspace where tables, views, documents, dashboards, workflows, and scripts can be organized and found quickly.
- Official docs highlight document trees, view sections, bookmarks with folders, and sidebar navigation patterns.
- This should stay separate from the data schema: folders/sections organize UI objects and should not change underlying table/view data.

Tasks:

- [ ] Add a unified base sidebar tree that can show tables, views, documents, dashboards, workflows, and scripts under one navigable structure.
- [ ] Add view sections/folders for grouping many views under a table, including collapse/expand, reorder, color/icon, and move-to-section actions.
- [ ] Add personal bookmarks for workspace/base/table/view/document/dashboard/workflow/script targets.
- [ ] Add bookmark folders with colors, ordering, search, stale-target cleanup, and open-in-new-tab behavior.
- [ ] Add keyboard navigation and command palette search across the tree.
- [ ] Persist collapsed states per user where appropriate, while keeping shared structural ordering in backend metadata.

## Self-hosted dashboards and widgets

Context:

- The current CE source build hides dashboard creation behind enterprise UI gating.
- The frontend dashboard/widget stores are stubbed and return empty/null results.
- The backend dashboard/widget models are also stubbed, with no usable CRUD path.
- Database tables such as `nc_dashboards_v2` and `nc_widgets_v2` exist, but the product capability is not wired through.
- The existing frontend stack already includes `echarts`, `nuxt-echarts`, and `d3-scale`; chart rendering should reuse those instead of introducing a new visualization engine.
- The generated SDK already has v3 dashboard/widget request and option types for metric, pie, donut, bar, line, scatter, text, and iframe widgets.

Tasks:

- [ ] Implement dashboard CRUD in the backend.
- [ ] Implement widget CRUD in the backend, including layout, sizing, and ordering.
- [ ] Add the dashboard creation entry, dashboard list, and dashboard editor UI.
- [ ] Use ECharts / `nuxt-echarts` for chart rendering; avoid building custom chart primitives unless ECharts cannot cover the widget.
- [ ] Support first-batch visual widgets: metric card, statistic number, bar chart, horizontal bar chart, line chart, area chart, pie chart, donut chart, scatter chart, bubble chart, funnel chart, radar chart, and table widget.
- [ ] Support second-batch advanced widgets: combo chart, ranking chart, progress chart, gauge/NPS chart, word cloud, comparison bar chart, treemap, Sankey chart, pivot table, image, text, button, filter, tabs, and composed layout.
- [ ] Wire dashboard widgets to NocoDB tables, views, filters, and aggregations.
- [ ] Reuse NocoDB view/filter/sort/group metadata where possible so dashboard widgets can be based on an existing table view or all records.
- [ ] Add a reusable query/aggregation layer for widget data: dimensions, measures, group by, time bucket, filters, limit, sorting, and cache policy.
- [ ] Add chart appearance controls for color palette, legend, axes, labels, value formatting, stack/group mode, and responsive sizing.
- [ ] Add permission checks, sharing behavior, and audit logs for dashboard and widget changes.
- [ ] Add tests for widget rendering, data loading, dashboard persistence, and permission boundaries.

## Self-hosted sync and extension framework

Context:

- Official Sync supports mirroring a NocoDB grid view into another base and pulling external app data such as GitHub, GitLab, Linear, and Zendesk.
- Official Extensions are modular base-level UI components, but custom extension development is not currently exposed in the public product docs.
- For self-hosted internal use, a minimal open extension contract is more valuable than a closed marketplace clone.

Tasks:

- [ ] Implement self-hosted sync CRUD, scheduling, manual refresh, pause/resume, status, logs, and conflict/error handling.
- [ ] Support NocoDB-to-NocoDB read-only view sync as the first sync target.
- [ ] Add app sync adapters incrementally, starting with GitHub/GitLab/Linear-style issue/project data.
- [ ] Define a local extension manifest and sandboxed runtime for base-level extensions.
- [ ] Implement first-party extensions worth keeping: data exporter, CSV upload, bulk update, dedupe, page designer, URL preview, and org chart.
- [ ] Add permissions, audit logs, resource limits, and install/uninstall lifecycle for extensions.

## MCP and agent-facing access

Context:

- Official MCP Server lets LLM clients create, read, update, and delete records conversationally.
- Official docs currently position MCP as record-level operations only, not table/field/schema metadata changes.
- Our self-hosted AI and API-key work should share the same permission, audit, and token model with MCP.

Tasks:

- [ ] Keep the record-level MCP surface compatible with official NocoDB behavior.
- [ ] Add scoped MCP/API tokens with expiry, rotation, revocation, last-used metadata, and audit logs.
- [ ] Add optional tool-permission levels: read-only, ask-before-write, and unsupervised write.
- [ ] Add base-info and schema-inspection tools for AI agents.
- [ ] Consider controlled metadata tools for internal use: create table, create field, create view, create dashboard, create document, and trigger workflow.
- [ ] Add OAuth-style authorization for web-based AI clients when deployed behind an internal identity provider.
