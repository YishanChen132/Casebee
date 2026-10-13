import type {AiExtraction, CaseRecord, MessageEvent, ThreadAwareExtractionResult, ThreadAwareField, ThreadFieldConflict} from '@casebee/shared';
import {analyzeMessage} from './aiService.js';
import {buildSuggestedReply, buildSummary} from './extractionService.js';
import {findSimilarCases} from './ragService.js';

const comparableFields: ThreadAwareField[] = ['clientName', 'projectItem', 'quoteAmount', 'expectedDeadline', 'submissionDeadline', 'publishDeadline'];
const criticalFields = new Set<ThreadAwareField>(['projectItem', 'quoteAmount', 'expectedDeadline', 'submissionDeadline', 'publishDeadline']);


const conflictFieldLabels: Partial<Record<ThreadAwareField, string>> = {projectItem: '專案項目', quoteAmount: '預算', expectedDeadline: '交期', submissionDeadline: '交稿期限', publishDeadline: '上線期限'};

function formatConflictValue(field: ThreadAwareField, value: unknown) {
  return field === 'quoteAmount' && typeof value === 'number' ? `NT$ ${value.toLocaleString('zh-TW')}` : String(value);
}

function buildConflictReply(conflicts: ThreadFieldConflict[]) {
  const parts = conflicts
    .map((conflict) => {
      if (conflict.field === 'projectItem' && conflict.reason === 'Customer wants to add a new item.') {
        return `想新增項目，調整後專案內容為 ${conflict.extracted}`;
      }
      return `${conflictFieldLabels[conflict.field] ?? conflict.field}調整為 ${formatConflictValue(conflict.field, conflict.extracted)}（原為 ${formatConflictValue(conflict.field, conflict.existing)}）`;
    })
    .join('、');
  return `您好，收到。您提到${parts}。我先確認調整後的排程與報價是否可行，確認後回覆您。`;
}

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

function isTerminalStatus(extraction: AiExtraction) {
  return extraction.caseStatus === '已完成' || extraction.caseStatus === '已流失' || extraction.intent === '取消合作';
}

function expectedDeadlineControlledBySubmission(existingExtraction: AiExtraction, currentExtraction: AiExtraction) {
  return hasValue(existingExtraction.submissionDeadline)
    && compatibleValue('submissionDeadline', existingExtraction.submissionDeadline, currentExtraction.submissionDeadline ?? existingExtraction.submissionDeadline)
    && hasValue(currentExtraction.publishDeadline)
    && !compatibleValue('publishDeadline', existingExtraction.publishDeadline, currentExtraction.publishDeadline);
}

function mergeMissingFields(extraction: AiExtraction) {
  const missing = new Set(extraction.missingFields);
  if (extraction.projectItem) missing.delete('project_item');
  if (extraction.quoteAmount) missing.delete('quote_amount');
  if (extraction.expectedDeadline) missing.delete('expected_deadline');
  if (extraction.submissionDeadline) missing.delete('submission_deadline');
  if (extraction.publishDeadline) missing.delete('publish_deadline');
  if (extraction.nextAction) missing.delete('next_action');
  if (extraction.requiredMaterials.length > 0 || extraction.providedMaterials.length > 0) missing.delete('required_materials');
  return Array.from(missing);
}

function hasPendingCriticalChange(result: {changedFields: Partial<AiExtraction>; conflictingFields: ThreadFieldConflict[]}) {
  return result.conflictingFields.length > 0;
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
  const clearedFields: Partial<AiExtraction> = {};
  const conflictingFields: ThreadFieldConflict[] = [];
  const fieldSources: ThreadAwareExtractionResult['fieldSources'] = {};

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
      fieldSources[field] = 'inherited';
      continue;
    }

    if (hasValue(currentValue) && !hasValue(existingValue)) {
      changedFields[field] = currentValue as never;
      fieldSources[field] = 'changed';
      continue;
    }

    if (hasValue(currentValue) && hasValue(existingValue) && !compatibleValue(field, existingValue, currentValue)) {
      if (field === 'expectedDeadline' && expectedDeadlineControlledBySubmission(existingExtraction, currentExtraction)) {
        finalExtraction.expectedDeadline = existingExtraction.expectedDeadline;
        inheritedFields.expectedDeadline = existingExtraction.expectedDeadline;
        fieldSources.expectedDeadline = 'inherited';
        continue;
      }

      changedFields[field] = currentValue as never;
      fieldSources[field] = 'changed';
      if (criticalFields.has(field)) {
        const isAddition = field === 'projectItem' && /加做|新增|順便|另外|多做|再加|追加|也想/.test(input.text);
        conflictingFields.push({field, existing: existingValue, extracted: isAddition ? `${existingValue} + ${currentValue}` : currentValue, reason: isAddition ? 'Customer wants to add a new item.' : 'Current message conflicts with existing case state.'});
        finalExtraction[field] = existingValue as never;
        fieldSources[field] = 'conflict';
      }
    } else if (hasValue(currentValue) && hasValue(existingValue)) {
      finalExtraction[field] = existingValue as never;
      inheritedFields[field] = existingValue as never;
      fieldSources[field] = 'inherited';
    } else if (hasValue(currentValue)) {
      fieldSources[field] = 'extracted';
    }
  }

  if (existingExtraction) {
    if (!isTerminalStatus(currentExtraction)) {
      finalExtraction.caseStatus = existingExtraction.caseStatus;
      fieldSources.caseStatus = 'inherited';
    } else {
      fieldSources.caseStatus = 'extracted';
    }

    if (isTerminalStatus(currentExtraction) && hasValue(existingExtraction.nextAction)) {
      finalExtraction.nextAction = null;
      finalExtraction.nextActionSource = null;
      clearedFields.nextAction = existingExtraction.nextAction;
      fieldSources.nextAction = 'cleared';
    } else if (!hasValue(currentExtraction.nextAction) && hasValue(existingExtraction.nextAction)) {
      finalExtraction.nextAction = existingExtraction.nextAction;
      finalExtraction.nextActionSource = existingExtraction.nextActionSource;
      inheritedFields.nextAction = existingExtraction.nextAction;
      fieldSources.nextAction = 'inherited';
    } else if (hasValue(currentExtraction.nextAction)) {
      fieldSources.nextAction = compatibleValue('nextAction', existingExtraction.nextAction, currentExtraction.nextAction) ? 'inherited' : 'changed';
    }
    if (currentExtraction.providedMaterials.length === 0 && existingExtraction.providedMaterials.length > 0) {
      finalExtraction.providedMaterials = existingExtraction.providedMaterials;
      inheritedFields.providedMaterials = existingExtraction.providedMaterials;
    }

    if (isTerminalStatus(currentExtraction) && existingExtraction.requiredMaterials.length > 0) {
      finalExtraction.requiredMaterials = [];
      clearedFields.requiredMaterials = existingExtraction.requiredMaterials;
      fieldSources.requiredMaterials = 'cleared';
    } else if (currentExtraction.requiredMaterials.length === 0 && existingExtraction.requiredMaterials.length > 0) {
      finalExtraction.requiredMaterials = existingExtraction.requiredMaterials;
      inheritedFields.requiredMaterials = existingExtraction.requiredMaterials;
      fieldSources.requiredMaterials = 'inherited';
    } else if (currentExtraction.requiredMaterials.length > 0) {
      fieldSources.requiredMaterials = 'extracted';
    }
  } else {
    for (const field of comparableFields) {
      if (hasValue(currentExtraction[field])) fieldSources[field] = 'extracted';
    }
    if (hasValue(currentExtraction.nextAction)) fieldSources.nextAction = 'extracted';
    if (currentExtraction.requiredMaterials.length > 0) fieldSources.requiredMaterials = 'extracted';
  }

  finalExtraction.missingFields = mergeMissingFields(finalExtraction);
  finalExtraction.summary = input.existingCase
    ? `${currentExtraction.summary} Thread context: ${conflictingFields.length > 0 ? '偵測到與既有案件欄位衝突，需人工確認。' : '已沿用同一 Gmail thread 的既有案件資料。'}`
    : currentExtraction.summary;

  if (input.existingCase) {
    const similarCases = await findSimilarCases(finalExtraction);
    finalExtraction.summary = `${buildSummary({senderName: finalExtraction.clientName ?? '', text: input.text, projectItem: finalExtraction.projectItem, quoteAmount: finalExtraction.quoteAmount, expectedDeadline: finalExtraction.expectedDeadline, intent: currentExtraction.intent, missingFields: finalExtraction.missingFields, similarCases})} 最新訊息：「${input.text.replace(/\s+/g, ' ').slice(0, 80)}」 Thread context: ${conflictingFields.length > 0 ? '偵測到與既有案件欄位衝突，需人工確認。' : '已沿用同一 Gmail thread 的既有案件資料。'}`;
  if (conflictingFields.length > 0) {
      finalExtraction.suggestedReply = buildConflictReply(conflictingFields);
  }else {
      finalExtraction.suggestedReply = buildSuggestedReply({clientName: finalExtraction.clientName ?? '', text: input.text, intent: currentExtraction.intent, projectItem: finalExtraction.projectItem, quoteAmount: finalExtraction.quoteAmount, expectedDeadline: finalExtraction.expectedDeadline, missingFields: finalExtraction.missingFields, similarCases});
    }
  }

  const result: ThreadAwareExtractionResult = {
      extraction: finalExtraction,
      extractedFields,
      inheritedFields,
      changedFields,
      clearedFields,
      conflictingFields,
      fieldSources,
      needsHumanReview: false,
      threadSummary: buildThreadSummary(input.threadMessages ?? [], input.text),
      existingCaseId: input.existingCase?.id ?? null,
    };
  result.needsHumanReview = hasPendingCriticalChange(result);
  const warnings = [...validation.warnings, ...conflictingFields.map((field) => `thread conflict: ${field.field}`)];
  return {result, modelName, overallConfidence: conflictingFields.length > 0 ? Math.min(validation.confidence, 0.72) : validation.confidence, fieldConfidence: buildFieldConfidence(finalExtraction, result), warnings};
}
