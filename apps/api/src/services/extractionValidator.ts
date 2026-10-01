import type {AiExtraction, RagExample} from '@casebee/shared';
import type {MessageClassification} from './messageClassifier.js';
import type {PreprocessedEmail} from './emailPreprocessor.js';

export interface ExtractionValidation {
  confidence: number;
  warnings: string[];
}

export function validateExtraction(input: {extraction: AiExtraction; prepared: PreprocessedEmail; classification: MessageClassification; similarCases: RagExample[]}): ExtractionValidation {
  let confidence = 0.45;
  const warnings: string[] = [];
  const {extraction, classification, similarCases} = input;

  confidence += classification.confidence * 0.18;

  if (extraction.clientName) confidence += 0.08;
  else warnings.push('missing client name');

  if (extraction.projectItem) confidence += 0.13;
  else warnings.push('missing project item');

  if (extraction.expectedDeadline) confidence += 0.1;
  else warnings.push('missing deadline');

  if (/交稿|初稿|腳本|成品|修改稿/.test(input.prepared.cleanText) && !extraction.submissionDeadline) warnings.push('unclear submission deadline');
  if (/上線|發布|貼文|公開|活動開始/.test(input.prepared.cleanText) && !extraction.publishDeadline) warnings.push('unclear publish deadline');
  if (/附件/.test(input.prepared.cleanText) && extraction.providedMaterials.length === 0) warnings.push('attachment content not parsed');
  if (/請提供|待提供|等待.*素材|補.*素材/.test(input.prepared.cleanText) && extraction.requiredMaterials.length === 0) warnings.push('unclear required materials');
  if (extraction.nextAction) confidence += 0.03;

  if (extraction.quoteAmount) confidence += 0.08;
  else warnings.push('missing quote amount');

  if (similarCases.length > 0) confidence += Math.min(0.08, similarCases[0].score / 1000);
  if (input.prepared.quotedTextRemoved) warnings.push('quoted email text removed before extraction');
  if (classification.type === 'unknown') warnings.push('message type is uncertain');

  return {confidence: Math.max(0, Math.min(0.98, Number(confidence.toFixed(2)))), warnings};
}
