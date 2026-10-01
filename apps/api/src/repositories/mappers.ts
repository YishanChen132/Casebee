import {mapCaseStatusToStage, normalizeMissingFields} from '@casebee/shared';
import type {Alert, CaseRecord, Customer, MessageEvent} from '@casebee/shared';

export function mapCustomer(row: Record<string, unknown>): Customer {
  return {
    id: String(row.id),
    name: String(row.name),
    platform: row.platform as Customer['platform'],
    contactHandle: String(row.contact_handle),
    lastContactAt: new Date(String(row.last_contact_at)).toISOString(),
  };
}

export function mapCase(row: Record<string, unknown>): CaseRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    customerId: String(row.customer_id),
    customerName: String(row.customer_name),
    title: String(row.title),
    platform: row.platform as CaseRecord['platform'],
    status: row.status as CaseRecord['status'],
    caseStage: mapCaseStatusToStage(String(row.status)),
    projectItem: String(row.project_item),
    quoteAmount: row.quote_amount === null ? null : Number(row.quote_amount),
    expectedDeadline: row.expected_deadline === null ? null : String(row.expected_deadline),
    submissionDeadline: row.submission_deadline === null || row.submission_deadline === undefined ? null : String(row.submission_deadline),
    publishDeadline: row.publish_deadline === null || row.publish_deadline === undefined ? null : String(row.publish_deadline),
    nextAction: row.next_action === null || row.next_action === undefined ? null : String(row.next_action),
    nextActionSource: row.next_action_source === null || row.next_action_source === undefined ? null : row.next_action_source as CaseRecord['nextActionSource'],
    requiredMaterials: Array.isArray(row.required_materials) ? row.required_materials.map(String) : [],
    providedMaterials: Array.isArray(row.provided_materials) ? row.provided_materials.map(String) : [],
    summary: String(row.summary),
    riskLevel: row.risk_level as CaseRecord['riskLevel'],
    missingFields: normalizeMissingFields(Array.isArray(row.missing_fields) ? row.missing_fields.map(String) : []),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function mapMessage(row: Record<string, unknown>): MessageEvent {
  return {
    id: String(row.id),
    platform: row.platform as MessageEvent['platform'],
    senderId: String(row.sender_id),
    senderName: String(row.sender_name),
    text: String(row.text),
    timestamp: new Date(String(row.timestamp)).toISOString(),
    threadId: String(row.thread_id),
    caseId: row.case_id ? String(row.case_id) : undefined,
    reviewStatus: row.review_status ? row.review_status as MessageEvent['reviewStatus'] : undefined,
    needsHumanReview: row.needs_human_review === true,
    replyStatus: row.reply_status as MessageEvent['replyStatus'],
    replyStatusUpdatedAt: new Date(String(row.reply_status_updated_at)).toISOString(),
    replyStatusSource: row.reply_status_source as MessageEvent['replyStatusSource'],
  };
}

export function mapAlert(row: Record<string, unknown>): Alert {
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    type: row.type as Alert['type'],
    title: String(row.title),
    message: String(row.message),
    severity: row.severity as Alert['severity'],
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {},
    resolvedAt: row.resolved_at === null ? null : new Date(String(row.resolved_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}
