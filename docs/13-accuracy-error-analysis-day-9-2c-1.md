# Day 9-2C-1 Accuracy Error Analysis

Date: 2026-08-31

Scope: accuracy evaluation improvements only. Extraction prompt, RAG, rule engine, Dashboard, and Kanban were not changed.

## Comparability

The current overall accuracy is not directly comparable with the previous `0.96` development and `1.0` holdout numbers.

- Development fixtures changed from 20 to 29.
- Development scored fields changed from 100 to 254.
- Holdout fixtures stayed at 5, but scored fields changed from 25 to 41.
- New scored fields are `submissionDeadline`, `publishDeadline`, `nextAction`, and `requiredMaterials`.
- Thread fixtures changed from 3 to 5.

Conclusion: the lower overall values mainly reflect a larger denominator and harder field set, not a pure model regression.

## Current Overall Results

- Development RAG-off: `0.858`.
- Development RAG-on: `0.874`.
- Holdout RAG-off: `0.732`.
- Holdout RAG-on: `0.805`.
- Thread context: `0.923`.

## Development RAG-On Field Metrics

| Field | Samples | Correct | FP | FN | Wrong | Accuracy | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| projectItem | 25 | 23 | 0 | 0 | 2 | 0.92 | 0.92 | 0.92 | 0.92 |
| expectedDeadline | 25 | 23 | 0 | 0 | 2 | 0.92 | 0.92 | 0.92 | 0.92 |
| submissionDeadline | 25 | 23 | 2 | 0 | 0 | 0.92 | 0.92 | 1.0 | 0.958 |
| publishDeadline | 25 | 21 | 4 | 0 | 0 | 0.84 | 0.84 | 1.0 | 0.913 |
| nextAction | 25 | 15 | 10 | 0 | 0 | 0.60 | 0.60 | 1.0 | 0.75 |
| intent | 25 | 21 | 0 | 0 | 4 | 0.84 | 0.84 | 0.84 | 0.84 |
| requiredMaterials | 25 | 24 | 1 | 0 | 0 | 0.96 | 0.96 | 1.0 | 0.98 |
| missingFields | 25 | 18 | 3 | 4 | 0 | 0.72 | 0.857 | 0.818 | 0.837 |

## Holdout RAG-On Field Metrics

| Field | Samples | Correct | FP | FN | Wrong | Accuracy | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| projectItem | 4 | 4 | 0 | 0 | 0 | 1.0 | 1.0 | 1.0 | 1.0 |
| expectedDeadline | 4 | 3 | 0 | 0 | 1 | 0.75 | 0.75 | 0.75 | 0.75 |
| submissionDeadline | 4 | 2 | 2 | 0 | 0 | 0.50 | 0.50 | 1.0 | 0.667 |
| publishDeadline | 4 | 3 | 1 | 0 | 0 | 0.75 | 0.75 | 1.0 | 0.857 |
| nextAction | 4 | 1 | 3 | 0 | 0 | 0.25 | 0.25 | 1.0 | 0.40 |
| intent | 4 | 4 | 0 | 0 | 0 | 1.0 | 1.0 | 1.0 | 1.0 |
| requiredMaterials | 4 | 3 | 1 | 0 | 0 | 0.75 | 0.75 | 1.0 | 0.857 |
| missingFields | 4 | 4 | 0 | 0 | 0 | 1.0 | 1.0 | 1.0 | 1.0 |

## Thread Field Metrics

| Field | Samples | Correct | FP | FN | Wrong | Accuracy | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| projectItem | 5 | 5 | 0 | 0 | 0 | 1.0 | 1.0 | 1.0 | 1.0 |
| expectedDeadline | 5 | 5 | 0 | 0 | 0 | 1.0 | 1.0 | 1.0 | 1.0 |
| submissionDeadline | 5 | 5 | 0 | 0 | 0 | 1.0 | 1.0 | 1.0 | 1.0 |
| publishDeadline | 5 | 5 | 0 | 0 | 0 | 1.0 | 1.0 | 1.0 | 1.0 |
| nextAction | 5 | 5 | 0 | 0 | 0 | 1.0 | 1.0 | 1.0 | 1.0 |
| intent | 5 | 4 | 0 | 0 | 1 | 0.8 | 0.8 | 0.8 | 0.8 |
| requiredMaterials | 5 | 5 | 0 | 0 | 0 | 1.0 | 1.0 | 1.0 | 1.0 |

## NextAction Evaluation

The accuracy report now outputs both exact and category accuracy.

- Development RAG-on exact: `0.60`.
- Development RAG-on category: `0.60`.
- Holdout RAG-on exact: `0.25`.
- Holdout RAG-on category: `0.25`.
- Thread exact: `1.0`.
- Thread category: `1.0`.

The identical exact/category results mean the current failures are mostly false-positive action creation, not semantically equivalent text being marked wrong.

Action categories used by the evaluator:

- `provide_quote`
- `confirm_schedule`
- `wait_for_client_confirmation`
- `request_materials`
- `wait_for_materials`
- `prepare_draft`
- `submit_draft`
- `revise_content`
- `confirm_contract`
- `confirm_payment`
- `publish_content`
- `no_action`

## MissingFields Evaluation

Development RAG-on:

- Exact set accuracy: `0.72`.
- Field-level precision: `0.914`.
- Field-level recall: `0.842`.
- Field-level F1: `0.877`.

Holdout RAG-on:

- Exact set accuracy: `1.0`.
- Field-level precision: `1.0`.
- Field-level recall: `1.0`.
- Field-level F1: `1.0`.

Conclusion: development exact-set scoring understates partial correctness. A fixture with 3 of 4 expected missing fields correct used to count as fully wrong in exact-set accuracy; field-level F1 shows the missingFields behavior is better than the exact number implies.

## Top Error Sources

Across development, holdout, and thread detailed errors:

1. `false_positive`: 51.
2. `false_negative`: 16.
3. `wrong_value`: 12.
4. `evaluation_mismatch`: 6.
5. `thread_inheritance_error`: 4.

Top possible causes:

1. Exact nextAction string/category evaluation exposes frequent false-positive next actions: 26.
2. MissingFields exact-set scoring hides partial matches: 20.
3. Typed deadline classification or generic deadline being treated as typed deadline: 18.
4. Deterministic extraction output differs from fixture expectation: 6.
5. expectedDeadline compatibility, relative-date normalization, or fixture date-format mismatch: 6.

## Real Extraction Issues

- `nextAction` is over-produced, especially `提供報價`, `確認合約`, `等待客戶提供素材`, and `準備／提交初稿` when fixtures expect no action.
- `publishDeadline` is sometimes produced for collaboration/posting phrases where fixture expectations still treat the date as generic or not typed.
- `submissionDeadline` is sometimes produced for generic delivery/risk language where the fixture expects no typed deadline.
- `requiredMaterials` can overmatch generic `產品` when the text describes product photography rather than a requested material.
- Some `projectItem` mismatches occur only with RAG-on, such as broad `影片` becoming `Reels 影片`.

## Evaluation Method Issues

- Overall accuracy is not comparable with the pre-Day-9-2B-2 baseline because fixture count and scored fields changed.
- Several date mismatches are format/normalization issues rather than extraction failures, such as natural language fixture expectations versus normalized `M/D` output.
- MissingFields exact-set accuracy is too harsh for partial matches; field-level F1 should be reviewed alongside exact-set accuracy.
- Some fixtures may now contradict Day 9-2B-2 typed deadline rules. Example: phrases containing `上線` or `發布` may legitimately create `publishDeadline`, while older fixtures expected `null`.
- Thread expected inherited/changed/conflicting field lists need review because adding typed deadlines means `expectedDeadline` can change as a compatibility field when `publishDeadline` changes.

## RAG-Caused Errors

- RAG-on can change broad project items into more specific project items, improving old RAG-assisted cases but causing some new deadline-semantics fixtures to fail when they expect generic `影片` or `短影音`.
- RAG can add `required_materials` through typical missing fields even when the source text did not explicitly request materials.
- RAG still improves holdout overall from `0.732` to `0.805`, mainly by improving `projectItem` and `missingFields`, so it should not be disabled broadly.

## Recommended Day 9-2C-2 Order

1. Review fixtures that conflict with Day 9-2B-2 written rules before changing extraction. Especially publish phrases with `上線`/`發布` and date normalization expectations.
2. Tighten `nextAction` generation to reduce false positives. Do not treat system-suggested follow-up as a confirmed next action.
3. Tighten typed deadline classification so generic completion/risk dates do not become `submissionDeadline` or `publishDeadline` unless the semantic trigger is explicit.
4. Tighten material extraction to avoid generic `產品` overmatch in product photography descriptions.
5. Review RAG project-item specificity for new deadline fixtures, keeping existing RAG-assisted project-item regression cases intact.
6. Update thread fixture expectations or compatibility-field evaluation to account for typed deadline changes cascading into `expectedDeadline`.

## Regression Cases To Preserve

- RAG-assisted `gmail-collab-video-ambiguous-002` should still infer `Reels 影片` when intended.
- Thread deadline conflicts must continue to trigger human review and avoid silent overwrite.
- `附件提供 Logo` must not become missing Logo.
- `9/10 前交初稿，9/15 上線` must keep separate submission and publish deadlines.
- Generic `希望 9/15 前完成` must not create both typed deadlines.
- Completed/cancelled stages must not generate regular next action or missing field alerts.

## Day 9-2C-2A Fixture Contract Calibration

Scope: evaluator metrics and fixture expected JSON only. Extraction, RAG, rule engine, Dashboard, and Kanban were not changed.

Fixture Contract applied:

- `submissionDeadline` is set only for explicit delivery semantics such as `交稿`, `初稿`, `腳本`, `素材`, `成品`, `修改稿`, `交件`, `交付`, `完稿`, or `提交`.
- `publishDeadline` is set only for explicit public release semantics such as `上線`, `發布`, `貼文日`, `公開`, `活動開始`, `上架`, or `刊登`.
- Generic completion phrases such as `希望 9/15 前完成` stay as `expectedDeadline` only.
- `expectedDeadline` mirrors a single typed deadline, uses `submissionDeadline` when both typed deadlines exist, and otherwise keeps the generic deadline.
- `nextAction` is expected only for explicit requested actions or when status semantics justify a prompt; pure notifications, non-cases, completed cases, and cancelled cases expect `null`.
- `requiredMaterials` contains only pending client materials. Provided attachments such as `附件提供 Logo` are not required materials, and `產品攝影` does not imply missing `產品`.

Metric names changed in `apps/api/src/scripts/extractionAccuracy.ts`:

- Scalar/nullable fields now report `exactValueAccuracy`, `presencePrecision`, `presenceRecall`, and `presenceF1`.
- Set fields now report `exactSetAccuracy`, `microPrecision`, `microRecall`, `microF1`, and `macroF1` in `fieldMetrics`.
- `missingFieldsMetrics` now reports `missingFieldsExactSetAccuracy`, `missingFieldsMicroPrecision`, `missingFieldsMicroRecall`, `missingFieldsMicroF1`, and `missingFieldsMacroF1`.
- Date comparison now normalizes common relative and formatted dates against Asia/Taipei `receivedAt` for evaluation, so equivalent date formats are not counted as `evaluation_mismatch`.
- Summary output now separates `legacyCoreOverall`, `extendedOverall`, and `fullOverall`.

Expected JSON changes made because old fixtures conflicted with the written rules:

- `gmail-collab-reels-001`: added `publishDeadline` for explicit `上線時間`.
- `gmail-collab-video-ambiguous-002`: added `publishDeadline` for explicit `上線`.
- `gmail-quote-logo-004`: added `submissionDeadline` for `第一版`; added `nextAction: 提供報價` for explicit fee inquiry.
- `line-revision-ig-post-006`: added `submissionDeadline` for `這週五前要交`.
- `line-risk-material-007`: added `submissionDeadline` for explicit `交件` risk date.
- `gmail-contract-website-008`: added `publishDeadline` for `上線`; added `nextAction: 確認合約` for `請先提供合約與首付款資訊`.
- `gmail-landing-page-013`: added `publishDeadline` for `上線`; added `nextAction: 提供報價` for explicit estimate request.
- `gmail-package-design-019`: added `submissionDeadline` for `完稿`.
- `gmail-presentation-020`: added `submissionDeadline` for `交第一版`.
- `holdout-collab-podcast-001`: added `publishDeadline` for explicit `上線`.
- `holdout-quote-dm-002`: added `submissionDeadline` for `交第一版`.
- `holdout-risk-delay-003`: added `submissionDeadline` for explicit `本週交付` risk date.
- `holdout-confirm-logo-004`: added `submissionDeadline` for `交付`; added `nextAction: 確認合約` for explicit `請提供合約`.
- `thread-submission-deadline-conflict`: removed `publishDeadline` from expected `inheritedFields` because null typed deadlines are not emitted as inherited fields.
- `thread-one-of-two-deadlines-conflict`: changed expected `intent` to `修改需求` for `改成`; added inherited `nextAction` because the existing case action is preserved when not restated.

Day 9-2C-2A calibrated results from `npm run accuracy`:

- Development RAG-off `fullOverall`: `0.882`; `legacyCoreOverall`: `0.890`; `extendedOverall`: `0.870`.
- Development RAG-on `fullOverall`: `0.898`; `legacyCoreOverall`: `0.916`; `extendedOverall`: `0.870`.
- Holdout RAG-off `fullOverall`: `0.805`; `legacyCoreOverall`: `0.880`; `extendedOverall`: `0.688`.
- Holdout RAG-on `fullOverall`: `0.878`; `legacyCoreOverall`: `1.000`; `extendedOverall`: `0.688`.
- Thread context `fullOverall`: `0.954`; `legacyCoreOverall`: `1.000`; `extendedOverall`: `1.000`.

Current Development RAG-on field metrics after calibration:

| Field | exactValueAccuracy / exactSetAccuracy | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: |
| projectItem | 0.920 | 0.920 | 0.920 | 0.920 |
| expectedDeadline | 1.000 | 1.000 | 1.000 | 1.000 |
| submissionDeadline | 0.880 | 1.000 | 0.880 | 0.936 |
| publishDeadline | 1.000 | 1.000 | 1.000 | 1.000 |
| nextAction | 0.640 | 0.667 | 0.941 | 0.780 |
| intent | 0.840 | 0.840 | 0.840 | 0.840 |
| requiredMaterials | 0.960 | 0.800 | 1.000 | 0.889 |
| missingFields | 0.720 | 0.914 | 0.842 | 0.877 |

Remaining issues were not converted into fixture expectations because they reflect extraction/RAG/rule behavior rather than written-rule fixture conflicts:

- `nextAction` is still over-produced for vague collaboration invites, deadline-risk notifications, and cases where only missing fields imply a possible reply.
- `submissionDeadline` is still missed for some explicit first-version/delivery phrases such as `第一版`, `這週五前要交`, and `下週五前交第一版`.
- `requiredMaterials` still overmatches `產品` or `品牌 Logo` when the text describes a project type or deliverable rather than pending client material.
- RAG can still over-specialize project items, such as `影片` becoming `Reels 影片`.
- `thread-one-of-two-deadlines-conflict` still reports `expectedDeadline` as changed/conflicting when only `publishDeadline` changed; under the compatibility rule, `expectedDeadline` should remain tied to `submissionDeadline` when both typed deadlines exist.

## Day 9-2C-3 Search/RAG vs Extraction Diagnosis

Scope: diagnosis and evaluator instrumentation. Hybrid Search was not changed.

Question: weak post-search field mapping should be attributed to search architecture, RAG, thread context, or extraction/schema rules.

Evaluator changes:

- `analyzeMessage` and `analyzeThreadAwareMessage` now accept optional `ragEnabled`; default behavior remains RAG-enabled.
- Thread accuracy now reports four modes:
- `currentOnlyRagOff`: current message only, no RAG.
- `currentOnlyRagOn`: current message only, with RAG.
- `threadContextRagOff`: existing case/thread inheritance, no RAG.
- `threadContextRagOn`: existing case/thread inheritance, with RAG.

Current Day 9 accuracy findings:

- Development RAG-on `fullOverall`: `0.898`.
- Development RAG-on weakest fields: `nextAction` exact `0.64`, `missingFields` exact set `0.72`, `intent` `0.84`, `submissionDeadline` `0.88`.
- Top error causes: `nextAction` false positives, missingFields exact-set mismatches, typed deadline classification, material overmatch.
- RAG on/off for development improves full overall by only `+0.016`; it improves `missingFields` by `+0.20` but slightly hurts `projectItem` by `-0.04`.
- Holdout RAG on/off improves full overall by `+0.073`, mostly through `projectItem` and `missingFields`.

Thread A/B/C/D results:

| Mode | Full Overall | Legacy Core | Extended | Interpretation |
| --- | ---: | ---: | ---: | --- |
| currentOnlyRagOff | 0.578 | 0.480 | 0.750 | Current message alone lacks inherited case fields. |
| currentOnlyRagOn | 0.600 | 0.480 | 0.750 | RAG helps current-only only slightly. |
| threadContextRagOff | 0.938 | 1.000 | 1.000 | Thread/existing-case context solves most field mapping gaps. |
| threadContextRagOn | 0.954 | 1.000 | 1.000 | RAG adds only a small thread-level improvement. |

Delta interpretation:

- Current-only RAG gain: `+0.022` overall, mainly `projectItem +0.20`.
- Thread context gain over current-only RAG: `+0.354` overall, with major gains in `projectItem +0.80`, `quoteAmount +0.80`, `expectedDeadline +1.00`, `submissionDeadline +0.40`, `publishDeadline +0.40`, and `nextAction +0.20`.
- Thread-context RAG gain: `+0.016` overall, mainly inherited-field bookkeeping, not core scalar extraction.

Diagnosis:

- This is not primarily a Hybrid Search problem yet. Search/RAG retrieval can help, but the biggest observed gap is that current-message extraction cannot reconstruct existing case state without thread/existing-case context.
- RAG improves some missing-field and project-item cases, but also introduces project-item over-specificity and can add `required_materials` through typical missing fields.
- The weak mapping after search is mainly an extraction/schema/thread-context problem: when context exists, the system needs stricter rules for which fields may be inherited, changed, conflicted, or ignored.
- Hybrid Search should be revisited only after extraction/schema/thread mapping is tightened and after a test shows that the needed context exists but retrieval fails to find it.

Recommended next order:

1. Tighten `nextAction` extraction/inference rules to reduce false positives.
2. Tighten typed deadline rules for explicit first-version/submission phrases and compatibility handling when only `publishDeadline` changes.
3. Tighten `requiredMaterials` so project types and provided assets do not become pending materials.
4. Update thread context mapping so `expectedDeadline` compatibility does not create false changed/conflicting fields when submission remains the controlling deadline.
5. Then evaluate RAG retrieval quality with targeted fixtures where the correct context exists only in historical examples.
6. Only after step 5 should Hybrid Search or embedding/vector retrieval be changed.

## P0-P3 Field Mapping Roadmap

Current priority order:

- P0 Existing Case Field Merge: handle inherit, update, conflict, clear, and field source tracking for same-thread/existing-case updates.
- P1 Extraction Schema and Typed Field Rules: tighten deadline, next action, required materials, and status transition semantics.
- P2 RAG Guardrails: RAG may provide supporting evidence, but must not create current-case facts by similarity alone.
- P3 Hybrid Search Optimization: freeze main search architecture until P0-P2 stabilize, then evaluate cross-thread/cross-case linking separately.

P0 merge contract implemented:

- Inherit: if current message omits a field and existing case has it, keep existing value and mark source `inherited`.
- Update: if existing case lacks a field and current message provides it, apply it and mark source `changed`; this does not require human review by itself.
- Conflict: if both existing and current values exist and differ for critical fields, keep existing case value, mark source `conflict`, create review context, and require human review.
- Clear: terminal/current completion or cancellation semantics may clear action/material fields and mark source `cleared`.
- Source tracking: thread analysis now returns `fieldSources` and `clearedFields`, and `ai_extractions` persists `field_sources` and `cleared_fields` JSONB.
- Compatibility: when both submission and publish deadlines exist, a publish-only change no longer forces `expectedDeadline` to be treated as an independent conflict; `expectedDeadline` remains controlled by `submissionDeadline`.

P0 validation result:

- Thread `threadContextRagOn` full overall improved from `0.954` to `1.000` after applying the merge contract and expanding thread fixtures.
- P0 thread validation now covers 6 fixtures and 90 scored fields, including `fieldSources` and `clearedFields` metadata.
- `needsHumanReviewCount` now reflects true conflicts, not safe missing-field updates.

## P1 Typed Field Rules Result

Implemented first P1 slice:

- `caseStatus` is now optionally scored in extraction accuracy fixtures.
- Completion/closure language maps to `intent: 完成結案`, `caseStatus: 已完成`, no next action, and no missing fields.
- Cancellation fixtures now explicitly score `caseStatus: 已流失`.
- Submission deadline detection handles `第一版`, `交第一版`, and deadline-context `交` wording.
- Required material extraction avoids treating generic project descriptions like `需要產品攝影` as a pending material named `產品`.
- Next-action rules treat `估價` as quote work and avoid draft-preparation next actions for deadline-risk messages.

Validation result:

- Development ragOff full overall improved to `0.902`.
- Development ragOff extended overall improved to `0.920`.
- Development ragOff `submissionDeadline`, `publishDeadline`, `requiredMaterials`, and `caseStatus` are each `1.000` on the current fixture set.
- Thread context RAG-on remains `1.000`.
