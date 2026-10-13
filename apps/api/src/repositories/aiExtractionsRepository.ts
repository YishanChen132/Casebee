import {randomUUID} from 'node:crypto';
import type {AiExtraction, ThreadAwareExtractionResult} from '@casebee/shared';
import {pool} from '../db/pool.js';

export async function createAiExtraction(messageId: string, extraction: AiExtraction, modelName = 'rule-based-mvp', metadata?: {overallConfidence?: number; fieldConfidence?: Record<string, number>; warnings?: string[]; threadContext?: ThreadAwareExtractionResult}) {
  const threadContext = metadata?.threadContext;
  const result = await pool.query(
    `INSERT INTO ai_extractions (id, message_id, client_name, project_item, quote_amount, expected_deadline, submission_deadline, publish_deadline, next_action, next_action_source, required_materials, provided_materials, intent, case_status, missing_fields, summary, suggested_reply, model_name, overall_confidence, field_confidence, warnings, extracted_fields, inherited_fields, changed_fields, cleared_fields, field_sources, conflicting_fields, needs_human_review, review_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15::jsonb, $16, $17, $18, $19, $20::jsonb, $21::jsonb, $22::jsonb, $23::jsonb, $24::jsonb, $25::jsonb, $26::jsonb, $27::jsonb, $28, $29)
      RETURNING *`,
    [
      `extract-${randomUUID()}`,
      messageId,
      extraction.clientName,
      extraction.projectItem,
      extraction.quoteAmount,
      extraction.expectedDeadline,
      extraction.submissionDeadline,
      extraction.publishDeadline,
      extraction.nextAction,
      extraction.nextActionSource,
      JSON.stringify(extraction.requiredMaterials),
      JSON.stringify(extraction.providedMaterials),
      extraction.intent,
      extraction.caseStatus,
      JSON.stringify(extraction.missingFields),
      extraction.summary,
      extraction.suggestedReply,
      modelName,
      metadata?.overallConfidence ?? null,
      JSON.stringify(metadata?.fieldConfidence ?? {}),
      JSON.stringify(metadata?.warnings ?? []),
      JSON.stringify(threadContext?.extractedFields ?? {}),
      JSON.stringify(threadContext?.inheritedFields ?? {}),
      JSON.stringify(threadContext?.changedFields ?? {}),
      JSON.stringify(threadContext?.clearedFields ?? {}),
      JSON.stringify(threadContext?.fieldSources ?? {}),
      JSON.stringify(threadContext?.conflictingFields ?? []),
      threadContext?.needsHumanReview ?? false,
      threadContext?.needsHumanReview ? 'pending' : 'none',
    ],
  );

  return result.rows[0];
}
