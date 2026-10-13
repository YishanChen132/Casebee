# P4-B Exclusion Management API Contract

Date: 2026-10-12

Scope: classification exclusion management, recovery, and Gmail auto-skipped persistence. This does not change Classification, Extraction, RAG, or Hybrid Search logic.

## Database Migrations

- `001_initial_schema.sql` remains the baseline schema.
- `002_p4b_exclusion_source.sql` adds `messages.exclusion_source` and `cases.exclusion_source` as a forward-only migration.
- `003_p4b_gmail_skipped_messages.sql` adds `gmail_skipped_messages` for Gmail auto-skipped metadata.
- The migration runner now executes all `database/migrations/*.sql` files in filename order.
- Existing migrations are idempotent and use `IF NOT EXISTS`, so existing databases receive new columns/tables on the next `npm run db:migrate`.

Rollback note:

- No destructive rollback is provided. To disable P4-B behavior, stop using the new API routes and leave columns/tables in place.
- Do not drop `gmail_skipped_messages` if any skipped Gmail recovery audit trail is needed.

## Message Exclusion

`GET /api/messages?visibility=active|excluded|all`

- `active` returns non-excluded messages.
- `excluded` returns soft-excluded messages.
- `all` returns both.
- Excluded records include `excludedAt`, `excludedReason`, and `exclusionSource`.

`POST /api/messages/:id/exclude`

- Excludes only the selected message.
- Sets `messages.exclusion_source = manual_message`.
- Does not create sender exclusion rules.
- If the message was the last active message on a case, the case is hidden with `cases.exclusion_source = system_auto_case`.

`POST /api/messages/:id/exclude-sender`

- Excludes the selected message and creates or reactivates a Gmail sender exclusion rule.
- Sets `messages.exclusion_source = sender_rule`.
- Future Gmail from the same sender is skipped by learned exclusion.

`POST /api/messages/:id/restore`

- Clears message exclusion fields.
- Preserves Message ID, Case ID, and Thread ID.
- Restores a linked Case only when `cases.exclusion_source = system_auto_case`.
- Does not restore manually excluded cases.
- Repeated restore is idempotent and does not create duplicate Cases.

## Sender Rule Management

`GET /api/message-exclusion-rules`

- Lists sender exclusion rules, including inactive rules.
- Includes platform, match type, match value, reason, source message, active state, and timestamps.

`PATCH /api/message-exclusion-rules/:id`

Request:

```json
{"isActive": false}
```

- Deactivates or reactivates a rule.
- Does not delete rules.
- Does not automatically restore historical messages.

## Gmail Auto-skipped Management

`GET /api/integrations/gmail/skipped?status=pending|restored|all`

- Returns Gmail messages skipped by auto triage or sender rules.
- Stores metadata only: Gmail message id, thread id, connection scope, sender, subject, snippet, category, reason, source, skipped time, retry state, restored message id, and last error.
- Does not store full raw Gmail body by default.

`POST /api/integrations/gmail/skipped/:id/import`

- Re-fetches the Gmail message from Gmail API.
- Uses a one-time user-requested override so the same exclusion rule does not block this recovery attempt.
- Still runs existing normalization, Extraction, case creation/update, alerts, and review logic.
- Checks duplicate Gmail message id before import.
- If already imported or restored, returns existing message and does not create duplicates.
- On Gmail API/auth/content failure, records `lastError` and `lastRetryAt` on the skipped record.

## Known Limits

- Single-tenant remains unchanged; connection scope is recorded for future expansion but not enforced as workspace isolation.
- Gmail API failure tests are covered through skipped-record error persistence, not external live Gmail calls in smoke.
- `UNCERTAIN` messages are not auto-skipped by P4-B; they remain outside permanent exclusion unless explicitly excluded by the user.
