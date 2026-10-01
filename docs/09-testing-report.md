# Testing Report

This document records validation data for the research and demo.

## Target Metrics

- Message latency: less than 3 seconds for LINE webhook when possible.
- Key field extraction accuracy: greater than 85%.
- Case organization time: reduce more than 60% compared with manual recording.
- Usability score: greater than 75.

## 2026-08-05 Validation

Commands run during implementation:

- `npm run type-check`
- `npm run build`
- `npm audit --omit=dev`
- `npm run smoke`
- `docker compose up -d postgres`
- Repository-level DB checks for case detail loading and case field updates.

Latest result:

- TypeScript type-check passed.
- Production build passed.
- Audit passed with `found 0 vulnerabilities`.
- PostgreSQL container started successfully.
- Case detail repository returned detail data and similar-case field.
- Case update repository updated status, quote amount, expected deadline, and summary, then restored the original data.

Smoke coverage currently checks:

- Cases and messages can load.
- Case detail can load.
- Case field update and restore works.
- Gmail status returns configuration state.
- RAG examples can load.
- Business risk enrichment returns a score.
- Reply-overdue rules can execute without creating test alerts.

## 2026-08-06 Validation

Commands run during implementation:

- `npm run type-check`
- `npm run build`
- `npm audit --omit=dev`
- `docker compose up -d postgres`
- `npm run db:migrate`
- `npm run smoke`

Latest result:

```json
{
  "ok": true,
  "cases": 9,
  "customers": 10,
  "customerDetailCases": 1,
  "messages": 9,
  "ragExamples": 6,
  "ragDeactivate": true,
  "gmailConfigured": false,
  "businessRiskScore": 100,
  "resolvedAlert": true,
  "ruleMode": "manual",
  "rulesChecked": 7
}
```

Additional smoke coverage:

- Customer detail can load with related cases.
- Alerts can be created and resolved.
- RAG examples can be created and deactivated.
- Rules status reports manual mode and the configured threshold.

## 2026-08-16 Gmail Real OAuth Validation

Commands and API checks run during Gmail verification:

- `docker compose up -d postgres`
- `npm run db:migrate`
- `GET /api/health`
- `GET /api/integrations/gmail/status`
- `GET /api/integrations/gmail/auth`
- Browser OAuth authorization with a real Gmail account.
- `POST /api/integrations/gmail/poll`
- `GET /api/messages`
- `GET /api/cases`
- `GET /api/customers`

Result:

- Gmail OAuth status returned `configured: true` and `connected: true`.
- First polling attempt exposed a Google Cloud setup issue: Gmail API was not enabled for the OAuth project.
- After enabling Gmail API, polling succeeded.
- Follow-up polling returned `checkedCount: 10`, `importedCount: 0`, `skippedCount: 10`, `emptyCount: 0`, `failedCount: 0`, proving deduplication.
- API verification after import returned Gmail-backed records in messages, cases, and customers.

Observed data counts after Gmail verification:

```json
{
  "messages": 19,
  "gmailMessages": 13,
  "cases": 19,
  "gmailCases": 13,
  "customers": 18,
  "gmailCustomers": 11
}
```

Implementation fix discovered during verification:

- API workspace scripts run from `apps/api`, so plain `dotenv.config()` did not read the workspace root `.env`.
- Added a shared env loader so API runtime and scripts read root `.env` consistently.

## 2026-08-16 Gmail Subject Display Cleanup

Commands run during implementation:

- `npm run type-check`
- `npm run build`

Result:

- TypeScript type-check passed.
- Production build passed.
- Scope was frontend-only display parsing, so no database migration was required.

## 2026-08-16 Summary and Business Lookup Fix

Commands run during implementation:

- `npm run type-check`
- `npm run build`
- `docker compose up -d postgres`
- `npm run smoke`

Result:

- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Business-risk smoke still verifies the backend enrichment path with a tax id.

Additional GCIS validation:

- Local `.env` was switched to `BUSINESS_REGISTRY_PROVIDER=gcis`.
- `enrichBusinessRisk({customerName: '台積電', taxId: '22099131'})` returned `provider: gcis` and `businessName: 台灣積體電路製造股份有限公司`.
- The older smoke tax id `24500001` is mock-only test data; with GCIS enabled it falls back to mock because the official dataset does not contain that record.

## 2026-08-16 Automatic Gmail Polling

Commands run during implementation:

- `npm run type-check`
- `npm run build`
- `docker compose up -d postgres`
- `npm run smoke`

Result:

- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Scheduler is started from the API server process, so manual smoke does not start a long-running background interval.

## 2026-08-16 Messages Column Role Cleanup

Commands run during implementation:

- `npm run type-check`
- `npm run build`

Result:

- TypeScript type-check passed.
- Production build passed.
- Scope was frontend display/data-fetch behavior; no database migration was required.

## 2026-08-16 Message Analysis Precision Cleanup

Commands run during implementation:

- `npm run type-check`
- `npm run build`
- Direct extraction check for a LumiNote-style collaboration email.

Result:

- TypeScript type-check passed.
- Production build passed.
- LumiNote-style email extracted `intent: 合作邀請`, `projectItem: Instagram Reels`, `expectedDeadline: 2026 年 9 月 15 日`, and did not misclassify `2026` as an amount.

## 2026-08-16 User Journey First Pass

Commands run during implementation:

- `npm run type-check`
- `npm run build`
- `docker compose up -d postgres`
- `npm run smoke`

Result:

- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Gmail status contract now includes auto-sync status fields used by Messages.

## 2026-08-16 Company Name Precision Fix

Commands run during implementation:

- Direct inference check for `我是 LumiNote 行銷團隊的 Amy...`.
- `npm run type-check`
- `npm run build`
- `docker compose up -d postgres`
- `npm run smoke`

Result:

- Customer-name inference returned `LumiNote`.
- Extraction returned `clientName: LumiNote` and summary beginning with `LumiNote 的訊息判斷為...`.
- Existing database row was repaired from `我是 LumiNote 行銷團隊` to `LumiNote`.
- TypeScript type-check, production build, and smoke test passed.

## 2026-08-16 Automatic Business Risk Display

Commands run during implementation:

- `npm run type-check`
- `npm run build`
- `docker compose up -d postgres`
- `npm run smoke`

Result:

- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Business-risk UI no longer depends on manual lookup buttons in Messages or Kanban.

## 2026-08-16 Backend Extraction Precision Pass

Commands run during implementation:

- `npm run type-check`
- `npm run build`
- `docker compose up -d postgres`
- `npm run smoke`

Result:

- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Smoke now reports `extractionRegressionCases: 4`.
- Regression coverage includes collaboration invitation, quote inquiry, revision request, and material-delay deadline risk.

## 2026-08-16 Product Workflow Completion Pass

Commands run during implementation:

- `npm run type-check`
- `npm run build`
- `docker compose up -d postgres`
- `npm run smoke`

Result:

- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Frontend now supports selected-record navigation targets for messages, cases, and customers.

## 2026-08-16 Testing Data Cleanup

Commands run during cleanup:

- One-time DB cleanup script for demo/seed/manual/LINE display records.
- `npm run type-check`
- `npm run build`
- `docker compose up -d postgres`
- `npm run smoke`
- Temporary DB inspection script.

Result:

- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Visible messages by platform: Gmail 5.
- Visible cases by platform: Gmail 5.
- Display/demo messages: 0.
- Display/demo cases: 0.

## 2026-08-16 RAG-Assisted Extraction Pipeline

Commands run during implementation:

- `npm run type-check`
- `npm run build`
- `docker compose up -d postgres`
- `npm run smoke`

Result:

- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Smoke reports `ragAssistedProjectItem: Reels 影片` for a vague promotional video collaboration message.

## 2026-08-16 Message Reanalysis

Commands run during implementation:

- `npm run type-check`
- `npm run build`
- `docker compose up -d postgres`
- `npm run smoke`

Result:

- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Smoke reports `reanalysisProjectItem: Reels 影片`.

## 2026-08-16 Kanban Partner-Centric Cleanup

Commands run during implementation:

- One-time reanalysis of visible Gmail messages.
- One-time cleanup of non-case Gmail records such as calendar invites, announcements, and npm 2FA notifications.
- `npm run type-check`
- `npm run build`
- `docker compose up -d postgres`
- `npm run smoke`

Result:

- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Current visible smoke counts: 1 case, 1 customer, 1 message.
- Active Kanban case is LumiNote with project item `Instagram Reels`, quote amount `null`, and deadline `2026 年 9 月 15 日`.

## 2026-08-16 Reply Draft Freshness Fix

Commands run during implementation:

- `npm run type-check`
- `npm run build`
- `docker compose up -d postgres`
- `npm run smoke`

Result:

- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Current visible smoke counts remain 1 case, 1 customer, 1 message.

## 2026-08-16 Structured RAG Upgrade

Commands run:

- `npm run db:migrate`
- `npm run db:seed`
- `npm run type-check`
- `npm run build`
- `npm run smoke`

Result:

- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- RAG-assisted project inference still returns `Reels 影片`.
- Structured RAG metadata adds relevant missing fields for Reels collaboration: `quote_amount`, `usage_rights`, `revision_scope`, `deliverables`.

## 2026-08-16 Extraction Accuracy Baseline

Commands run:

- `npm run accuracy`
- `npm run type-check`
- `npm run build`
- `npm run smoke`

Result:

- Accuracy script passed across 20 fixtures.
- RAG-off overall accuracy: `0.88`.
- RAG-on overall accuracy: `0.96`.
- RAG before/after improvement: `+0.08` overall.
- RAG-on core extraction fields reached `1.0` for client name, project item, amount, deadline, intent, and non-case classification.
- Remaining errors are limited to strict `missingFields` set matching for some quote/scope cases.
- Confidence output lists warning cases and marks low-confidence records for human review.

## 2026-08-16 Gmail Thread Context MVP

Commands run:

- `npm run accuracy`
- `npm run type-check`
- `npm run build`
- `npm run smoke`

Result:

- Development fixture RAG-on accuracy: `0.96`.
- Holdout fixture RAG-on accuracy: `1.0`.
- Thread fixture accuracy: `1.0`.
- Thread fixtures verify inherited fields, changed fields, conflicting fields, and `needsHumanReview`.
- Smoke verifies that two Gmail imports with the same `threadId` reuse the same case.
- Smoke verifies that a deadline conflict creates a `needs_human_review` alert.

## 2026-08-16 AI Human Review Workflow

Commands run:

- `npm run db:migrate`
- `npm run accuracy`
- `npm run type-check`
- `npm run build`
- `npm run smoke`

Result:

- Accuracy passed: development RAG-on `0.96`, holdout RAG-on `1.0`, thread `1.0`.
- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Smoke verifies thread conflict detection, no pre-review overwrite of the case deadline, applying the suggested value, case deadline update, alert resolution, and review history creation.

## 2026-08-16 Day 9-1 Messages Reply Status

Commands run:

- `npm run db:migrate`
- `npm run type-check`
- `npm run build`
- `npm run smoke`

Result:

- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Smoke verifies case-related import defaults to `pending_reply`.
- Smoke verifies direct non-case message defaults to `no_reply_needed`.
- Smoke verifies user can set `replied` and `no_reply_needed`.
- Smoke verifies reanalysis preserves user-set reply status.
- Messages expose `replyStatus`, enabling frontend reply-status filtering.

## 2026-08-16 Day 9-1B Reply Status History

Commands run:

- `npm run db:migrate`
- `npm run type-check`
- `npm run build`
- `npm run smoke`

Result:

- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Smoke verifies `pending_reply` to `replied` creates a user history row.
- Smoke verifies history contains previous status, new status, source, and changed time.
- Smoke verifies repeated `replied` submission does not create duplicate history.
- Smoke verifies reanalysis preserves user status and does not create history.
- Smoke verifies history is sorted newest first.
- Smoke verifies message deletion cascades reply status history.

## 2026-08-16 Day 9-2A Case Stage and Missing Field Taxonomy

Commands run:

- `npm run db:migrate`
- `npm run accuracy`
- `npm run type-check`
- `npm run build`
- `npm run smoke`

Result:

- Database migration command passed; no persisted `case_stage` column was added.
- Accuracy fixtures still execute with normalized missing field aliases.
- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.
- Smoke verifies status-to-stage mapping for inquiry, quotation, execution, completed, and cancelled.
- Smoke verifies unknown status fallback does not crash.
- Smoke verifies old missing field aliases such as `materials`, `reference`, `quoteAmount`, and `deadline` normalize to standard names.
- Smoke verifies API case serialization includes `caseStage`.

## 2026-08-31 Day 9-2B-1 Stage-Aware Missing Fields

Commands run:

- `npm run db:migrate`
- `npm run type-check`
- `npm run smoke`
- `npm run accuracy`
- `npm run build`

Result:

- Database migration passed and added `alerts.metadata` plus active missing-field alert index.
- TypeScript type-check passed.
- Smoke test passed.
- Accuracy passed: development RAG-on `0.96`, holdout RAG-on `1.0`, thread `1.0`.
- Production build passed.
- Smoke verifies `已確認合作` maps to `confirmed`.
- Smoke verifies confirmed-stage missing fields create one open alert per missing field.
- Smoke verifies rerunning rules does not duplicate missing field alerts.
- Smoke verifies moving a case to `已完成` clears regular missing fields and resolves open `missing_fields` alerts.
- Smoke verifies the missing-field lifecycle does not resolve `needs_human_review` alerts.

## 2026-08-31 Day 9-2B-2 Deadline Semantics and Next Action

Commands run:

- `npm run db:migrate`
- `npm run accuracy`
- `npm run type-check`
- `npm run build`
- `npm run smoke`

Result:

- Database migration passed and added typed deadline/action/material columns to `cases` and `ai_extractions`.
- Accuracy passed with new field-level scoring.
- TypeScript type-check passed.
- Production build passed.
- Smoke test passed.

Latest accuracy:

```json
{
  "developmentRagOn": 0.874,
  "holdoutRagOn": 0.805,
  "thread": 0.923,
  "developmentRagOnFieldAccuracy": {
    "clientName": 1,
    "projectItem": 0.92,
    "quoteAmount": 1,
    "expectedDeadline": 0.92,
    "submissionDeadline": 0.92,
    "publishDeadline": 0.84,
    "nextAction": 0.6,
    "intent": 0.84,
    "requiredMaterials": 0.96,
    "missingFields": 0.72,
    "classification": 1
  }
}
```

New smoke coverage:

- Simultaneous submission and publish deadlines.
- Submission-only deadline.
- Publish-only deadline.
- Generic deadline compatibility.
- Relative `這週五` submission deadline using Asia/Taipei.
- Explicit quote request as `nextAction`.
- Waiting for client materials with `requiredMaterials`.
- Provided Logo attachment not treated as missing.
- Reanalysis does not silently overwrite existing expected, submission, or publish deadlines.
- Thread deadline conflict review now covers multiple deadline review items.
