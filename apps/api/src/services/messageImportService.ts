import type {AiExtraction, Alert, CaseRecord, MessageEvent, Platform, ThreadAwareExtractionResult, ThreadAwareField} from '@casebee/shared';
import {createAiExtraction} from '../repositories/aiExtractionsRepository.js';
import {createAlert} from '../repositories/alertsRepository.js';
import {createReviewItems} from '../repositories/aiReviewRepository.js';
import {createCaseFromExtraction, findCaseById, updateCaseFromThreadExtraction} from '../repositories/casesRepository.js';
import {findOrCreateCustomer} from '../repositories/customersRepository.js';
import {attachMessageToCase, createMessage, findLatestCaseIdByThreadId, findMessagesByThreadId, setSystemPendingReplyIfUnset} from '../repositories/messagesRepository.js';
import {findSimilarCases} from './ragService.js';
import {runRules} from './ruleEngine.js';
import {analyzeThreadAwareMessage} from './threadContextService.js';
import {computeStageAwareMissingFields} from './missingFieldService.js';

function caseSafeExtraction(extraction: AiExtraction, existingCase: CaseRecord | null, threadContext: ThreadAwareExtractionResult) {
  if (!existingCase) return extraction;
  const safe = {...extraction, missingFields: [...extraction.missingFields]};
  if ('projectItem' in threadContext.changedFields || threadContext.conflictingFields.some((conflict) => conflict.field === 'projectItem')) {
    safe.projectItem = existingCase.projectItem === '待釐清需求' ? null : existingCase.projectItem;
  }
  if ('quoteAmount' in threadContext.changedFields || threadContext.conflictingFields.some((conflict) => conflict.field === 'quoteAmount')) {
    safe.quoteAmount = existingCase.quoteAmount;
  }
  if ('expectedDeadline' in threadContext.changedFields || threadContext.conflictingFields.some((conflict) => conflict.field === 'expectedDeadline')) {
    safe.expectedDeadline = existingCase.expectedDeadline;
  }
  if ('submissionDeadline' in threadContext.changedFields || threadContext.conflictingFields.some((conflict) => conflict.field === 'submissionDeadline')) {
    safe.submissionDeadline = existingCase.submissionDeadline;
  }
  if ('publishDeadline' in threadContext.changedFields || threadContext.conflictingFields.some((conflict) => conflict.field === 'publishDeadline')) {
    safe.publishDeadline = existingCase.publishDeadline;
  }
  return safe;
}

export async function importMessage(input: {platform: Platform; senderId?: string; senderName: string; text: string; timestamp?: string; threadId?: string; rawPayload?: unknown}) {
  const existingCaseId = input.threadId ? await findLatestCaseIdByThreadId(input.threadId) : null;
  const [existingCase, threadMessages] = await Promise.all([
    existingCaseId ? findCaseById(existingCaseId) : Promise.resolve(null),
    input.threadId ? findMessagesByThreadId(input.threadId) : Promise.resolve([]),
  ]);
  const message = await createMessage({
    platform: input.platform,
    senderId: input.senderId ?? input.senderName,
    senderName: input.senderName,
    text: input.text,
    timestamp: input.timestamp,
    threadId: input.threadId,
    rawPayload: input.rawPayload,
  });

  const {result: threadContext, modelName, overallConfidence, fieldConfidence, warnings} = await analyzeThreadAwareMessage({senderName: input.senderName, text: input.text, receivedAt: message.timestamp, threadMessages, existingCase});
  const extraction = {...threadContext.extraction, missingFields: computeStageAwareMissingFields({extraction: threadContext.extraction, caseRecord: existingCase})};
  await createAiExtraction(message.id, extraction, modelName, {overallConfidence, fieldConfidence, warnings, threadContext});

  const safeExtraction = existingCase ? caseSafeExtraction(extraction, existingCase, threadContext) : extraction;
  safeExtraction.missingFields = computeStageAwareMissingFields({extraction: safeExtraction, caseRecord: existingCase});

  const caseRecord = existingCase
    ? await updateCaseFromThreadExtraction(existingCase.id, safeExtraction)
    : await createCaseFromExtraction({
      customer: await findOrCreateCustomer({
        name: extraction.clientName ?? input.senderName,
        platform: input.platform,
        contactHandle: input.senderId ?? input.senderName,
      }),
      platform: input.platform,
      extraction: safeExtraction,
    });
  if (!caseRecord) {
    throw new Error('Failed to create or update case from extraction');
  }
  await attachMessageToCase(message.id, caseRecord.id);
  const linkedMessage: MessageEvent = await setSystemPendingReplyIfUnset(message.id) ?? await attachMessageToCase(message.id, caseRecord.id);
  const threadAlerts: Alert[] = [];
  if (threadContext.needsHumanReview) {
    threadAlerts.push(await createAlert({
      caseId: caseRecord.id,
      type: 'needs_human_review',
      title: 'Thread 欄位衝突需人工確認',
      message: threadContext.conflictingFields.length > 0 ? threadContext.conflictingFields.map((field) => `${field.field}: 既有 ${String(field.existing)}，新信 ${String(field.extracted)}`).join('；') : 'AI 擷取到新的 thread 欄位值，套用前需人工確認。',
      severity: 'warning',
    }));
  }
  const reviewFields = new Set([...Object.keys(threadContext.changedFields), ...threadContext.conflictingFields.map((field) => field.field)]);
  const reviewItems = await createReviewItems(Array.from(reviewFields).map((field) => {
    const conflict = threadContext.conflictingFields.find((item) => item.field === field);
    return {
      messageId: message.id,
      caseId: caseRecord.id,
      alertId: threadAlerts[0]?.id ?? null,
      field: field as ThreadAwareField,
      existingValue: conflict?.existing ?? existingCase?.[field as keyof typeof existingCase] ?? null,
      suggestedValue: conflict?.extracted ?? threadContext.changedFields[field as keyof typeof threadContext.changedFields] ?? null,
      source: conflict ? 'conflict' as const : 'changed' as const,
      isConflict: Boolean(conflict),
    };
  }));
  const alerts = [...threadAlerts, ...(await runRules(caseRecord, extraction))];
  const similarCases = await findSimilarCases(extraction);

  return {message: linkedMessage, extraction, case: caseRecord, alerts, modelName, similarCases, threadContext, reviewItems};
}
