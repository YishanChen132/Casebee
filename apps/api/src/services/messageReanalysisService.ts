import type {Alert, CaseRecord} from '@casebee/shared';
import {createAiExtraction} from '../repositories/aiExtractionsRepository.js';
import {findCaseById, findCaseDetailById, updateCaseFromReanalysis} from '../repositories/casesRepository.js';
import {findMessageById, findMessagesByThreadId} from '../repositories/messagesRepository.js';
import {analyzeThreadAwareMessage} from './threadContextService.js';
import {computeStageAwareMissingFields} from './missingFieldService.js';
import {findSimilarCases} from './ragService.js';
import {runRules} from './ruleEngine.js';

export async function reanalyzeMessage(messageId: string) {
  const message = await findMessageById(messageId);
  if (!message) {
    return null;
  }

  const existingCase = message.caseId ? await findCaseById(message.caseId) : null;
  const threadMessages = message.threadId ? await findMessagesByThreadId(message.threadId) : [];
  const {result: threadContext, modelName, overallConfidence, fieldConfidence, warnings} = await analyzeThreadAwareMessage({senderName: message.senderName, text: message.text, receivedAt: message.timestamp, threadMessages, existingCase});
  const extraction = {...threadContext.extraction, missingFields: computeStageAwareMissingFields({extraction: threadContext.extraction, caseRecord: existingCase})};
  await createAiExtraction(message.id, extraction, modelName, {overallConfidence, fieldConfidence, warnings, threadContext});

  let caseRecord: CaseRecord | null = null;
  let alerts: Alert[] = [];
  if (message.caseId) {
    caseRecord = await updateCaseFromReanalysis(message.caseId, extraction);
    if (caseRecord) {
      alerts = await runRules(caseRecord, extraction);
    }
  }

  const similarCases = await findSimilarCases(extraction);
  const caseDetail = caseRecord ? await findCaseDetailById(caseRecord.id) : null;

  return {message, extraction, case: caseRecord, caseDetail, alerts, modelName, similarCases};
}
