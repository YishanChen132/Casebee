import type {AiExtraction, CaseRecord, MessageEvent, ThreadAwareExtractionResult, ThreadAwareField, ThreadFieldConflict} from '@casebee/shared';
import {analyzeMessage} from './aiService.js';

const comparableFields: ThreadAwareField[] = ['clientName', 'projectItem', 'quoteAmount', 'expectedDeadline', 'submissionDeadline', 'publishDeadline'];

function extractionFromCase(existingCase: CaseRecord): AiExtraction {
  return {
    clientName: existingCase.customerName,
    projectItem: existingCase.projectItem === '待釐清需求' ? null : existingCase.projectItem,
    quoteAmount: existingCase.quoteAmount,
    expectedDeadline: existingCase.expectedDeadline,
    submissionDeadline: existingCase.submissionDeadline,
    publishDeadline: existingCase.publishDeadline,
    nextAction: existingCase.nextAction,
    nextActionSource: existingCase.nextActionSource,
    requiredMaterials: existingCase.requiredMaterials,
    providedMaterials: existingCase.providedMaterials,
    intent: existingCase.summary,
    caseStatus: existingCase.status,
    missingFields: existingCase.missingFields,
    summary: existingCase.summary,
    suggestedReply: '',
  };
}

function normalize(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLowerCase() : value;
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== '';
}

function compatibleValue(field: ThreadAwareField, existing: unknown, current: unknown) {
  if (field !== 'projectItem' || typeof existing !== 'string' || typeof current !== 'string') {
    return normalize(existing) === normalize(current);
  }
  return existing.toLowerCase().includes(current.toLowerCase()) || current.toLowerCase().includes(existing.toLowerCase());
}

function mergeMissingFields(extraction: AiExtraction) {
  const missing = new Set(extraction.missingFields);
  if (extraction.projectItem) missing.delete('project_item');
  if (extraction.quoteAmount) missing.delete('quote_amount');
  if (extraction.expectedDeadline) missing.delete('expected_deadline');
  if (extraction.submissionDeadline) missing.delete('submission_deadline');
  if (extraction.publishDeadline) missing.delete('publish_deadline');
  if (extraction.nextAction) missing.delete('next_action');
  if (extraction.requiredMaterials.length > 0) missing.delete('required_materials');
  return Array.from(missing);
}

function hasPendingCriticalChange(result: {changedFields: Partial<AiExtraction>; conflictingFields: ThreadFieldConflict[]}) {
  return result.conflictingFields.length > 0 || ['projectItem', 'quoteAmount', 'expectedDeadline', 'submissionDeadline', 'publishDeadline'].some((field) => field in result.changedFields);
}

function buildThreadSummary(messages: MessageEvent[], currentText: string) {
  const previous = messages.filter((message) => message.text !== currentText).slice(-3);
  if (previous.length === 0) {
    return null;
  }
  return previous.map((message) => `${message.senderName}: ${message.text.replace(/\s+/g, ' ').slice(0, 120)}`).join(' | ');
}

function buildFieldConfidence(extraction: AiExtraction, result: ThreadAwareExtractionResult) {
  return {
    clientName: extraction.clientName ? 0.9 : 0.35,
    projectItem: result.conflictingFields.some((field) => field.field === 'projectItem') ? 0.45 : extraction.projectItem ? 0.88 : 0.35,
    quoteAmount: result.conflictingFields.some((field) => field.field === 'quoteAmount') ? 0.45 : extraction.quoteAmount ? 0.86 : 0.5,
    expectedDeadline: result.conflictingFields.some((field) => field.field === 'expectedDeadline') ? 0.45 : extraction.expectedDeadline ? 0.86 : 0.5,
    submissionDeadline: result.conflictingFields.some((field) => field.field === 'submissionDeadline') ? 0.45 : extraction.submissionDeadline ? 0.86 : 0.5,
    publishDeadline: result.conflictingFields.some((field) => field.field === 'publishDeadline') ? 0.45 : extraction.publishDeadline ? 0.86 : 0.5,
    nextAction: extraction.nextAction ? 0.78 : 0.5,
    requiredMaterials: extraction.requiredMaterials.length > 0 ? 0.78 : 0.5,
    intent: extraction.intent ? 0.82 : 0.35,
  };
}

export async function analyzeThreadAwareMessage(input: {senderName: string; text: string; receivedAt?: string; threadMessages?: MessageEvent[]; existingCase?: CaseRecord | null; ragEnabled?: boolean}): Promise<{result: ThreadAwareExtractionResult; modelName: string; overallConfidence: number; fieldConfidence: Record<string, number>; warnings: string[]}> {
  const {extraction: currentExtraction, modelName, validation} = await analyzeMessage({senderName: input.senderName, text: input.text, receivedAt: input.receivedAt, ragEnabled: input.ragEnabled});
  const existingExtraction = input.existingCase ? extractionFromCase(input.existingCase) : null;
  const finalExtraction: AiExtraction = {...currentExtraction, missingFields: [...currentExtraction.missingFields]};
  const extractedFields: Partial<AiExtraction> = {};
  const inheritedFields: Partial<AiExtraction> = {};
  const changedFields: Partial<AiExtraction> = {};
  const conflictingFields: ThreadFieldConflict[] = [];

  for (const field of comparableFields) {
    const currentValue = currentExtraction[field];
    if (hasValue(currentValue)) {
      extractedFields[field] = currentValue as never;
    }

    if (!existingExtraction) {
      continue;
    }

    const existingValue = existingExtraction[field];
    if (!hasValue(currentValue) && hasValue(existingValue)) {
      finalExtraction[field] = existingValue as never;
      inheritedFields[field] = existingValue as never;
      continue;
    }

    if (hasValue(currentValue) && !hasValue(existingValue)) {
      changedFields[field] = currentValue as never;
      continue;
    }

    if (hasValue(currentValue) && hasValue(existingValue) && !compatibleValue(field, existingValue, currentValue)) {
      changedFields[field] = currentValue as never;
      if (field === 'projectItem' || field === 'quoteAmount' || field === 'expectedDeadline' || field === 'submissionDeadline' || field === 'publishDeadline') {
        conflictingFields.push({field, existing: existingValue, extracted: currentValue, reason: 'Current message conflicts with existing case state.'});
        finalExtraction[field] = existingValue as never;
      }
    } else if (field === 'projectItem' && hasValue(currentValue) && hasValue(existingValue) && normalize(currentValue) !== normalize(existingValue)) {
      finalExtraction[field] = existingValue as never;
      inheritedFields[field] = existingValue as never;
    }
  }

  if (existingExtraction) {
    if (!hasValue(currentExtraction.nextAction) && hasValue(existingExtraction.nextAction)) {
      finalExtraction.nextAction = existingExtraction.nextAction;
      finalExtraction.nextActionSource = existingExtraction.nextActionSource;
      inheritedFields.nextAction = existingExtraction.nextAction;
    }
    if (currentExtraction.requiredMaterials.length === 0 && existingExtraction.requiredMaterials.length > 0) {
      finalExtraction.requiredMaterials = existingExtraction.requiredMaterials;
      inheritedFields.requiredMaterials = existingExtraction.requiredMaterials;
    }
  }

  finalExtraction.missingFields = mergeMissingFields(finalExtraction);
  finalExtraction.summary = input.existingCase
    ? `${currentExtraction.summary} Thread context: ${conflictingFields.length > 0 ? '偵測到與既有案件欄位衝突，需人工確認。' : '已沿用同一 Gmail thread 的既有案件資料。'}`
    : currentExtraction.summary;

  const result: ThreadAwareExtractionResult = {
      extraction: finalExtraction,
      extractedFields,
      inheritedFields,
      changedFields,
      conflictingFields,
      needsHumanReview: false,
      threadSummary: buildThreadSummary(input.threadMessages ?? [], input.text),
      existingCaseId: input.existingCase?.id ?? null,
    };
  result.needsHumanReview = hasPendingCriticalChange(result);
  const warnings = [...validation.warnings, ...conflictingFields.map((field) => `thread conflict: ${field.field}`)];
  return {result, modelName, overallConfidence: conflictingFields.length > 0 ? Math.min(validation.confidence, 0.72) : validation.confidence, fieldConfidence: buildFieldConfidence(finalExtraction, result), warnings};
}
