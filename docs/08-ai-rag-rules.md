# AI, RAG, and Rules

## AI Extraction

The AI layer should return strict JSON for each analyzed message.

Extraction schema includes:

- `submissionDeadline`: draft, script, material, final delivery, or revision delivery date to the client.
- `publishDeadline`: public launch, post, release, listing, or campaign date.
- `expectedDeadline`: compatibility deadline used as the next closest key deadline.
- `nextAction`: current actionable next step.
- `nextActionSource`: `extracted`, `inferred`, or `user_confirmed`.
- `requiredMaterials`: materials still needed from the client.
- `providedMaterials`: materials explicitly provided by the client.

Current MVP implementation supports three providers through `AI_PROVIDER`:

- `rule`: deterministic rule-based extraction.
- `openai`: OpenAI Chat Completions JSON extraction.
- `gemini`: Gemini JSON extraction.

OpenAI and Gemini failures fall back to rule-based extraction so the demo remains usable.

## Environment Variables

```text
AI_PROVIDER=rule
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash
```

## Required Fields

- `client_name`
- `project_item`
- `quote_amount`
- `expected_deadline`
- `intent`
- `case_status`
- `missing_fields`
- `summary`
- `suggested_reply`

## Rule Engine MVP

- Alert when a client message has not been replied to within `REPLY_OVERDUE_HOURS` hours.
- Alert when a deadline is within 3 days and the case is not completed.
- Alert when stage-required fields are missing.
- Current execution mode is manual from Settings. `GET /api/rules/status` exposes the current threshold and confirms that no automatic next run is scheduled yet.

## Implemented Rules

- Missing stage-required fields create per-field `missing_fields` alerts with `metadata.field`.
- Deadline text containing `今天`, `明天`, `後天`, or `本週` creates a `deadline_risk` alert.
- Generated alerts update case `risk_level` to `warning` or `danger`.
- Scope change terms such as `順便`, `追加`, `加做`, `改成`, `修改`, and `調整` create a `scope_change` alert.
- Likely high-effort work under 10000 creates a `low_budget` alert.
- Urgent timing terms create an `urgent_reply` alert.
- Two or more missing core fields create a `needs_clarification` alert.
- Manual/scheduled rule execution creates `reply_overdue` alerts for active cases whose latest message is older than the configured threshold.

## Stage-Aware Missing Fields

Standard stages are computed from Kanban status rather than persisted as a separate DB column.

- `inquiry`: `client_name`, `project_item`, `deliverables`, `expected_deadline`, `quote_amount`.
- `quotation`: `project_item`, `deliverables`, `quote_amount`, `expected_deadline`, `scope`, `usage_rights`, `revision_scope`.
- `confirmed`: `project_item`, `deliverables`, `expected_deadline`, `quote_amount`, `contract`, `payment_terms`, `revision_scope`.
- `execution`: `project_item`, `deliverables`, `expected_deadline`, `required_materials`, `next_action`.
- `completed`: no regular missing field alerts.
- `cancelled`: no regular missing field alerts.

Missing field lifecycle:

- Create one open `missing_fields` alert per missing normalized field.
- Do not create duplicates for the same case and field.
- Resolve open missing field alerts when the field is no longer required or no longer missing.
- Resolve regular missing field alerts when a case moves to completed or cancelled.
- Do not resolve `needs_human_review`, deadline, reply overdue, or other non-missing alerts.

Day 9-2B-2 deadline/material rules:

- A deadline near `交稿`, `初稿`, `腳本`, `素材`, `成品`, `修改稿`, `交件`, `交付`, `完稿`, or `提交` becomes `submissionDeadline`.
- A deadline near `上線`, `發布`, `貼文日`, `貼文上線`, `貼文發布`, `公開`, `活動開始`, `上架`, or `刊登` becomes `publishDeadline`.
- Generic phrases such as `希望 9/15 前完成` remain only `expectedDeadline` unless the text clearly identifies delivery or publish semantics.
- Relative dates use the message received time in Asia/Taipei.
- If both typed deadlines exist, `expectedDeadline` uses `submissionDeadline` because it is the earlier action-oriented deadline. If only one typed deadline exists, `expectedDeadline` mirrors that value. Otherwise it uses the generic deadline.
- Execution-stage `submission_deadline`, `publish_deadline`, and `required_materials` missing fields are conditional on message semantics; they are not added to every execution case.
- `requiredMaterials` only contains pending materials. `附件提供 Logo` is treated as provided, not missing.
- Reanalysis preserves existing case deadlines when a new extraction proposes a different date; thread conflicts for typed dates go through the human review workflow.

## Alert Types

- `missing_fields`: required case slots are incomplete.
- `reply_overdue`: latest customer message is older than the configured reply threshold.
- `deadline_risk`: deadline appears urgent or risky.
- `scope_change`: message may contain additional or changed requirements.
- `low_budget`: budget may be low for the detected deliverable.
- `urgent_reply`: message should be prioritized.
- `needs_clarification`: too many core fields are missing for reliable quoting.

## Implemented Extraction Heuristics

- Client name: shared customer-name inference, including cleanup for phrases such as `我是...團隊`.
- Amount: context-aware extraction near budget/quote/fee terms; years and dates are not treated as amounts.
- Project item: labeled-line extraction such as `合作形式`, `需求項目`, `專案項目`, then keyword fallback for Logo, 名片, 官網, 網站, 貼文, Reels, 短影音, 影片, Banner, 產品攝影, 包裝設計, and簡報設計.
- Deadline: labeled-line extraction such as `預計上線時間`, `交件時間`, `期限`, plus deadline-context matching near `交件`, `完成`, `上線`, or `截止`.
- Intent: keyword classification for 合作邀請, 詢價, 確認合作, 修改需求, and 交期風險.
- Suggested reply: generated from missing fields and intent instead of a single fixed template.

## Extraction Regression Coverage

`npm run smoke` includes deterministic extraction regression cases for:

- LumiNote-style collaboration invitation.
- Website quote inquiry with amount and deadline.
- Revision/scope-change request.
- Material-delay deadline risk.

These cases reduce the backend AI precision risk while the project remains able to fall back to deterministic parsing when OpenAI/Gemini are unavailable.

## Accuracy Baseline

`npm run accuracy` runs a larger fixture-based baseline from `apps/api/src/fixtures/extraction/accuracy-fixtures.json`.

The baseline reports:

- RAG-off accuracy.
- RAG-on accuracy.
- RAG before/after delta.
- Field-level accuracy for `clientName`, `projectItem`, `quoteAmount`, `expectedDeadline`, `intent`, `missingFields`, and non-case `classification`.
- Error categories such as `missing`, `false_positive`, `too_generic`, `wrong_project`, `wrong_client`, `wrong_type`, `date_or_context_mismatch`, and missing-field set errors.
- Low-confidence and warning cases for human review.

Current baseline after targeted fixes:

```json
{
  "fixtureCount": 20,
  "ragOffOverallAccuracy": 0.88,
  "ragOnOverallAccuracy": 0.96,
  "ragOverallDelta": 0.08,
  "ragOnFieldAccuracy": {
    "clientName": 1,
    "projectItem": 1,
    "quoteAmount": 1,
    "expectedDeadline": 1,
    "intent": 1,
    "missingFields": 0.75,
    "classification": 1
  }
}
```

The accuracy command now also reports:

- `development`: the main tuning dataset.
- `holdout`: independent fixtures used to check overfitting.
- `thread`: multi-message thread context fixtures.

Current thread baseline:

```json
{
  "fixtureCount": 3,
  "overallAccuracy": 1,
  "needsHumanReviewCount": 1
}
```

## Gmail Thread Context

Thread-aware extraction is implemented as an enrichment layer around the existing extraction pipeline. It does not replace `AiExtraction`.

Input separation:

- Current message: the message currently being imported or reprocessed.
- Thread summary: compact summary of previous messages in the same `thread_id`.
- Existing case state: the current Casebee case fields already linked to the thread.

Output separation:

- `extractedFields`: values found directly in the current message.
- `inheritedFields`: values copied from existing case state because the current message did not restate them.
- `changedFields`: values explicitly provided by the current message that differ from missing or previous values.
- `conflictingFields`: project, quote, or deadline changes that conflict with existing case state.
- `needsHumanReview`: true when conflicts require manual confirmation.

Gmail import behavior:

- Gmail `threadId` is stored in `messages.thread_id` and `raw_payload.threadId`.
- If an incoming Gmail message has a thread id already linked to an active case, Casebee attaches the message to that case instead of creating a duplicate case.
- Field conflicts create a `needs_human_review` alert and keep the existing case value until a human confirms the change.

## AI Human Review Workflow

Human review is required when thread-aware extraction detects a changed or conflicting case-critical field.

Persisted metadata:

- `overall_confidence`
- `field_confidence`
- `warnings`
- `extracted_fields`
- `inherited_fields`
- `changed_fields`
- `conflicting_fields`
- `needs_human_review`
- `review_status`

Review behavior:

- Case-critical fields are `projectItem`, `quoteAmount`, and `expectedDeadline`.
- Changed or conflicting critical fields are stored as `ai_review_items`.
- Case values are not overwritten before confirmation.
- Messages can filter pending-review records and compare existing value, suggested value, and source.
- Users can apply the suggested value, keep the existing value, or enter a manual value.
- Each decision creates `ai_review_history`.
- When all pending review items for a case are resolved, the related `needs_human_review` alert is closed.

## Day 9-2A Case Stages

Casebee standardizes case lifecycle into six stages while keeping the existing Kanban `status` values.

Stages:

- `inquiry`: initial invitation, vague interest, early requirements gathering.
- `quotation`: price, scope, deadline, contract, or terms are being negotiated.
- `confirmed`: collaboration has been accepted but work may not have started yet.
- `execution`: production, material collection, revision, delivery, or handoff is active.
- `completed`: work is finished.
- `cancelled`: client cancelled, paused indefinitely, or the case is lost.

Current status mapping:

- `潛在詢問` -> `inquiry`
- `需求確認中` -> `inquiry`
- `已報價` -> `quotation`
- `等待回覆` -> `quotation`
- `進行中` -> `execution`
- `等待素材` -> `execution`
- `待修改` -> `execution`
- `待交付` -> `execution`
- `已完成` -> `completed`
- `已流失` -> `cancelled`

Unknown status values fall back to `inquiry` for safe serialization. The `confirmed` stage is defined for future workflow rules, but no current Kanban status maps to it yet.

## Day 9-2A Missing Field Taxonomy

Standard missing field names:

- `client_name`: client company, brand, or person responsible for the case.
- `project_item`: primary service or project category requested.
- `deliverables`: concrete output items, such as one Reels video or six posts.
- `scope`: boundary of work, including quantity, included tasks, excluded tasks, and scope changes.
- `quote_amount`: budget, quoted price, or fee amount.
- `expected_deadline`: general deadline when the message does not distinguish submission vs publish timing.
- `usage_rights`: usage period, channels, licensing, reposting, ad usage, or ownership terms.
- `revision_scope`: both revision rounds and what types of changes are included.
- `contract`: whether contract/signing workflow is mentioned or still needs confirmation before execution; it is not simply a boolean for unsigned contract.
- `payment_terms`: deposit, final payment, invoice, tax, and milestone terms.
- `required_materials`: materials the client must provide before work can proceed.
- `submission_deadline`: freelancer-side draft, first version, final file, or submission deadline.
- `publish_deadline`: public launch, posting, campaign go-live, or website release deadline.
- `next_action`: current next action is unclear.

Clarifications:

- `scope` is the work boundary. `deliverables` are the concrete outputs inside that boundary.
- `expected_deadline` is a generic fallback deadline. `submission_deadline` is when the freelancer must submit work. `publish_deadline` is when the asset goes live publicly.
- `contract` means contract workflow still needs confirmation or is a relevant gating item, not necessarily that a contract definitely does not exist.
- `revision_scope` includes both revision count and allowed revision range.
- `required_materials` means client-provided assets that are necessary before work can continue.
- `next_action` means Casebee cannot determine whether the user should quote, request info, schedule, deliver, or close.

Alias normalization:

- `clientName`, `customerName` -> `client_name`
- `projectItem`, `project` -> `project_item`
- `amount`, `quoteAmount`, `budget` -> `quote_amount`
- `deadline`, `expectedDeadline` -> `expected_deadline`
- `materials`, `material`, `required_material`, `reference`, `references` -> `required_materials`
- `revision`, `revisions` -> `revision_scope`
- `usage`, `rights` -> `usage_rights`
- `payment` -> `payment_terms`
- `nextStep` -> `next_action`

Day 9-2B-1 implements stage-aware missing-field rules and missing field alert lifecycle.

## RAG MVP

Historical cases are stored in `rag_examples` and seeded by `database/seed/001_demo_data.sql`.

Settings can create new examples and deactivate low-quality examples. Deactivated examples remain visible for management, but the matching service only reads active examples.

Current retrieval uses local keyword scoring:

- Project item match.
- Project aliases such as `短影音`, `宣傳影片`, `IG 限動`, and `Instagram Reels`.
- Case type match such as `collaboration_invite`, `quote_inquiry`, and `revision_request`.
- Quote amount proximity.
- Token overlap between current extraction and historical title/project/outcome/summary.
- Text-first similarity lookup before final extraction, used as RAG context for ambiguous project items.
- Chinese phrase groups for video/Reels, website, logo/branding, social posts, photography, and collaboration invites.

The import pipeline returns `similarCases`. The Messages page displays score, amount, outcome, summary, and historical reply example as reply-support context.

RAG is now also used before final deterministic extraction:

1. Preprocess email.
2. Classify message type.
3. Retrieve similar active RAG examples from clean text.
4. Let the deterministic extractor use similar cases to refine broad project items such as `影片` into `Reels 影片`.
5. Validate extraction confidence and warnings at runtime.

This is still not vector RAG, but it moves RAG from display-only support into the extraction pipeline.

## Structured RAG Metadata

RAG examples store structured fields in addition to free-text summary and reply examples:

- `case_type`: normalized business scenario such as `collaboration_invite`, `quote_inquiry`, or `revision_request`.
- `project_aliases`: alternate terms that map to the same project item.
- `typical_missing_fields`: fields usually required before quoting or accepting the case.
- `quote_range_min` / `quote_range_max`: historical quote range for future pricing support.
- `success_pattern`: concise description of what worked in the past.

These fields are used by extraction and reply generation, not only displayed in Settings. For example, a Reels collaboration can add `usage_rights`, `revision_scope`, and `deliverables` as missing fields even when the core project item and deadline were already extracted.

## Reanalysis

Existing messages can be reprocessed through `POST /api/messages/:id/reanalyze`.

Reanalysis creates a new AI extraction row and updates the linked case fields with the latest normalized extraction result. This allows old Gmail imports to benefit from newer preprocessing, classification, RAG-assisted extraction, and validation logic without deleting or re-importing Gmail data.

UI placement:

- Messages: show similar historical cases after a message is imported/analyzed.
- Settings: manage knowledge-base examples by adding or deactivating them.
- Kanban: do not show similar historical cases in the case modal; the modal stays focused on active project execution.

Future replacement path:

- Add embeddings to `rag_examples.embedding`.
- Use pgvector or an external vector database.
- Replace `ragService` scoring without changing the API response shape.
