# API Contract

This document records frontend/backend API agreements. Update it whenever an endpoint changes.

## Planned Endpoints

- `GET /api/health`
- `GET /api/cases`
- `GET /api/customers`
- `GET /api/customers/:id/details`
- `GET /api/cases/:id`
- `PATCH /api/cases/:id`
- `PATCH /api/alerts/:id/resolve`
- `GET /api/cases/:id/details`
- `GET /api/messages`
- `POST /api/messages/:id/exclude`
- `POST /api/messages/:id/reanalyze`
- `PATCH /api/messages/:id/reply-status`
- `GET /api/messages/:id/reply-status-history`
- `GET /api/messages/:id/review`
- `POST /api/reviews/:id/resolve`
- `POST /api/messages/import`
- `POST /api/webhooks/line`
- `GET /api/integrations/gmail/auth`
- `GET /api/integrations/gmail/callback`
- `GET /api/integrations/gmail/status`
- `POST /api/integrations/gmail/poll`
- `POST /api/ai/analyze-message`
- `POST /api/rules/run`
- `GET /api/rules/status`
- `GET /api/rag/examples`
- `POST /api/rag/examples`
- `PATCH /api/rag/examples/:id/deactivate`
- `POST /api/demo/import`
- `POST /api/business/enrich`
- `GET /api/business/risk-summary`

## Implemented Endpoints

### `GET /api/health`

Returns API service status.

Current response includes database status:

```json
{
  "status": "ok",
  "service": "casebee-api",
  "database": {
    "status": "connected",
    "latencyMs": 33
  }
}
```

### `GET /api/cases`

Returns all case records.

Each case keeps the existing Kanban `status` and also includes computed `caseStage`:

- `inquiry`
- `quotation`
- `confirmed`
- `execution`
- `completed`
- `cancelled`

Current supported Kanban statuses are `潛在詢問`, `需求確認中`, `已報價`, `等待回覆`, `已確認合作`, `進行中`, `等待素材`, `待修改`, `待交付`, `已完成`, and `已流失`.

Case records also include deadline/action/material fields:

- `expectedDeadline`: compatibility deadline, interpreted as the next closest key deadline.
- `submissionDeadline`: delivery-to-client deadline such as draft, script, material, final file, or revision delivery.
- `publishDeadline`: public launch/post/release/campaign deadline.
- `nextAction`: current actionable next step, when known.
- `nextActionSource`: `extracted`, `inferred`, or `user_confirmed`.
- `requiredMaterials`: materials still needed from the client.
- `providedMaterials`: materials explicitly provided by the client.

Response:

```json
{
  "data": []
}
```

### `GET /api/cases/:id`

Returns a single case record by id.

### `GET /api/customers`

Returns customer summaries for the Customers page.

Response:

```json
{
  "data": [
    {
      "id": "customer-id",
      "name": "客戶名稱",
      "platform": "Gmail",
      "contactHandle": "contact@example.com",
      "lastContactAt": "2026-08-06T00:00:00.000Z",
      "caseCount": 2,
      "activeCaseCount": 1,
      "riskCaseCount": 1,
      "latestCaseUpdatedAt": "2026-08-06T00:00:00.000Z"
    }
  ]
}
```

### `GET /api/customers/:id/details`

Returns customer detail for the Customers modal.

Response:

```json
{
  "data": {
    "customer": {},
    "cases": [],
    "messages": [],
    "businessProfile": null,
    "businessRiskScore": null
  }
}
```

### `GET /api/cases/:id/details`

Returns a case detail bundle for the Kanban case modal.

Response:

```json
{
  "data": {
    "case": {},
    "messages": [],
    "alerts": [],
    "aiExtractions": [],
    "businessProfile": null,
    "businessRiskScore": null,
    "similarCases": []
  }
}
```

### `PATCH /api/cases/:id`

Updates mutable case fields. Current implementation supports status updates for Kanban drag-and-drop and case detail editing.

After a case update, the API recomputes stage-aware `missingFields` and syncs open `missing_fields` alerts. Completed and cancelled stages resolve regular missing field alerts; non-missing alerts are left unchanged.

If a case is moved to `已完成` or `已流失`, regular `nextAction` is cleared.

Request:

```json
{
  "status": "進行中",
  "quoteAmount": 12000,
  "expectedDeadline": "2026-09-15",
  "summary": "客戶已確認 Logo 與名片設計方向，等待報價確認。"
}
```

### `PATCH /api/alerts/:id/resolve`

Alert records include optional `metadata`. For `missing_fields`, `metadata.field` stores the normalized missing field name used for per-field deduplication and resolution.

Marks one alert as handled and returns the updated alert.

Response:

```json
{
  "data": {
    "id": "alert-...",
    "caseId": "case-...",
    "type": "reply_overdue",
    "title": "未回覆逾時",
    "message": "...",
    "severity": "warning",
    "resolvedAt": "2026-08-06T...Z",
    "createdAt": "2026-08-06T...Z"
  }
}
```

All fields are optional. Use `null` for `quoteAmount` or `expectedDeadline` to clear the value.

Response:

```json
{
  "data": {}
}
```

### `GET /api/messages`

Returns all normalized message events.

Each message includes reply status fields:

- `replyStatus`: `pending_reply`, `replied`, or `no_reply_needed`.
- `replyStatusUpdatedAt`: last status update timestamp.
- `replyStatusSource`: `system` or `user`.

### `PATCH /api/messages/:id/reply-status`

Updates a message reply status from the Messages workspace.

Request:

```json
{
  "replyStatus": "replied"
}
```

Successful status changes create `message_reply_status_history` in the same database transaction. Repeating the same status does not create a duplicate history row.

### `GET /api/messages/:id/reply-status-history`

Returns reply status history for one message, newest first.

Response:

```json
{
  "data": [
    {
      "id": "reply-history-...",
      "messageId": "msg-...",
      "previousStatus": "pending_reply",
      "newStatus": "replied",
      "source": "user",
      "changedAt": "2026-08-16T...Z"
    }
  ]
}
```

Response:

```json
{
  "data": {
    "id": "msg-...",
    "replyStatus": "replied",
    "replyStatusSource": "user",
    "replyStatusUpdatedAt": "2026-08-16T...Z"
  }
}
```

Excluded messages are hidden from this endpoint.

### `POST /api/messages/:id/exclude`

Soft-excludes a message. If the message's case has no remaining active messages, the case is soft-excluded too.

Request:

```json
{
  "reason": "不是客戶或案件相關郵件"
}
```

Response:

```json
{
  "data": {
    "message": {},
    "excludedCaseId": "case-..."
  }
}
```

### `POST /api/messages/:id/reanalyze`

Re-runs the latest extraction pipeline for an existing message.

Behavior:

- Loads the existing message.
- Runs email preprocessing, message classification, RAG-assisted extraction, validation, and AI provider fallback.
- Creates a new `ai_extractions` row.
- If the message is linked to a case, updates the case project item, amount, deadline, summary, status, risk level, and missing fields.
- Re-runs rules for the updated case.

Response:

```json
{
  "data": {
    "message": {},
    "extraction": {},
    "case": {},
    "caseDetail": {},
    "alerts": [],
    "modelName": "rule-rag-fallback confidence 0.82",
    "similarCases": []
  }
}
```

### `POST /api/messages/import`

Imports a message event, runs extraction, and creates or updates the related case. Gmail imports pass `threadId` so follow-up messages in the same Gmail thread can reuse the existing case.

Required fields:

- `platform`
- `senderName`
- `text`

Response:

```json
{
  "data": {
    "message": {},
    "extraction": {},
    "case": {},
    "alerts": [],
    "modelName": "rule-based-mvp",
    "similarCases": [],
    "threadContext": {
      "extractedFields": {},
      "inheritedFields": {},
      "changedFields": {},
      "conflictingFields": [],
      "needsHumanReview": false,
      "threadSummary": null,
      "existingCaseId": null
    }
  }
}
```

Processing flow:

```text
message import
→ store message
→ thread-aware extraction
→ store ai_extractions
→ find existing case by thread_id when available
→ create case or update existing case
→ attach message to case
→ create human-review alert when thread fields conflict
→ run rules
→ return generated objects
```

### `GET /api/messages/:id/review`

Returns pending/resolved AI review items and review history for one message.

Response:

```json
{
  "data": {
    "items": [
      {
        "id": "review-...",
        "messageId": "msg-...",
        "caseId": "case-...",
        "alertId": "alert-...",
        "field": "expectedDeadline",
        "existingValue": "11/30",
        "suggestedValue": "11/15",
        "source": "conflict",
        "isConflict": true,
        "status": "pending",
        "resolvedAt": null
      }
    ],
    "history": []
  }
}
```

### `POST /api/reviews/:id/resolve`

Resolves one pending review item.

Request:

```json
{
  "action": "apply",
  "value": "optional manual value for edit"
}
```

Supported actions:

- `apply`: use the AI suggested value and update the case field.
- `keep`: keep the existing case value.
- `edit`: use the provided manual value and update the case field.

When all pending review items for the case are resolved, open `needs_human_review` alerts are automatically resolved and review history is written.

### `GET /api/integrations/gmail/status`

Returns Gmail connection state.

Response:

```json
{
  "data": {
    "connected": false,
    "accountEmail": null,
    "lastSyncedAt": null,
    "configured": false,
    "redirectUri": "http://localhost:4000/api/integrations/gmail/callback"
  }
}
```

### `GET /api/integrations/gmail/auth`

Returns a Google OAuth authorization URL.

Requires:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

### `GET /api/integrations/gmail/callback`

OAuth callback endpoint. Stores Gmail access/refresh tokens in `platform_connections`.

### `POST /api/integrations/gmail/poll`

Polls recent Gmail messages and imports them into the message-to-case pipeline.

Response:

```json
{
  "data": {
    "checkedCount": 1,
    "importedCount": 1,
    "skippedCount": 0,
    "emptyCount": 0,
    "failedCount": 0,
    "query": "newer_than:30d",
    "imported": [],
    "skipped": [],
    "failed": []
  }
}
```

Deduplication behavior:

- Each Gmail message is checked by `gmailMessageId` stored in `messages.raw_payload`.
- Existing Gmail messages are returned in `skipped` and are not imported again.

### `POST /api/demo/import`

Imports the built-in demo message set through the standard message-to-case pipeline.

Response:

```json
{
  "data": {
    "importedCount": 6,
    "skippedCount": 0,
    "imported": [],
    "skipped": []
  }
}
```

Deduplication behavior:

- Each demo message is checked by `demoMessageId` stored in `messages.raw_payload`.
- Existing demo messages are returned in `skipped` and are not imported again.

### `POST /api/rules/run`

Runs scheduled/manual rules. Current implementation runs the reply-overdue rule.

Response:

```json
{
  "data": {
    "checkedCount": 3,
    "createdCount": 1,
    "thresholdHours": 24,
    "alerts": []
  }
}
```

### `GET /api/rules/status`

Returns the current reply-overdue rule mode and threshold.

Response:

```json
{
  "data": {
    "thresholdHours": 24,
    "mode": "manual",
    "nextRunAt": null,
    "description": "目前採手動執行..."
  }
}
```

### `POST /api/business/enrich`

Looks up a customer or tax id using the current business registry provider, stores the profile, calculates a risk score, and returns both.

Provider behavior:

- `BUSINESS_REGISTRY_PROVIDER=mock`: uses local demo registry records.
- `BUSINESS_REGISTRY_PROVIDER=gcis`: calls GCIS company registration API by tax id, then falls back to mock lookup if GCIS fails or has no result.

Request:

```json
{
  "customerName": "晴天行銷",
  "taxId": "24500001"
}
```

Response:

```json
{
  "data": {
    "profile": {},
    "riskScore": {},
    "provider": "mock"
  }
}
```

### `GET /api/rag/examples`

Returns historical examples for Settings knowledge-base management. Inactive examples are returned for visibility, but similarity retrieval only uses active examples.

Response:

```json
{
  "data": []
}
```

### `POST /api/rag/examples`

Creates a new active RAG example.

Request:

```json
{
  "title": "形象網站詢價成交",
  "platform": "Manual",
  "projectItem": "形象網站",
  "quoteAmount": 45000,
  "outcome": "成交",
  "summary": "客戶需要 5 頁形象網站...",
  "replyExample": "可以先確認頁數與素材..."
}
```

### `PATCH /api/rag/examples/:id/deactivate`

Disables one RAG example. The row is retained for Settings history but excluded from similar-case matching.

### `GET /api/business/risk-summary`

Returns current business risk distribution for Dashboard.

Response:

```json
{
  "data": {
    "low": 1,
    "medium": 0,
    "high": 1,
    "unverified": 1,
    "averageScore": 72
  }
}
```

### `POST /api/webhooks/line`

Placeholder endpoint for LINE Messaging API webhook. Signature verification and message persistence are not implemented yet.

Current response:

```json
{
  "ok": true,
  "receivedEvents": 0
}
```
