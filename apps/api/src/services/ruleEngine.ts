import {missingFieldDefinitions} from '@casebee/shared';
import type {AiExtraction, Alert, CaseRecord} from '@casebee/shared';
import {createAlert, findOpenAlertByCaseAndType, syncMissingFieldAlerts} from '../repositories/alertsRepository.js';
import {findAllCases, updateCaseMissingFields, updateCaseRisk} from '../repositories/casesRepository.js';
import {findLatestMessageByCaseId} from '../repositories/messagesRepository.js';
import {computeStageAwareMissingFields} from './missingFieldService.js';

const missingFieldLabels: Record<string, string> = {
  client_name: '客戶名稱',
  project_item: '專案項目',
  deliverables: '交付項目',
  scope: '工作範圍',
  quote_amount: '預算 / 報價金額',
  expected_deadline: '預期到期時間',
  usage_rights: '授權期間與使用範圍',
  revision_scope: '修改次數 / 修改範圍',
  contract: '合約確認',
  payment_terms: '付款條件',
  required_materials: '必要素材',
  submission_deadline: '交稿期限',
  publish_deadline: '發布 / 上線期限',
  next_action: '下一步',
};

function missingFieldLabel(field: string) {
  return missingFieldLabels[field] ?? missingFieldDefinitions[field as keyof typeof missingFieldDefinitions] ?? field;
}

const replyOverdueStatuses: CaseRecord['status'][] = ['潛在詢問', '需求確認中', '已報價', '等待回覆', '等待素材', '待修改'];

function getReplyOverdueThresholdHours() {
  const thresholdHours = Number(process.env.REPLY_OVERDUE_HOURS ?? 24);
  return Number.isFinite(thresholdHours) ? thresholdHours : 24;
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function buildContext(caseRecord: CaseRecord, extraction: AiExtraction) {
  const stripSimilarCaseText = (text: string | null | undefined) => (text ?? '').replace(/相似案例：[^；。]*[；。]?/g, '');
  return [caseRecord.title, stripSimilarCaseText(caseRecord.summary), extraction.intent, stripSimilarCaseText(extraction.summary), extraction.projectItem ?? '', extraction.expectedDeadline ?? ''].join(' ');
}

export async function runRules(caseRecord: CaseRecord, extraction: AiExtraction): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const context = buildContext(caseRecord, extraction);
  const missingFields = computeStageAwareMissingFields({caseRecord, extraction});
  const syncedMissingAlerts = await syncMissingFieldAlerts(caseRecord.id, missingFields);
  if (missingFields.join(',') !== caseRecord.missingFields.join(',')) {
    await updateCaseMissingFields(caseRecord.id, missingFields);
  }

  alerts.push(...syncedMissingAlerts.map((alert) => ({
    ...alert,
    title: `缺少欄位：${missingFieldLabel(String(alert.metadata?.field ?? ''))}`,
    message: `缺少欄位：${missingFieldLabel(String(alert.metadata?.field ?? ''))}。建議先追問後再報價或排程。`,
  })));

  if (extraction.expectedDeadline && /(今天|明天|後天|本週)/.test(extraction.expectedDeadline)) {
    alerts.push(
      await createAlert({
        caseId: caseRecord.id,
        type: 'deadline_risk',
        title: '交期風險',
        message: `交期為「${extraction.expectedDeadline}」，建議優先確認排程。`,
        severity: 'danger',
      }),
    );
  }

  if (includesAny(context, ['順便', '追加', '加做', '改成', '多做', '修改', '調整'])) {
    alerts.push(
      await createAlert({
        caseId: caseRecord.id,
        type: 'scope_change',
        title: '需求變更偵測',
        message: '訊息可能包含追加或修改需求，建議確認是否調整報價、交期與修改次數。',
        severity: 'warning',
      }),
    );
  }

  if (extraction.quoteAmount !== null && extraction.quoteAmount < 10000 && includesAny(context, ['影片', 'Reels', '網站', 'Logo', '產品攝影'])) {
    alerts.push(
      await createAlert({
        caseId: caseRecord.id,
        type: 'low_budget',
        title: '預算偏低',
        message: `目前預算為 ${extraction.quoteAmount}，相對於交付項目可能偏低，建議縮小範圍或提出分級方案。`,
        severity: 'warning',
      }),
    );
  }

  if (includesAny(context, ['急', '馬上', '今天', '明天', '後天', '來不及'])) {
    alerts.push(
      await createAlert({
        caseId: caseRecord.id,
        type: 'urgent_reply',
        title: '需優先回覆',
        message: '訊息包含急件或近期交付語意，建議優先回覆並確認可行排程。',
        severity: 'danger',
      }),
    );
  }

  if (missingFields.length >= 2) {
    alerts.push(
      await createAlert({
        caseId: caseRecord.id,
        type: 'needs_clarification',
        title: '需先釐清需求',
        message: '此案件缺少多個核心欄位，建議先回覆釐清交付內容、預算與期限，不要直接報價。',
        severity: 'warning',
      }),
    );
  }

  if (alerts.some((alert) => alert.severity === 'danger')) {
    await updateCaseRisk(caseRecord.id, 'danger');
  } else if (alerts.length > 0) {
    await updateCaseRisk(caseRecord.id, 'warning');
  }

  return alerts;
}

export async function runReplyOverdueRules() {
  const thresholdHours = getReplyOverdueThresholdHours();
  const thresholdMs = thresholdHours * 60 * 60 * 1000;
  const cases = await findAllCases();
  const alerts: Alert[] = [];
  let checkedCount = 0;

  for (const item of cases) {
    if (!replyOverdueStatuses.includes(item.status)) {
      continue;
    }

    checkedCount += 1;
    const latestMessage = await findLatestMessageByCaseId(item.id);
    if (!latestMessage) {
      continue;
    }

    const elapsedMs = Date.now() - new Date(latestMessage.timestamp).getTime();
    if (elapsedMs < thresholdMs) {
      continue;
    }

    const existingAlert = await findOpenAlertByCaseAndType(item.id, 'reply_overdue');
    if (existingAlert) {
      continue;
    }

    alerts.push(
      await createAlert({
        caseId: item.id,
        type: 'reply_overdue',
        title: '客戶訊息尚未回覆',
        message: `此案件最後一則訊息已超過 ${Math.round(elapsedMs / 60 / 60 / 1000)} 小時，建議優先回覆或更新案件狀態。`,
        severity: 'warning',
      }),
    );
    await updateCaseRisk(item.id, 'warning');
  }

  return {checkedCount, createdCount: alerts.length, thresholdHours: thresholdMs / 60 / 60 / 1000, alerts};
}

export function getRuleScheduleStatus() {
  const thresholdHours = getReplyOverdueThresholdHours();
  return {
    thresholdHours,
    mode: 'manual' as const,
    nextRunAt: null,
    description: `目前採手動執行，未回覆逾時門檻為 ${thresholdHours} 小時。正式部署後可改用 cron 或 worker 排程。`,
  };
}
