import {mapCaseStatusToStage, normalizeMissingFields, stageRequiredFields} from '@casebee/shared';
import type {AiExtraction, CaseRecord, CaseStage, MissingFieldName} from '@casebee/shared';

const stageCompatibleFields = new Set<string>(Object.values(stageRequiredFields).flat());

function hasText(value: string | null | undefined) {
  return Boolean(value && value.trim());
}

function context(input: {extraction: AiExtraction; caseRecord?: CaseRecord | null}) {
  return [
    input.extraction.summary,
    input.extraction.suggestedReply,
    input.extraction.nextAction ?? '',
    input.extraction.requiredMaterials.join(' '),
    input.caseRecord?.summary ?? '',
    input.caseRecord?.nextAction ?? '',
    input.caseRecord?.requiredMaterials.join(' ') ?? '',
  ].join(' ');
}

export function resolveCaseStage(input: {caseStatus?: string | null; caseRecord?: CaseRecord | null}): CaseStage {
  return mapCaseStatusToStage(input.caseStatus ?? input.caseRecord?.status ?? '潛在詢問');
}

export function extractionFromCase(caseRecord: CaseRecord): AiExtraction {
  return {
    clientName: caseRecord.customerName,
    projectItem: caseRecord.projectItem === '待釐清需求' ? null : caseRecord.projectItem,
    quoteAmount: caseRecord.quoteAmount,
    expectedDeadline: caseRecord.expectedDeadline,
    submissionDeadline: caseRecord.submissionDeadline,
    publishDeadline: caseRecord.publishDeadline,
    nextAction: caseRecord.nextAction,
    nextActionSource: caseRecord.nextActionSource,
    requiredMaterials: caseRecord.requiredMaterials,
    providedMaterials: caseRecord.providedMaterials,
    intent: caseRecord.summary,
    caseStatus: caseRecord.status,
    missingFields: caseRecord.missingFields,
    summary: caseRecord.summary,
    suggestedReply: '',
  };
}

export function fieldHasValue(field: MissingFieldName, input: {extraction: AiExtraction; caseRecord?: CaseRecord | null}) {
  const {extraction, caseRecord} = input;
  const text = context(input);
  switch (field) {
    case 'client_name':
      return hasText(extraction.clientName) || hasText(caseRecord?.customerName);
    case 'project_item':
      return hasText(extraction.projectItem) || Boolean(caseRecord?.projectItem && caseRecord.projectItem !== '待釐清需求');
    case 'quote_amount':
      return extraction.quoteAmount !== null || (caseRecord?.quoteAmount !== null && caseRecord?.quoteAmount !== undefined);
    case 'expected_deadline':
      return hasText(extraction.expectedDeadline) || hasText(caseRecord?.expectedDeadline);
    case 'deliverables':
      return /一支|一篇|一張|一組|\d+\s*(張|支|頁|款)|交付|產出|deliverable|reels|影片|貼文|名片|logo|網站|官網|包裝|簡報|dm/i.test(text);
    case 'scope':
      return /範圍|頁數|張數|支數|包含|不包含|scope|改成|追加|一式|雙面/i.test(text);
    case 'usage_rights':
      return /授權|使用範圍|使用期間|轉發|露出|官網使用|廣告投放|usage|rights/i.test(text);
    case 'revision_scope':
      return /修改|修正|調整|審稿|修改次數|revision/i.test(text);
    case 'contract':
      return /合約|簽約|contract/i.test(text);
    case 'payment_terms':
      return /付款|首付款|訂金|尾款|發票|含稅|未稅|payment/i.test(text);
    case 'required_materials':
      return extraction.requiredMaterials.length > 0 || (caseRecord?.requiredMaterials.length ?? 0) > 0;
    case 'next_action':
      return hasText(extraction.nextAction) || hasText(caseRecord?.nextAction);
    case 'submission_deadline':
      return hasText(extraction.submissionDeadline) || hasText(caseRecord?.submissionDeadline);
    case 'publish_deadline':
      return hasText(extraction.publishDeadline) || hasText(caseRecord?.publishDeadline);
  }
}

function needsConditionalField(field: MissingFieldName, input: {extraction: AiExtraction; caseRecord?: CaseRecord | null}) {
  const text = context(input);
  if (field === 'submission_deadline') return /交稿|初稿|腳本|成品|修改稿|交件|交付|完稿|提交/.test(text);
  if (field === 'publish_deadline') return /上線|發布|貼文|公開|活動開始|上架|刊登/.test(text);
  if (field === 'required_materials') return /請提供|待提供|等待.*素材|補.*素材|缺.*素材|素材.*再確認/.test(text);
  return true;
}

export function computeStageAwareMissingFields(input: {extraction: AiExtraction; caseRecord?: CaseRecord | null}) {
  const stage = resolveCaseStage({caseStatus: input.extraction.caseStatus, caseRecord: input.caseRecord});
  if (stage === 'completed' || stage === 'cancelled') {
    return [];
  }

  const required = stageRequiredFields[stage];
  const missing = new Set<string>();
  for (const field of required) {
    if (needsConditionalField(field, input) && !fieldHasValue(field, input)) {
      missing.add(field);
    }
  }

  for (const field of ['submission_deadline', 'publish_deadline', 'required_materials'] as MissingFieldName[]) {
    if (stage === 'execution' && needsConditionalField(field, input) && !fieldHasValue(field, input)) {
      missing.add(field);
    }
  }

  for (const field of normalizeMissingFields(input.extraction.missingFields)) {
    const fieldName = field as MissingFieldName;
    if ((stageCompatibleFields.has(field) || field === 'submission_deadline' || field === 'publish_deadline') && (required.includes(fieldName) || needsConditionalField(fieldName, input)) && !fieldHasValue(fieldName, input)) {
      missing.add(field);
    }
  }

  return normalizeMissingFields(Array.from(missing));
}
