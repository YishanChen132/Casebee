import type {AiExtraction, CaseStatus} from '@casebee/shared';
import {preprocessEmail} from './emailPreprocessor.js';
import {validateExtraction} from './extractionValidator.js';
import {extractMessage as extractWithRules} from './extractionService.js';
import {classifyPreparedMessage} from './messageClassifier.js';
import {findSimilarCasesForText} from './ragService.js';

const allowedStatuses: CaseStatus[] = ['潛在詢問', '需求確認中', '已報價', '等待回覆', '已確認合作', '進行中', '等待素材', '待修改', '待交付', '已完成', '已流失'];

const extractionSystemPrompt = `You extract structured case-management data from freelancer client messages.
Return only valid JSON with these keys:
clientName, projectItem, quoteAmount, expectedDeadline, submissionDeadline, publishDeadline, nextAction, nextActionSource, requiredMaterials, providedMaterials, intent, caseStatus, missingFields, summary, suggestedReply.
Use Traditional Chinese for summary and suggestedReply.
Perform the weak-field decisions explicitly in this order without adding extra model calls:
1. intent: identify the main semantic event of this message, not just keyword presence.
2. nextAction: decide who must do what now, and omit stale or merely informational actions.
3. missingFields: list only information still required for the current case state after known facts are applied.
Prefer the company/brand name for clientName, not a sentence such as "我是某某團隊".
Extract quoteAmount only when a real budget/fee/quote amount is mentioned; do not treat years or dates as amounts.
Extract expectedDeadline as the next closest key deadline. Use submissionDeadline for draft/script/material/final delivery to client. Use publishDeadline for public launch/posting/release/campaign dates. Do not infer typed deadlines when the text only says a generic completion date.
Use nextActionSource as extracted only when the message explicitly asks an action, inferred when derived from stage rules, or null.
requiredMaterials lists only materials still needed from the client. providedMaterials lists materials explicitly already provided.
caseStatus must be one of: 潛在詢問, 需求確認中, 已報價, 等待回覆, 已確認合作, 進行中, 等待素材, 待修改, 待交付, 已完成, 已流失.
missingFields may include project_item, quote_amount, expected_deadline, submission_deadline, publish_deadline, next_action, required_materials.
Use null when a value is not mentioned.`;

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith('{') ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) {
    throw new Error('AI response did not contain JSON');
  }
  return JSON.parse(jsonText) as Record<string, unknown>;
}

function normalizeExtraction(raw: Record<string, unknown>, fallback: AiExtraction): AiExtraction {
  const caseStatus = allowedStatuses.includes(raw.caseStatus as CaseStatus) ? (raw.caseStatus as CaseStatus) : fallback.caseStatus;
  const missingFields = Array.isArray(raw.missingFields) ? raw.missingFields.map(String) : fallback.missingFields;
  const requiredMaterials = Array.isArray(raw.requiredMaterials) ? raw.requiredMaterials.map(String) : fallback.requiredMaterials;
  const providedMaterials = Array.isArray(raw.providedMaterials) ? raw.providedMaterials.map(String) : fallback.providedMaterials;
  const quoteAmount = typeof raw.quoteAmount === 'number' ? raw.quoteAmount : raw.quoteAmount ? Number(raw.quoteAmount) : fallback.quoteAmount;

  return {
    clientName: typeof raw.clientName === 'string' ? raw.clientName : fallback.clientName,
    projectItem: typeof raw.projectItem === 'string' ? raw.projectItem : fallback.projectItem,
    quoteAmount: Number.isFinite(quoteAmount) ? quoteAmount : null,
    expectedDeadline: typeof raw.expectedDeadline === 'string' ? raw.expectedDeadline : fallback.expectedDeadline,
    submissionDeadline: typeof raw.submissionDeadline === 'string' ? raw.submissionDeadline : fallback.submissionDeadline,
    publishDeadline: typeof raw.publishDeadline === 'string' ? raw.publishDeadline : fallback.publishDeadline,
    nextAction: typeof raw.nextAction === 'string' ? raw.nextAction : fallback.nextAction,
    nextActionSource: raw.nextActionSource === 'extracted' || raw.nextActionSource === 'inferred' || raw.nextActionSource === 'user_confirmed' ? raw.nextActionSource : fallback.nextActionSource,
    requiredMaterials,
    providedMaterials,
    intent: typeof raw.intent === 'string' ? raw.intent : fallback.intent,
    caseStatus,
    missingFields,
    summary: typeof raw.summary === 'string' ? raw.summary : fallback.summary,
    suggestedReply: typeof raw.suggestedReply === 'string' ? raw.suggestedReply : fallback.suggestedReply,
  };
}

async function extractWithOpenAi(input: {senderName: string; text: string}, fallback: AiExtraction) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      response_format: {type: 'json_object'},
      messages: [
        {role: 'system', content: extractionSystemPrompt},
        {role: 'user', content: `senderName: ${input.senderName}\nmessage: ${input.text}`},
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI extraction failed: ${response.status}`);
  }

  const payload = (await response.json()) as {choices?: Array<{message?: {content?: string}}>};
  return normalizeExtraction(parseJsonObject(payload.choices?.[0]?.message?.content ?? ''), fallback);
}

async function extractWithGemini(input: {senderName: string; text: string}, fallback: AiExtraction) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required');
  }

  const model = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{text: `${extractionSystemPrompt}\n\nsenderName: ${input.senderName}\nmessage: ${input.text}`}],
        },
      ],
      generationConfig: {responseMimeType: 'application/json'},
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini extraction failed: ${response.status}`);
  }

  const payload = (await response.json()) as {candidates?: Array<{content?: {parts?: Array<{text?: string}>}}>};
  return normalizeExtraction(parseJsonObject(payload.candidates?.[0]?.content?.parts?.[0]?.text ?? ''), fallback);
}

export async function analyzeMessage(input: {senderName: string; text: string; receivedAt?: string; ragEnabled?: boolean}) {
  const prepared = preprocessEmail(input.text);
  const classification = classifyPreparedMessage(prepared);
  const similarCases = input.ragEnabled === false ? [] : await findSimilarCasesForText(prepared.cleanText);
  const fallback = extractWithRules({...input, prepared, classification, similarCases, receivedAt: input.receivedAt});
  const fallbackValidation = validateExtraction({extraction: fallback, prepared, classification, similarCases});
  const provider = (process.env.AI_PROVIDER ?? 'rule').toLowerCase();

  if (provider === 'openai') {
    try {
      const extraction = await extractWithOpenAi({senderName: input.senderName, text: prepared.cleanText}, fallback);
      const validation = validateExtraction({extraction, prepared, classification, similarCases});
      return {extraction, modelName: `${process.env.OPENAI_MODEL ?? 'gpt-4o-mini'} (confidence ${validation.confidence})`, validation, similarCases};
    } catch (error) {
      return {extraction: fallback, modelName: `rule-rag-fallback confidence ${fallbackValidation.confidence} (openai fallback: ${error instanceof Error ? error.message : 'unknown error'})`, validation: fallbackValidation, similarCases};
    }
  }

  if (provider === 'gemini') {
    try {
      const extraction = await extractWithGemini({senderName: input.senderName, text: prepared.cleanText}, fallback);
      const validation = validateExtraction({extraction, prepared, classification, similarCases});
      return {extraction, modelName: `${process.env.GEMINI_MODEL ?? 'gemini-1.5-flash'} (confidence ${validation.confidence})`, validation, similarCases};
    } catch (error) {
      return {extraction: fallback, modelName: `rule-rag-fallback confidence ${fallbackValidation.confidence} (gemini fallback: ${error instanceof Error ? error.message : 'unknown error'})`, validation: fallbackValidation, similarCases};
    }
  }

  return {extraction: fallback, modelName: `rule-rag-fallback confidence ${fallbackValidation.confidence}`, validation: fallbackValidation, similarCases};
}
