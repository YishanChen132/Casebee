import type {AiExtraction, AiReviewDetail, AiReviewHistoryItem, AiReviewItem, Alert, BusinessProfile, BusinessRiskScore, BusinessRiskSummary, CaseDetail, CaseRecord, CaseStatus, CreateRagExampleInput, CustomerDetail, CustomerSummary, GmailSkippedMessage, MessageEvent, MessageReplyStatusHistoryItem, Platform, RagExample, ReplyStatus, RuleScheduleStatus, ThreadAwareExtractionResult} from '@casebee/shared';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

interface ApiResponse<T> {
  data: T;
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`);

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  const payload = (await response.json()) as ApiResponse<T>;
  return payload.data;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  const payload = (await response.json()) as ApiResponse<T>;
  return payload.data;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  const payload = (await response.json()) as ApiResponse<T>;
  return payload.data;
}

export function getCases() {
  return request<CaseRecord[]>('/api/cases');
}

export function getCustomers() {
  return request<CustomerSummary[]>('/api/customers');
}

export function getCustomerDetail(id: string) {
  return request<CustomerDetail>(`/api/customers/${id}/details`);
}

export function getCaseDetail(id: string) {
  return request<CaseDetail>(`/api/cases/${id}/details`);
}

export function updateCaseStatus(id: string, status: CaseStatus) {
  return patch<CaseRecord>(`/api/cases/${id}`, {status});
}

export function updateCase(id: string, input: {status?: CaseStatus; quoteAmount?: number | null; expectedDeadline?: string | null; summary?: string}) {
  return patch<CaseRecord>(`/api/cases/${id}`, input);
}

export function resolveAlert(id: string) {
  return patch<Alert>(`/api/alerts/${id}/resolve`, {});
}

export interface MessageExclusionRule {
  id: string;
  platform: Platform;
  matchType: 'sender_email';
  matchValue: string;
  reason: string;
  sourceMessageId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function getMessages(visibility: 'active' | 'excluded' | 'all' = 'active') {
  return request<MessageEvent[]>(`/api/messages?visibility=${visibility}`);
}

export function excludeMessage(id: string, reason: string) {
  return post<{message: MessageEvent; excludedCaseId: string | null; learnedRule: unknown | null}>(`/api/messages/${id}/exclude`, {reason});
}

export function excludeSenderForMessage(id: string, reason: string) {
  return post<{message: MessageEvent; excludedCaseId: string | null; learnedRule: MessageExclusionRule | null}>(`/api/messages/${id}/exclude-sender`, {reason});
}

export function restoreMessage(id: string) {
  return post<{message: MessageEvent; restoredCaseId: string | null}>(`/api/messages/${id}/restore`, {});
}

export function getMessageExclusionRules() {
  return request<MessageExclusionRule[]>('/api/message-exclusion-rules');
}

export function updateMessageExclusionRule(id: string, isActive: boolean) {
  return patch<MessageExclusionRule>(`/api/message-exclusion-rules/${id}`, {isActive});
}

export function updateMessageReplyStatus(id: string, replyStatus: ReplyStatus) {
  return patch<MessageEvent>(`/api/messages/${id}/reply-status`, {replyStatus});
}

export function getMessageReplyStatusHistory(id: string) {
  return request<MessageReplyStatusHistoryItem[]>(`/api/messages/${id}/reply-status-history`);
}

export function reanalyzeMessage(id: string) {
  return post<ImportPipelineResult & {caseDetail: CaseDetail | null}>(`/api/messages/${id}/reanalyze`, {});
}

export function getMessageReview(id: string) {
  return request<AiReviewDetail>(`/api/messages/${id}/review`);
}

export function resolveReview(id: string, input: {action: 'apply' | 'keep' | 'edit'; value?: unknown}) {
  return post<{item: AiReviewItem; history: AiReviewHistoryItem}>(`/api/reviews/${id}/resolve`, input);
}

export interface ImportPipelineResult {
  message: MessageEvent;
  extraction: AiExtraction;
  case: CaseRecord;
  alerts: Alert[];
  modelName: string;
  similarCases: RagExample[];
  threadContext?: ThreadAwareExtractionResult;
  reviewItems?: AiReviewItem[];
}

export function importMessage(input: {platform: Platform; senderName: string; text: string}) {
  return post<ImportPipelineResult>('/api/messages/import', input);
}

export function getGmailAuthUrl() {
  return request<{url: string}>('/api/integrations/gmail/auth');
}

export function getGmailStatus() {
  return request<{configured: boolean; connected: boolean; accountEmail: string | null; lastSyncedAt: string | null; redirectUri: string; autoPollEnabled: boolean; autoPollIntervalSeconds: number}>('/api/integrations/gmail/status');
}

export function pollGmail() {
  return post<{
    checkedCount: number;
    importedCount: number;
    skippedCount: number;
    emptyCount: number;
    failedCount: number;
    query: string;
    imported: ImportPipelineResult[];
    skipped: Array<{gmailMessageId: string; messageId?: string; category: string; reason: string}>;
    failed: Array<{gmailMessageId: string; reason: string}>;
  }>('/api/integrations/gmail/poll', {});
}

export function getSkippedGmailMessages(status: 'pending' | 'restored' | 'all' = 'pending') {
  return request<GmailSkippedMessage[]>(`/api/integrations/gmail/skipped?status=${status}`);
}

export function importSkippedGmailMessage(id: string) {
  return post<{skipped: GmailSkippedMessage; result: ImportPipelineResult | null; existingMessage: MessageEvent | null; alreadyRestored: boolean}>(`/api/integrations/gmail/skipped/${id}/import`, {});
}

export function importDemoMessages() {
  return post<{
    importedCount: number;
    skippedCount: number;
    imported: ImportPipelineResult[];
    skipped: Array<{demoMessageId: string; messageId: string}>;
  }>('/api/demo/import', {});
}

export function runRules() {
  return post<{checkedCount: number; createdCount: number; thresholdHours: number; alerts: Alert[]}>('/api/rules/run', {});
}

export function getRuleStatus() {
  return request<RuleScheduleStatus>('/api/rules/status');
}

export function getRagExamples() {
  return request<RagExample[]>('/api/rag/examples');
}

export function createRagExample(input: CreateRagExampleInput) {
  return post<RagExample>('/api/rag/examples', input);
}

export function deactivateRagExample(id: string) {
  return patch<RagExample>(`/api/rag/examples/${id}/deactivate`, {});
}

export function getBusinessRiskSummary() {
  return request<BusinessRiskSummary>('/api/business/risk-summary');
}

export function enrichBusinessRisk(input: {customerName: string; taxId?: string; customerId?: string}) {
  return post<{profile: BusinessProfile | null; riskScore: BusinessRiskScore; provider: string}>('/api/business/enrich', input);
}
