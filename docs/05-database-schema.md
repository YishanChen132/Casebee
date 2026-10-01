# Database Schema

This document records database tables, fields, and migration notes.

## Planned Tables

- `customers`
- `platform_connections`
- `messages`
- `cases`
- `alerts`
- `rag_examples`
- `ai_extractions`
- `business_profiles`
- `business_risk_scores`
- `message_exclusion_rules`
- `message_reply_status_history`
- `ai_review_items`
- `ai_review_history`

## Initial Migration

File: `database/migrations/001_initial_schema.sql`

### `customers`

Stores client identity and preferred platform.

### `platform_connections`

Stores OAuth tokens and sync status for external platforms such as Gmail.

### `cases`

Stores structured case records generated from messages.

`status` remains the persisted Kanban operational status. Standard six-stage workflow is currently exposed as computed API field `caseStage`; no `case_stage` DB column is persisted. `已確認合作` maps to the standard `confirmed` stage.

Important fields:

- `status`
- `project_item`
- `quote_amount`
- `expected_deadline`
- `submission_deadline`
- `publish_deadline`
- `next_action`
- `next_action_source`
- `required_materials`
- `provided_materials`
- `risk_level`
- `missing_fields`
- `excluded_at`
- `excluded_reason`

### `messages`

Stores normalized platform messages from Gmail, manual import, demo import, or future LINE/Instagram integration.

Messages can be soft-excluded with `excluded_at` and `excluded_reason` when users mark an imported email as unrelated.

Reply workflow fields:

- `reply_status`: `pending_reply`, `replied`, or `no_reply_needed`.
- `reply_status_updated_at`: last reply status update time.
- `reply_status_source`: `system` for defaults, `user` for manual changes.

### `message_reply_status_history`

Stores reply status transitions for auditability.

Important fields:

- `id`
- `message_id`
- `previous_status`
- `new_status`
- `source`
- `changed_at`

Indexes:

- `idx_message_reply_status_history_message_id_changed_at` on `(message_id, changed_at DESC)`.

Deletion strategy:

- `message_id` references `messages(id) ON DELETE CASCADE`, so deleting a message removes its reply status history.

Initial status policy:

- Message creation defaults to `no_reply_needed` but does not create a history row because no transition occurred.
- When a case-related import is marked `pending_reply`, that system transition is recorded.

### `message_exclusion_rules`

Stores learned exclusion rules created from user exclusions.

Current MVP rule:

- `platform = Gmail`
- `match_type = sender_email`
- `match_value = normalized sender email`
- `reason = user-selected exclusion reason`

### `alerts`

Stores rule-based warnings such as overdue replies, deadline risks, and missing fields.

Important fields:

- `metadata`: JSONB metadata for alert-specific lifecycle data. `missing_fields` alerts store `metadata.field` with the normalized missing field name.

Indexes:

- `idx_alerts_missing_field_active` supports active per-field missing alert lookup by `case_id`, `type`, and `metadata.field`.

### `ai_extractions`

Stores AI extraction output for each analyzed message.

Deadline/action/material fields are persisted on each extraction row:

- `submission_deadline`
- `publish_deadline`
- `next_action`
- `next_action_source`
- `required_materials`
- `provided_materials`

Review metadata fields include `overall_confidence`, `field_confidence`, `warnings`, `extracted_fields`, `inherited_fields`, `changed_fields`, `conflicting_fields`, `needs_human_review`, and `review_status`.

### `ai_review_items`

Stores field-level AI suggestions that require human confirmation before updating case-critical fields.

Important fields:

- `message_id`
- `case_id`
- `alert_id`
- `field`
- `existing_value`
- `suggested_value`
- `source`
- `is_conflict`
- `status`
- `resolved_at`

### `ai_review_history`

Stores immutable review decisions after a user applies, keeps, or edits an AI-suggested field.

Important fields:

- `review_item_id`
- `message_id`
- `case_id`
- `field`
- `action`
- `previous_value`
- `suggested_value`
- `final_value`
- `actor`

### `rag_examples`

Stores historical cases and reply examples for similarity retrieval.

Important fields:

- `project_item`
- `quote_amount`
- `outcome`
- `summary`
- `reply_example`
- `is_active`
- `case_type`
- `project_aliases`
- `typical_missing_fields`
- `quote_range_min`
- `quote_range_max`
- `success_pattern`

### `business_profiles`

Stores cached business registry data from the mock provider or future GCIS API provider.

Important fields:

- `customer_id`
- `source`
- `tax_id`
- `registered_name`
- `status`
- `capital_amount`
- `established_date`
- `raw_payload`

### `business_risk_scores`

Stores calculated business risk scores and explainable scoring factors.

Important fields:

- `customer_id`
- `business_profile_id`
- `score`
- `level`
- `positive_factors`
- `negative_factors`
- `calculated_at`

## Seed Data

File: `database/seed/001_demo_data.sql`

Seed data currently creates six RAG historical examples only. Active customers, cases, and messages should come from real Gmail import or manual test import, not static demo rows.

Run with:

```bash
npm run db:seed
```
