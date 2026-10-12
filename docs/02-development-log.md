# Development Log

## 2026-10-12 - RAG Reply and Rule Context Integration

### Completed
- Added RAG quote-range support to inquiry reply drafts when a high-scoring similar case has `quoteRangeMin` and `quoteRangeMax`.
- Kept existing RAG reply quality by preserving historical-case references and `successPattern` text.
- Updated rule context generation to strip `相似案例：...` summary fragments before scanning alert keywords, avoiding RAG text causing false rule alerts.
- Stabilized smoke relative-date fixtures by pinning `receivedAt` for `月底` and `後天` cases.

### Decisions
- Did not change RAG retrieval scoring, storage schema, LINE integration, or LINE webhook behavior.
- Kept the change isolated to RAG-assisted replies and rule-context sanitation so it does not conflict with future LINE login or LINE message integration work.

## 2026-10-12 - P0 Existing Case Field Merge

### Completed
- Added thread-aware field merge semantics for inherit, update, conflict, and clear decisions.
- Added `fieldSources` and `clearedFields` to thread-aware extraction results.
- Persisted `field_sources` and `cleared_fields` JSON metadata on `ai_extractions`.
- Updated reanalysis to use the same thread-aware existing-case merge path as message import.
- Expanded thread fixture coverage to verify safe updates, conflicts, compatible inheritance, terminal clear behavior, field sources, and cleared fields.

### Decisions
- Missing existing values can be safely updated from the current message without human review.
- Conflicting critical values keep the existing case value and go through human review.
- Terminal/cancelled messages can clear action/material fields.
- Hybrid Search remains frozen until P0-P2 stabilize.

### Verification
- `npm run db:migrate`: passed.
- `npm run accuracy`: passed; thread context RAG-on full overall `1.000` across 6 fixtures and 90 scored fields.
- `npm run type-check`: passed.
- `npm run build`: passed.
- `npm run smoke`: passed.

## 2026-10-12 - P1 Typed Field Rules

### Completed
- Added optional `caseStatus` scoring to the extraction accuracy evaluator.
- Added completed/closed-case intent detection for `已完成`, `結案`, `已交付`, and final-payment received language.
- Mapped completed cases to `已完成`, with no next action and no missing fields.
- Tightened typed submission deadline detection for `第一版`, `交第一版`, and generic `交` in deadline context.
- Reduced required-material false positives by avoiding generic `需要產品...` matches as material requests.
- Treated `估價` as an explicit quote next action and prevented deadline-risk messages from auto-generating draft-preparation next actions.

### Verification
- `npm run accuracy`: passed; development ragOff full overall `0.902`, extended overall `0.920`, thread context RAG-on `1.000`.
- `npm run type-check`: passed.
- `npm run build`: passed.
- `npm run smoke`: passed.

## 2026-08-04 - Documentation Baseline

### Completed
- Named the project `Casebee`.
- Created the documentation structure under `school/Casebee` without `docs/00-project-brief.md`.
- Confirmed `school/Ifm/frontend` is a Vite + React + TypeScript project and will be used as the UI style reference.

### Decisions
- The project will prioritize an operable system over a presentation-only prototype.
- LINE and Gmail must be truly integrated for the final version.
- Instagram will remain a reserved integration interface for now.
- Recommended deployment environment is Ubuntu Server with Docker Compose.

### Next Steps
- Create the frontend/backend project structure.
- Define the initial database schema.
- Replace mock frontend data with backend API data progressively.

## 2026-08-05 - Project Scaffold

### Completed
- Created npm workspace structure under `school/Casebee`.
- Added `apps/web` with Vite, React, TypeScript, React Router, and initial Casebee UI pages.
- Added `apps/api` with Express, TypeScript, mock data, and base API endpoints.
- Added `packages/shared` for shared TypeScript types used by frontend and backend.
- Added `.env.example` with placeholders for database, LINE, Gmail, OpenAI, and Gemini settings.
- Added initial PostgreSQL schema draft in `database/migrations/001_initial_schema.sql`.

### API Added
- `GET /api/health`
- `GET /api/cases`
- `GET /api/cases/:id`
- `GET /api/messages`
- `POST /api/messages/import`
- `POST /api/webhooks/line`

### Decisions
- Use npm workspaces to keep frontend, backend, and shared types in one repository.
- Keep current UI close to the existing `Ifm/frontend` visual style: sidebar, card layout, muted background, compact dashboard cards.
- Start with in-memory mock data before connecting PostgreSQL, so the frontend can be wired to real API contracts early.
- Removed `react-router-dom` from the new MVP scaffold because npm advisories currently flag multiple React Router versions. The MVP uses simple React state-based navigation until route-level behavior is needed.

### Verification
- `npm install`: completed.
- `npm run type-check`: passed.
- `npm run build`: passed.
- `npm audit --omit=dev`: passed with 0 vulnerabilities.
- `GET /api/health`: returned `status: ok` from the local API server.

### Next Steps
- Install dependencies and run type checks/builds.
- Connect backend to PostgreSQL.
- Replace in-memory mock data with database queries.
- Add AI extraction service and rule engine.

## 2026-08-05 - PostgreSQL and Auto Case Import

### Completed
- Added PostgreSQL connection through `pg` with default local Docker connection string.
- Added `docker-compose.yml` with a `postgres:16-alpine` service.
- Added root scripts `npm run db:migrate` and `npm run db:seed`.
- Added migration and seed SQL files for customers, cases, messages, alerts, AI extractions, and RAG examples.
- Replaced in-memory cases/messages reads with PostgreSQL-backed repository functions.
- Added repository layer for customers, cases, messages, AI extractions, and alerts.
- Added rule-based MVP extraction service for amount, project item, deadline, intent, and missing fields.
- Added rule engine for missing field alerts and urgent deadline alerts.
- Updated `POST /api/messages/import` to store a message, create AI extraction, find/create customer, create case, attach message to case, and run rules.
- Added a simple message import form on the frontend Messages page.

### Verification
- `docker compose up -d postgres`: passed.
- `npm run db:migrate`: passed.
- `npm run db:seed`: passed.
- `npm run type-check`: passed.
- `npm run build`: passed.
- `npm audit --omit=dev`: passed with 0 vulnerabilities.
- `GET /api/health`: returned database `connected`.
- `GET /api/cases`: returned seeded PostgreSQL cases.
- `GET /api/messages`: returned seeded PostgreSQL messages.
- `POST /api/messages/import`: successfully returned generated message, extraction, case, and alerts.

### Decisions
- Store `expected_deadline` as `TEXT` for now, because MVP extraction may return natural language such as `明天`, `月底`, or `下週五`.
- Keep extraction rule-based until OpenAI/Gemini API credentials are available.
- Use PostgreSQL as the source of truth from this point forward; old mock data remains only as reference and should not drive API responses.

### Next Steps
- Add real LINE webhook persistence and signature verification.
- Add Gmail OAuth and polling.
- Replace rule-based extraction with LLM extraction behind the same service interface.
- Show generated alerts and extraction details more clearly in the frontend.

## 2026-08-05 - Gmail OAuth and Switchable AI Service

### Completed
- Added Gmail OAuth service using `googleapis`.
- Added `platform_connections` table for OAuth tokens, Gmail account email, and sync status.
- Added Gmail endpoints for status, auth URL generation, OAuth callback, and polling.
- Gmail polling imports recent Gmail messages into the same message-to-case pipeline.
- Added `AI_PROVIDER=rule|openai|gemini` switching through `aiService`.
- Added OpenAI and Gemini extraction implementations with strict JSON normalization and rule-based fallback.
- Added frontend controls for Gmail auth and polling on the Messages page.
- Added frontend display for the latest extraction, generated case, model name, suggested reply, and rule alerts.

### Verification
- `npm install`: passed after upgrading `googleapis` to remove audit vulnerabilities.
- `npm run type-check`: passed.
- `npm run build`: passed.
- `npm audit --omit=dev`: passed with 0 vulnerabilities.
- `npm run db:migrate`: passed and added `platform_connections`.
- `GET /api/integrations/gmail/status`: returned connected `false` when no Gmail account is authorized.
- `GET /api/integrations/gmail/auth`: returns a clear credentials error when Google OAuth env vars are missing.

### Decisions
- Gmail polling currently imports recent messages using `newer_than:30d`; deduplication by Gmail message id should be added before production demo with real mailbox data.
- OpenAI/Gemini failures fall back to rule-based extraction so the demo flow remains usable without external AI credentials.

### Next Steps
- Add Gmail deduplication by `gmailMessageId`.
- Add LINE webhook persistence and signature verification.
- Add settings UI for showing integration connection state more clearly.

## 2026-08-05 - Gmail Polling Deduplication

### Completed
- Added `findMessageByGmailMessageId()` in `messagesRepository`.
- Gmail polling now checks `messages.raw_payload->>'gmailMessageId'` before importing each Gmail message.
- Duplicate Gmail messages are skipped instead of creating duplicate messages, cases, extractions, and alerts.
- Gmail polling response now includes `importedCount`, `skippedCount`, `imported`, and `skipped`.
- Frontend Gmail polling status now displays both imported count and skipped duplicate count.

### Decisions
- Use existing `messages.raw_payload.gmailMessageId` for deduplication instead of adding a dedicated column. This keeps the schema change minimal and works with the current Gmail import payload.

### Next Steps
- Add one-click demo data import for non-LINE testing.
- Add RAG historical case seed and frontend display.
- Strengthen rule engine coverage.

## 2026-08-05 - One-Click Demo Message Import

### Completed
- Added `apps/api/src/data/demoMessages.ts` with six standardized freelancer case scenarios.
- Added `POST /api/demo/import` to import demo messages through the normal message-to-case pipeline.
- Demo import runs AI extraction, customer creation, case creation, message linking, and rule alerts.
- Added deduplication by `messages.raw_payload.demoMessageId` so repeated demo imports skip existing records.
- Added frontend button `一鍵匯入模擬資料` on the Messages page.
- Frontend now reports imported count and skipped duplicate count for demo imports.

### Demo Scenarios
- New logo/name card inquiry with budget and deadline.
- Urgent Reels video quote request.
- Website project confirmation.
- IG post scope change.
- Brand collaboration with missing fields.
- Product photography material/deadline risk.

### Decisions
- Demo import uses the same pipeline as real Gmail/LINE messages, not a separate fake case insert path. This keeps testing close to production behavior.

### Next Steps
- Add RAG historical case seed and frontend display.
- Strengthen rule engine coverage.
- Improve Kanban/Dashboard display using generated alerts and real DB stats.

## 2026-08-05 - RAG Historical Case Seed and Display

### Completed
- Added `RagExample` shared type.
- Added six historical RAG examples to `database/seed/001_demo_data.sql`.
- Added `ragExamplesRepository` and `ragService`.
- Implemented MVP similarity scoring using project item, amount proximity, intent/summary token overlap, and historical example text.
- Message import pipeline now returns `similarCases` with each generated case.
- Frontend Messages page now displays RAG similar cases with score, platform, amount, outcome, summary, and reply example.

### Decisions
- RAG MVP uses keyword scoring instead of embeddings. This keeps the feature local and demo-ready before adding pgvector or an external embedding API.
- The service boundary is isolated in `ragService`, so keyword scoring can later be replaced with vector similarity.

### Next Steps
- Strengthen rule engine coverage.
- Improve Kanban/Dashboard display using generated alerts and real DB stats.
- Consider pgvector/embedding migration after core demo flow is stable.

## 2026-08-05 - Rule Engine Strengthening

### Completed
- Expanded alert types in shared `Alert` type.
- Improved missing-field alert copy with Chinese field labels.
- Added scope change detection for terms such as `順便`, `追加`, `加做`, `改成`, `修改`, and `調整`.
- Added low budget warning for likely higher-effort deliverables under 10000.
- Added urgent reply warning for urgent timing terms such as `今天`, `明天`, `後天`, `急`, and `來不及`.
- Added clarification warning when two or more core fields are missing.
- Frontend alert cards now display the alert type as a pill.

### Implemented Alert Types
- `missing_fields`
- `deadline_risk`
- `scope_change`
- `low_budget`
- `urgent_reply`
- `needs_clarification`

### Decisions
- No database migration was required because `alerts.type` is stored as `TEXT`.
- The rule engine remains deterministic and separate from LLM extraction, matching the hybrid AI + rule-based architecture in the proposal.

### Next Steps
- Improve Kanban/Dashboard display using generated alerts and real DB stats.
- Add LINE webhook persistence and signature verification.

## 2026-08-05 - Business Risk Score MVP

### Completed
- Added `BusinessProfile`, `BusinessRiskScore`, `BusinessRiskFactor`, and `BusinessRiskSummary` shared types.
- Added `business_profiles` and `business_risk_scores` tables to the initial migration.
- Added a mock business registry provider to simulate GCIS lookup before official API access is available.
- Added business risk scoring based on registration status, tax id verification, capital amount, company age, and missing registry data.
- Added `POST /api/business/enrich` and `GET /api/business/risk-summary`.
- Dashboard now displays business risk distribution and average score.
- Messages page can enrich the latest extracted customer and display business risk score inline.
- Added `docs/11-business-risk.md`.

### Decisions
- Do not create a separate business-risk page. Business risk is embedded into existing Dashboard and Messages flows.
- Use mock provider first because GCIS API may require notification and source IP allowlisting.
- Treat FindBiz as a manual reference website, not the preferred API source.

### Next Steps
- Add Kanban compact business risk badges during frontend revision.
- Replace mock provider with GCIS API provider after credentials/IP allowlisting are ready.

## 2026-08-05 - GCIS Company Lookup Trial

### Completed
- Added `gcisBusinessRegistryProvider` for GCIS company profile lookup by tax id.
- Verified the official endpoint `5F64D864-61CB-4D0D-8AD9-492047CC1EA6` with tax id `20828393`.
- Added `BUSINESS_REGISTRY_PROVIDER=gcis|mock` and `GCIS_COMPANY_PROFILE_ENDPOINT` env settings.
- Business enrichment now tries GCIS when enabled and falls back to mock data when GCIS is unavailable or has no result.

### Decisions
- Keep GCIS lookup limited to tax id for the first trial because the selected official endpoint only supports `Business_Accounting_NO`.
- Keep mock fallback to preserve demo reliability.

## 2026-08-05 - Kanban Drag and Case Detail Drawer

### Completed
- Added `CaseDetail` shared type.
- Added `GET /api/cases/:id/details` to load a case with messages, alerts, and AI extraction records.
- Added `PATCH /api/cases/:id` status update endpoint for Kanban drag-and-drop.
- Kanban now includes all case statuses and displays counts per column.
- Case cards are draggable with optimistic UI updates and rollback on API failure.
- Clicking a case card opens a right-side drawer with project overview, missing fields, AI extraction, suggested reply, alerts, and message history.

### Decisions
- Used native HTML5 drag-and-drop instead of adding a DnD dependency to keep the MVP small and avoid new audit risk.
- Kept detail as a drawer instead of a new route so the board remains the primary workspace.

## 2026-08-05 - Kanban Layout Revision

### Completed
- Reduced Kanban from 10 raw status columns to 5 user-facing phase columns: inquiry, quote/follow-up, production, delivery/closed, lost.
- Dragging a card to a phase updates the case to that phase's default status while the card still shows the exact current status.
- Shortened card content to customer, title, amount, deadline, risk, exact status, and missing-data count.
- Replaced the side drawer with a centered modal for case detail.
- Translated backend missing-field keys into user-facing labels such as `預算 / 報價金額` and `預期到期時間`.
- Reordered case detail content around workflow: overview, next step, missing data, messages, AI reply, alerts.

### Decisions
- Use phase columns to avoid a visually overlong board while preserving exact status on the card and in the modal.
- Use a centered modal because case detail should feel like opening the project workspace, not a secondary side panel.

## 2026-08-05 - Messages Layout Fusion

### Completed
- Reviewed the previous `Ifm/frontend/src/pages/MessagesPage.tsx` information layout.
- Rebuilt the current Messages page around the previous product structure without copying its HTML/CSS implementation.
- Added a top message-processing flow strip.
- Changed Messages into a three-column workspace: message stream, AI analysis/case action, and conversation/reply draft.
- Added platform filtering for the message stream.
- Kept current MVP functions in the new layout: manual import, demo import, AI extraction, alerts, RAG similar cases, and business risk lookup.

### Decisions
- Use the previous version only as a layout reference. Current implementation keeps the existing React state, API service, and stylesheet conventions.

## 2026-08-05 - Move Integrations to Settings

### Completed
- Moved Gmail OAuth connection, status refresh, and sync polling controls from Messages to Settings.
- Messages page now focuses on message stream, manual/demo import, AI analysis, case action, conversation, and reply drafting.
- Settings page now contains platform integration cards for Gmail and LINE.
- Gmail card shows connection state, last sync/sync result, connect action, refresh action, and sync action.

### Decisions
- Platform authorization belongs in Settings, not in the message analysis workspace.
- Keep manual/demo import in Messages because they are workflow/testing inputs rather than platform authorization settings.

## 2026-08-05 - Case Detail Risk and RAG

### Completed
- Extended `CaseDetail` with `businessProfile`, `businessRiskScore`, and `similarCases`.
- Extended `GET /api/cases/:id/details` to return latest business registry/risk data by customer.
- Reused RAG similarity scoring to return similar historical cases for the selected case detail.
- Kanban case modal displays business risk score, registry profile summary, and score factors.

### Decisions
- Case detail uses the latest AI extraction when available and falls back to case fields for RAG matching.
- Business risk is shown if already enriched for the customer; enrichment action remains in Messages for now.

## 2026-08-05 - Editable Case Detail

### Completed
- Extended `PATCH /api/cases/:id` to update status, quote amount, expected deadline, and summary.
- Added editable case form inside the Kanban case modal.
- Saving a case updates the modal and the Kanban card state immediately.
- Added basic frontend validation for quote amount.

### Decisions
- Keep editing focused on core operational fields first: status, amount, deadline, and summary.
- Keep drag-and-drop status updates using the same PATCH endpoint behavior.

## 2026-08-05 - Move RAG UI Out of Kanban

### Completed
- Removed similar historical cases from the Kanban case modal to keep the board focused on active project execution.
- Added a Settings card for the similar-case knowledge base and future RAG tuning.
- Settings now documents where historical cases come from and what matching rules are currently used.

### Decisions
- Keep RAG data available in API for future use, but do not surface it inside the Kanban modal for now.
- Treat RAG examples as a configurable knowledge-base concern, so the natural management location is Settings.

## 2026-08-05 - End-of-Day Cleanup

### Completed
- Cleaned up user-facing field labels so backend keys such as `expected_deadline` do not appear in Messages or Kanban UI.
- Clarified API docs to refer to the current centered Kanban case modal instead of a drawer.
- Updated business-risk docs to reflect the current Dashboard, Messages, and Kanban modal placements.
- Added validation notes to `docs/09-testing-report.md`.
- Clarified RAG UI placement in `docs/08-ai-rag-rules.md`.
- Kept historical development-log entries intact but added this current-state cleanup section to avoid confusion.

### Current UI State
- Kanban is the core project workspace with 5 phase columns, drag-and-drop status updates, and a centered editable case modal.
- Messages is the message-to-case analysis workspace with manual/demo import, AI extraction, alerts, RAG reply support, business-risk lookup, and reply draft.
- Settings owns platform integrations and future RAG knowledge-base tuning.

## 2026-08-06 - Gmail Integration Stabilization

### Completed
- Added Gmail OAuth configuration status to `GET /api/integrations/gmail/status`.
- Added configurable Gmail polling query and max results through `GMAIL_POLL_QUERY` and `GMAIL_POLL_MAX_RESULTS`.
- Extended Gmail polling response with checked, imported, skipped, empty, failed counts, query, and failed message details.
- Gmail polling now records per-message failures instead of failing the entire sync when one message fails.
- Settings now shows Gmail redirect URI, configuration state, connection state, and detailed sync result.
- Settings disables Gmail connect when OAuth env is missing and disables sync when Gmail is not connected.

### Decisions
- Gmail is the near-term real data source; LINE remains a placeholder for now.
- Gmail setup and sync actions stay in Settings, while Messages remains the analysis workspace.

## 2026-08-06 - Five-Stage Stabilization Pass

### Completed
- Completed reply-overdue rule execution through `POST /api/rules/run` and Settings manual trigger.
- Added duplicate prevention for unresolved `reply_overdue` alerts.
- Added case modal business-risk lookup/update action.
- Added `GET /api/rag/examples` and Settings RAG knowledge-base preview.
- Added `npm run smoke` for service/repository-level smoke checks.
- Updated demo script to use Gmail/Settings as the primary real-data path and demo import as fallback.

### Validation
- `npm run type-check` passed.
- `npm run build` passed.
- `npm audit --omit=dev` passed.
- `docker compose up -d postgres` passed.
- `npm run db:migrate` passed.
- `npm run db:seed` passed.
- `npm run smoke` passed.

### Decisions
- Keep LINE as placeholder for now; Gmail remains the near-term real integration.
- Keep RAG management in Settings rather than Kanban.
- Keep reply-overdue execution manual for MVP; scheduled/background execution can be added later.

## 2026-08-06 - UX and Customers Pass

### Completed
- Added `GET /api/customers` with customer summaries, case counts, active case counts, risk case counts, and latest case update time.
- Added Customers page and primary navigation entry.
- Dashboard now uses richer live metrics: active cases, today messages, missing-field cases, and total quoted amount.
- Settings now explains Gmail OAuth propagation delay while authorization is pending.
- Kanban case modal now disables save/business-risk buttons during in-flight actions.
- Added empty states for Dashboard, Kanban, Messages, and Customers.

### Decisions
- Customers page remains summary-first for MVP; detailed customer editing can come later.
- Gmail OAuth delay is handled as a user-facing setup state rather than an error.

## 2026-08-06 - Customer Detail Modal

### Completed
- Added `CustomerDetail` shared type.
- Added `GET /api/customers/:id/details` with customer summary, cases, recent messages, latest business profile, and latest business risk score.
- Customers page cards now open a centered customer detail modal.
- Customer detail modal shows overview, business risk, case history, and recent messages.

### Decisions
- Customer detail is read-only for now. Editing customer identity and contact handles can be added after Gmail demo flow is stable.

## 2026-08-06 - Alert Resolve Flow

### Completed
- Added `resolvedAt` to shared `Alert`.
- Added `PATCH /api/alerts/:id/resolve`.
- Kanban case modal can mark individual alerts as handled.
- Resolved alerts remain visible with handled timestamp so demo users can see risk closure.
- Smoke test now verifies alert creation and resolve behavior.

### Decisions
- Keep resolved alerts in case detail instead of hiding them, because the MVP should show an auditable action trail.

## 2026-08-06 - RAG Management and Rule Status

### Completed
- Added `rag_examples.is_active` migration support.
- Added RAG create and deactivate APIs.
- Similar-case matching now uses active RAG examples only.
- Settings can add and deactivate RAG examples for demo tuning.
- Added `GET /api/rules/status` so Settings shows current reply-overdue threshold and manual execution mode.
- Expanded demo rehearsal script for Gmail fallback, Kanban alert closure, Customers detail, RAG tuning, and LINE scope.

### Decisions
- Rule scheduling remains manual for MVP. Settings now makes the current threshold and lack of scheduled next run explicit.
- LINE remains deferred; the webhook endpoint is not presented as a real persisted integration.

## 2026-08-06 - Short-Term Scope and Delivery Checklist

### Completed
- Removed real LINE webhook integration from the short-term roadmap.
- Updated README to identify Gmail as the near-term real data source and LINE as future scope.
- Updated architecture, deployment, LINE integration, and database schema docs to match the current scope.
- Added `docs/12-mvp-delivery-checklist.md` with ten remaining work items, demo commands, Gmail verification checklist, deployment/secrets checklist, test plan outline, and MVP limitations.

### Decisions
- Short-term demo uses Gmail when available, with demo/manual import as the fallback.
- LINE remains documented as a future integration only, not a demo claim.

## 2026-08-16 - Gmail Real OAuth Verification

### Completed
- Verified root `.env` contains Gmail OAuth credentials without exposing secrets.
- Fixed API env loading so workspace scripts read root `.env` instead of only `apps/api/.env`.
- Completed real Gmail OAuth authorization.
- Enabled Gmail API in Google Cloud after polling reported it was disabled.
- Successfully polled Gmail and imported real Gmail messages through the standard message-to-case pipeline.
- Verified follow-up polling skips already imported Gmail messages by Gmail message id.
- Confirmed Gmail-backed records are visible in Messages, Cases, and Customers APIs.

### Validation Result
- Gmail status: configured and connected.
- Follow-up poll: checked 10, imported 0, skipped 10, empty 0, failed 0.
- Current API counts after verification: 19 messages, 19 cases, 18 customers, including Gmail-backed records.

### Decisions
- Keep `GMAIL_POLL_QUERY=newer_than:30d` as the default, but use a narrower query for polished demos if mailbox noise becomes distracting.

## 2026-08-16 - Gmail Triage Filtering

### Completed
- Added pre-import Gmail triage classifier.
- Gmail polling now skips verification codes, calendar invites, no-reply/system notifications, newsletters, and broad event/competition announcements.
- Skipped Gmail messages now include `category` and `reason` in the polling response.
- Settings sync status summarizes skipped categories.

### Decisions
- Do not delete already imported Gmail messages automatically. Existing imported records may include mailbox noise and should only be cleaned up with explicit user approval.
- Keep the classifier rule-based for MVP. Later versions can add user-defined sender allowlists/blocklists and an inbox review queue.

## 2026-08-16 - Messages Gmail Assistant

### Completed
- Replaced the generic Messages pipeline banner with a Gmail triage assistant panel.
- Added direct actions for Gmail sync/classification, Gmail-only view, and demo fallback.
- Added expandable UI copy explaining the current Gmail filtering standard.

### Decisions
- Messages should focus on user actions and decision support, not a static system pipeline explanation.

## 2026-08-16 - Gmail Customer Name Inference

### Completed
- Added `customerNameInference` service for Gmail sender/customer name cleanup.
- Gmail import now stores the inferred customer name while keeping the sender email as contact handle.
- Added alias support for noisy sender accounts such as `fupin.mp2企劃部第二帳號`, which maps to `富品建設` when `富品` context is present.
- Smoke test now verifies this inference rule.

### Decisions
- Existing imported Gmail rows are not rewritten automatically. Data repair should be an explicit action because it changes persisted customer/case/message display names.

## 2026-08-16 - Gmail Manual Exclusion

### Completed
- Added soft-exclusion columns for messages and cases.
- Added `POST /api/messages/:id/exclude`.
- Excluded messages are hidden from normal message lists.
- Cases with no remaining active messages are hidden from Kanban/case APIs.
- Customers summaries and details ignore excluded cases/messages.
- Messages page now lets users exclude a selected Gmail email with a reason.

### Decisions
- Exclusion is soft, not delete, so imported Gmail data can be audited or restored later.

## 2026-08-16 - Settings and Message Cleanup UX

### Completed
- Settings platform connection now refreshes on page focus and visibility changes, so OAuth completion is reflected without manual reload.
- Removed the user-facing Environment Variables card from Settings.
- Gmail connect buttons open the authorization page through the Casebee backend auth API.
- Messages page now clears stale AI result state when selecting a message, so the exclusion action always targets the selected email.
- Removed user-facing message thread id from Messages; replaced it with useful case status/time context.

### Decisions
- Gmail thread id remains internal metadata for integrations and debugging, but it is not useful enough to show in the normal user workflow.

## 2026-08-16 - Message Exclusion Reliability Fix

### Completed
- Moved the Gmail exclusion tool outside the AI-result conditional branch so it always appears for the selected Gmail message.
- Exclusion now removes the selected message from local UI state immediately before refetching from the API.
- Smoke test now creates a temporary Gmail message, excludes it, verifies it is hidden from `findAllMessages()`, and cleans it up.

### Decisions
- The exclusion action is tied to the currently selected message, not the latest import/AI analysis result.

## 2026-08-16 - Learned Gmail Exclusion Rules

### Completed
- Added `message_exclusion_rules` table.
- Excluding a Gmail message now learns a `sender_email` exclusion rule.
- Gmail polling checks learned exclusion rules before triage/import and skips matching senders as `learned_exclusion`.
- Messages page tells the user that future messages from the same sender will be skipped.
- Smoke test verifies learned sender exclusion rules.

### Decisions
- MVP learns by exact sender email only. Domain-level and keyword-level rules should be added later with explicit user controls to avoid over-filtering.

## 2026-08-16 - Gmail Subject Display Cleanup

### Completed
- Messages page now parses Gmail-style `Subject:` prefixes in imported message text.
- Message list shows the subject as the preview when available.
- Message detail separates the email subject from the raw body content.
- Conversation bubbles show the subject as a heading and keep the body formatted with preserved line breaks.

### Decisions
- This is a frontend display-only cleanup. Stored message text remains unchanged, so existing imports do not need a data migration.

## 2026-08-16 - Summary and Business Lookup Fix

### Completed
- Rule-based fallback summaries now generate a concise case summary instead of wrapping the full original message.
- Summary output now highlights intent, project item, amount, deadline, and missing-field count when available.
- Messages and Kanban business-risk lookup now include a unified business number input.
- Business-risk requests now send `taxId` to the backend when provided.

### Decisions
- Existing imported cases are not automatically rewritten. The improved summary applies to newly imported messages or cases regenerated through the pipeline.
- Real GCIS lookup is still tax-id driven; customer-name-only lookup remains unreliable and falls back to mock/not-found behavior.

## 2026-08-16 - Automatic Gmail Polling

### Completed
- Added API-side Gmail auto polling scheduler.
- Scheduler runs when Gmail is configured and connected, defaults to every 60 seconds, and avoids overlapping poll runs.
- Added `GMAIL_AUTO_POLL_ENABLED` and `GMAIL_AUTO_POLL_INTERVAL_SECONDS` environment variables.
- Messages page now refreshes visible messages every 30 seconds while open.

### Decisions
- Manual Gmail sync remains available for immediate user-triggered refreshes.
- Auto polling uses the same triage, deduplication, learned exclusion, and import pipeline as manual sync.

## 2026-08-16 - Messages Column Role Cleanup

### Completed
- Messages middle column is now positioned as `AI 判讀與下一步` instead of duplicating the raw email.
- Selecting an existing case-linked message now loads stored case detail and AI extraction data.
- Middle column shows case summary, extracted fields, AI suggested reply, business risk lookup, alerts, and similar cases when available.
- Right column remains the conversation/raw email area and also shows the AI reply bubble plus editable reply draft.

### Decisions
- Raw email body is kept out of the middle analysis column to make the two right-side columns visually and functionally distinct.

## 2026-08-16 - Message Analysis Precision Cleanup

### Completed
- Removed the AI suggested reply card from the middle analysis column.
- Business-risk lookup no longer asks users to manually type a tax id in Messages or Kanban.
- Business-risk lookup now uses an 8-digit tax id found in the selected message when available, otherwise it runs by customer name and returns an unverified/not-found result when appropriate.
- Rule-based extraction now recognizes collaboration-invitation terms such as `合作邀請`, `品牌合作`, `短影音`, and `Instagram Reels`.
- Date extraction now supports Taiwan-style dates such as `2026 年 9 月 15 日`.
- Amount extraction no longer treats generic years such as `2026` as quote amounts.

### Decisions
- AI suggested reply remains in the right conversation/reply area, not the middle analysis area.
- Real business registry lookup remains limited by whether the email provides a unified business number.

## 2026-08-16 - User Journey First Pass

### Completed
- Added cross-page navigation props from the app shell to Dashboard, Messages, Kanban, and Customers.
- Dashboard is now a task-oriented entry point instead of only a statistics page.
- Dashboard cards now route users to Messages, Kanban, and Customers based on the task type.
- Dashboard now highlights待判讀訊息, 缺資料案件, and 進行中案件 as actionable work queues.
- Messages now displays Gmail auto-sync interval/status text from the backend and links to Settings for sync configuration.
- Messages case action now links users to Kanban for follow-up management.
- Kanban case detail now links back to source messages and customer data.
- Customers detail now links to Kanban and Messages so customer history is not a dead end.
- Gmail status API now returns `autoPollEnabled` and `autoPollIntervalSeconds`.

### Decisions
- First pass prioritizes navigable workflow over deep route parameters. Selecting the exact case/message after navigation can be added in the next pass.
- Dashboard is positioned as the daily work entry point: users should start there, then move to Messages, Kanban, or Customers based on action needed.

## 2026-08-16 - Company Name Precision Fix

### Completed
- Customer-name inference now strips phrases such as `我是`, `我們是`, `行銷團隊`, and `團隊` when extracting organization names from email content.
- Rule-based extraction now reuses customer-name inference for `clientName`, so case/customer data does not preserve noisy sender phrases.
- Existing LumiNote data was repaired from `我是 LumiNote 行銷團隊` to `LumiNote` across customer, case, and AI extraction records.

### Decisions
- Kanban and customer records should store the company/brand name, not the human sentence used in the email introduction.

## 2026-08-16 - Automatic Business Risk Display

### Completed
- Messages now automatically runs business-risk enrichment for the selected message/customer and displays the result without a manual button.
- Kanban case detail now automatically enriches missing business-risk data when a case is opened.
- Customers detail now automatically enriches missing business-risk data when a customer is opened.
- Messages and Kanban no longer require the user to click a business-risk lookup button to see the score.

### Decisions
- Business-risk lookup remains automatic and result-oriented. If the email contains an 8-digit tax id, it is used; otherwise the system attempts customer-name lookup and surfaces unverified/not-found results honestly.

## 2026-08-16 - Backend Extraction Precision Pass

### Completed
- Refactored rule-based extraction into a stronger deterministic parser.
- Added context-aware amount parsing so dates/years are not treated as quote amounts.
- Added labeled-line extraction for project item and deadline fields.
- Added deadline-context priority for phrases such as `後天交件`.
- Added more project keywords for collaboration, social/video, packaging, presentation, and design work.
- Improved intent classification for collaboration invites, quote inquiries, revision/scope changes, and material/deadline risks.
- Updated LLM normalization so missing AI JSON fields preserve deterministic fallback values instead of becoming null.
- Added smoke regression coverage for four extraction scenarios.

### Decisions
- This reduces the largest backend technical risk for MVP reliability, but it does not replace formal LLM accuracy evaluation. Next step should be a larger fixture set and a standalone extraction accuracy report.

## 2026-08-16 - Product Workflow Completion Pass

### Completed
- Added navigation target state so pages can navigate with selected `messageId`, `caseId`, or `customerId` instead of only switching pages.
- Dashboard task rows now open the relevant message or case directly.
- Messages accepts a target message id and selects that message when opened from Dashboard/Kanban/Customers.
- Kanban accepts a target case id and opens the relevant case modal.
- Customers accepts a target customer id and opens the relevant customer detail modal.
- Messages analysis column now includes an explicit next-step decision card.
- Kanban case detail now has an action-oriented next-step checklist instead of only descriptive text.
- Customers detail now includes a customer decision section for risk/value guidance.
- Settings now includes a system health overview for Gmail, auto sync, rules, and RAG status.

### Decisions
- This pass focuses on making the existing product path usable end-to-end: Dashboard -> Messages -> Kanban -> Customers -> Settings.
- Deep URL routing is still not introduced; the app remains state-based, but navigation state now carries the selected record.

## 2026-08-16 - Testing Data Cleanup

### Completed
- Removed seed-created frontend display customers, cases, and messages from `database/seed/001_demo_data.sql`.
- Cleaned current database of demo/seed/manual/LINE display messages and generated cases.
- Removed Messages page Demo fallback and one-click mock import entry points from the UI.
- Updated empty-state copy to point users toward Gmail auto-sync or manual test import instead of demo data.

### Verification
- Current visible testing dataset contains 5 Gmail messages and 5 Gmail cases.
- Display/demo messages count is 0.
- Display/demo cases count is 0.

### Decisions
- RAG examples remain in seed because they are feature data for similarity support, not fake active project records.

## 2026-08-16 - RAG-Assisted Extraction Pipeline

### Completed
- Added email preprocessor for subject/body splitting, quoted text removal, noise cleanup, candidate lines, and labeled fields.
- Added message classifier for collaboration invites, quote inquiries, revision requests, deadline/material risk, confirmation, announcements, calendar invites, newsletters, and system notifications.
- Added extraction validator with runtime confidence and warnings.
- Added text-first RAG retrieval before final extraction.
- Rule-based extraction can now use similar RAG examples to refine broad project items.
- RAG scoring now includes Chinese phrase groups and stronger video/Reels matching.
- Smoke includes a RAG-assisted regression case where `宣傳影片 + IG 限動` infers `Reels 影片`.

### Decisions
- No vector database or DB schema migration yet. This pass upgrades RAG from display-only support to extraction context while keeping the system stable for testing.

## 2026-08-16 - Message Reanalysis

### Completed
- Added `reanalyzeMessage()` backend service.
- Added `POST /api/messages/:id/reanalyze`.
- Reanalysis creates a new AI extraction row and updates linked case fields with the latest extraction.
- Messages page now includes `用新版 AI 流程重新分析` in the next-step card.
- Smoke verifies reanalysis updates a vague promotional video case to `Reels 影片`.

### Decisions
- Reanalysis preserves history by inserting a new AI extraction instead of overwriting previous extraction rows.
- Case fields are updated to reflect the newest extraction because this is the user-facing source of truth for active work.

## 2026-08-16 - Kanban Partner-Centric Cleanup

### Completed
- New cases now use the customer/partner name as `cases.title`; project item remains in `project_item`.
- Reanalysis now keeps case title aligned with `customer_name`.
- Kanban cards now show partner name as the main title and project item as secondary content.
- Kanban modal title now shows the partner name, with case code and project item as subtitle.
- Kanban risk labels now display localized labels instead of raw `warning`/`danger` strings.
- Existing visible Gmail data was reanalyzed and cleaned: non-case Gmail noise was soft-excluded, LumiNote sender/title was normalized, and stale `2026` quote amount was removed.

### Verification
- Visible Kanban data now contains one active Gmail case: LumiNote / Instagram Reels / no quote amount / deadline `2026 年 9 月 15 日`.

## 2026-08-16 - Reply Draft Freshness Fix

### Completed
- Messages page now clears stale case detail and draft reply when the selected message changes before loading the new case detail.
- Suggested reply generation now uses intent, project item, deadline, missing fields, and similar-case context instead of generic fixed templates.
- Existing visible Gmail records were refreshed with the latest suggested reply logic, then non-case Gmail noise was re-excluded.

### Verification
- Current visible testing data remains one active Gmail case: LumiNote / Instagram Reels.

## 2026-08-16 - Structured RAG Upgrade

### Completed
- RAG examples now include structured metadata: case type, project aliases, typical missing fields, quote range, and success pattern.
- RAG scoring now uses aliases and case type in addition to project item, amount distance, and keyword overlap.
- Extraction uses RAG metadata to infer project items, add relevant missing fields, and include past success patterns in suggested replies.
- Settings RAG management supports editing structured metadata fields.

### Verification
- `npm run db:migrate`: passed.
- `npm run db:seed`: passed.
- `npm run type-check`: passed.
- `npm run build`: passed.
- `npm run smoke`: passed.
- Smoke verifies structured RAG influence: Reels collaboration adds `quote_amount`, `usage_rights`, `revision_scope`, and `deliverables` as missing fields.

## 2026-08-16 - Extraction Accuracy Baseline

### Completed
- Added 20 extraction fixtures with expected JSON under `apps/api/src/fixtures/extraction/accuracy-fixtures.json`.
- Added `npm run accuracy` to run field-level extraction accuracy checks.
- Accuracy script reports RAG-off baseline, RAG-on baseline, before/after delta, field-level accuracy, error classification, confidence warnings, and human-review candidates.
- Targeted extraction fixes improved client name inference, project item normalization, deadline parsing, cancellation intent, follow-up handling, and RAG missing-field compatibility.

### Verification
- `npm run accuracy`: passed with RAG-on overall accuracy `0.96` across 20 fixtures.
- `npm run type-check`: passed.
- `npm run build`: passed.
- `npm run smoke`: passed.

## 2026-08-16 - Gmail Thread Context MVP

### Completed
- Added holdout extraction fixtures and multi-message thread fixtures.
- Added thread-aware extraction result fields: extracted fields, inherited fields, changed fields, conflicting fields, human-review flag, thread summary, and existing case id.
- Gmail import now stores Gmail `threadId` in raw payload and uses `messages.thread_id` to find existing cases.
- Same Gmail thread now attaches follow-up messages to the existing case instead of creating duplicate cases.
- Thread context keeps current message extraction separate from inherited existing case state.
- Conflicting project, quote, or deadline values are marked in `conflictingFields` and create a `needs_human_review` alert.
- `npm run accuracy` now reports development, holdout, and thread accuracy separately.

### Verification
- `npm run accuracy`: passed. Development RAG-on `0.96`, holdout RAG-on `1.0`, thread `1.0`.
- `npm run type-check`: passed.
- `npm run build`: passed.
- `npm run smoke`: passed, including same-thread case reuse and human-review alert coverage.

## 2026-08-16 - AI Human Review Workflow

### Completed
- Persisted extraction review metadata: overall confidence, field confidence, warnings, extracted fields, inherited fields, changed fields, conflicting fields, needs-human-review flag, and review status.
- Added `ai_review_items` and `ai_review_history` tables.
- Thread imports now create pending review items for changed or conflicting case-critical fields.
- Existing case project, quote, and deadline are not overwritten before human confirmation.
- Added review APIs to load message review detail and resolve each field with apply, keep, or edit.
- Messages workspace can filter pending-review messages and display field-level existing value vs suggested value with source/action controls.
- Dashboard now shows pending human-review message count and links into Messages.
- Applying a review item updates the case, resolves the human-review alert when all pending items are handled, and writes review history.

### Verification
- `npm run db:migrate`: passed.
- `npm run accuracy`: passed. Development RAG-on `0.96`, holdout RAG-on `1.0`, thread `1.0`.
- `npm run type-check`: passed.
- `npm run build`: passed.
- `npm run smoke`: passed with thread conflict, apply-new-value, case update, alert resolution, and review history coverage.

## 2026-08-16 - Day 9-1 Messages Reply Status

### Completed
- Added message reply status fields: `pending_reply`, `replied`, and `no_reply_needed`.
- New case-related imported messages default to `pending_reply` with `reply_status_source = system`.
- Direct/non-case messages default to `no_reply_needed` with `reply_status_source = system`.
- Added user-controlled reply status updates that persist `reply_status`, `reply_status_updated_at`, and `reply_status_source`.
- Messages workspace now supports reply-status filtering and actions for replied, pending reply, and no reply needed.
- Reanalysis does not overwrite user-set reply status.

### Verification
- `npm run db:migrate`: passed.
- `npm run type-check`: passed.
- `npm run build`: passed.
- `npm run smoke`: passed.

## 2026-08-16 - Day 9-1B Reply Status History

### Completed
- Added `message_reply_status_history` to keep an audit trail for reply status changes.
- Reply status updates now run in a transaction: lock message, compare current status, update message, insert history, commit.
- Duplicate submissions with the same status return the existing message without writing history.
- System transitions, such as case-related import moving from `no_reply_needed` to `pending_reply`, write history with `source = system`.
- User actions write history with `source = user`.
- Reanalysis preserves user-set reply status and does not create reply history.
- Added `GET /api/messages/:id/reply-status-history`.
- Messages shows a simple status history list for the selected message.

### Decision
- Initial message creation with default `no_reply_needed` is not recorded as a history row because no status transition has occurred yet. The first real transition is recorded.
- History uses `ON DELETE CASCADE` so deleting a message does not leave invalid audit rows.

### Verification
- `npm run db:migrate`: passed.
- `npm run type-check`: passed.
- `npm run build`: passed.
- `npm run smoke`: passed.

## 2026-08-16 - Day 9-2A Case Stage and Missing Field Taxonomy

### Completed
- Chose mapping-based standard case stages instead of adding a DB `case_stage` column.
- Added shared `CaseStage`, `MissingFieldName`, status-to-stage mapping, missing field definitions, and missing field alias normalization.
- API case serialization now includes computed `caseStage` while preserving existing Kanban `status` values.
- Case and RAG repository serialization normalizes old missing field aliases such as `materials` and `reference` to standard names.
- RAG seed now uses standard `required_materials` instead of the old `materials` alias.
- Smoke validates status mapping, missing field alias normalization, unknown status fallback, and `caseStage` serialization.

### Decision
- Did not add a persisted `case_stage` column. Current `cases.status` is still the Kanban operational status, so a computed mapping is lower risk and avoids data migration/backfill ambiguity.
- Unknown statuses fall back to `inquiry` instead of throwing, so API serialization remains safe for legacy data.

### Verification
- `npm run db:migrate`: passed.
- `npm run accuracy`: passed.
- `npm run type-check`: passed.
- `npm run build`: passed.
- `npm run smoke`: passed.

## 2026-08-31 - Day 9-2B-1 Stage-Aware Missing Fields

### Completed
- Added Kanban status `已確認合作` and mapped it to standard stage `confirmed`.
- Updated backend status validation, AI status allowlist, deterministic confirmation extraction, and Kanban fixed status lists.
- Added centralized stage required-field rules, taxonomy ordering, and stage-aware missing field resolver.
- Import, reanalysis, rule execution, and manual case updates now use stage-aware missing fields.
- Added `alerts.metadata` so `missing_fields` alerts can store `metadata.field`.
- Missing field alerts now sync per field: create only absent open field alerts, resolve fields no longer missing, and dedupe duplicate open alerts.
- Completed and cancelled stages no longer keep regular missing field alerts open.
- Missing field lifecycle does not resolve `needs_human_review`, deadline, reply, or other non-missing alerts.

### Verification
- `npm run db:migrate`: passed.
- `npm run type-check`: passed.
- `npm run smoke`: passed, including confirmed stage and missing-field alert lifecycle regression.
- `npm run accuracy`: passed. Development RAG-on `0.96`, holdout RAG-on `1.0`, thread `1.0`.
- `npm run build`: passed.

## 2026-08-31 - Day 9-2B-2 Deadline Semantics and Next Action

### Completed
- Added extraction fields for `submissionDeadline`, `publishDeadline`, `nextAction`, `nextActionSource`, `requiredMaterials`, and `providedMaterials`.
- Persisted the new fields on both `cases` and `ai_extractions` so rules, Messages, and future Dashboard work can read them reliably.
- Extended deterministic extraction and AI prompt normalization for typed deadlines, next actions, required materials, and provided materials.
- Kept `expectedDeadline` as the compatibility field and now derives it as the next closest key deadline: submission deadline first when both typed dates exist, otherwise the single typed deadline, otherwise the generic deadline.
- Added Asia/Taipei relative-date parsing for terms such as `這週五`, `下週五`, `後天`, and month-end phrases.
- Extended thread conflict detection and review items to include `submissionDeadline` and `publishDeadline`.
- Reanalysis preserves existing case deadlines when the new extraction proposes a different date, avoiding silent overwrite of already-confirmed dates.
- Updated missing field resolver so execution-stage typed deadline and material gaps are conditional on message semantics, not added to every execution case.
- Required materials distinguish pending material requests from explicitly provided materials such as `附件提供 Logo`.
- Accuracy fixtures now score `submissionDeadline`, `publishDeadline`, `nextAction`, and `requiredMaterials`; smoke includes deadline/material/reanalysis regressions.

### Verification
- `npm run db:migrate`: passed.
- `npm run accuracy`: passed. Development RAG-on `0.874`, holdout RAG-on `0.805`, thread `0.923`.
- `npm run type-check`: passed.
- `npm run build`: passed.
- `npm run smoke`: passed with 11 deterministic extraction regression cases and typed deadline review coverage.
