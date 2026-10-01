import type {Alert, CaseRecord} from '@casebee/shared';
import {createAiExtraction} from '../repositories/aiExtractionsRepository.js';
import {findCaseById, findCaseDetailById, updateCaseFromReanalysis} from '../repositories/casesRepository.js';
import {findMessageById} from '../repositories/messagesRepository.js';
import {analyzeMessage} from './aiService.js';
import {computeStageAwareMissingFields} from './missingFieldService.js';
import {findSimilarCases} from './ragService.js';
import {runRules} from './ruleEngine.js';

export async function reanalyzeMessage(messageId: string) {
  const message = await findMessageById(messageId);
  if (!message) {
    return null;
  }

  const existingCase = message.caseId ? await findCaseById(message.caseId) : null;
  const analyzed = await analyzeMessage({senderName: message.senderName, text: message.text, receivedAt: message.timestamp});
  const extraction = {...analyzed.extraction, missingFields: computeStageAwareMissingFields({extraction: analyzed.extraction, caseRecord: existingCase})};
  const modelName = analyzed.modelName;
  await createAiExtraction(message.id, extraction, modelName);

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
