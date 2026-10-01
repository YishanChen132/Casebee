export type Platform = 'LINE' | 'Gmail' | 'Instagram' | 'Manual';

export type CaseStatus =
  | '潛在詢問'
  | '需求確認中'
  | '已報價'
  | '等待回覆'
  | '已確認合作'
  | '進行中'
  | '等待素材'
  | '待修改'
  | '待交付'
  | '已完成'
  | '已流失';

export type CaseStage = 'inquiry' | 'quotation' | 'confirmed' | 'execution' | 'completed' | 'cancelled';

export type MissingFieldName =
  | 'client_name'
  | 'project_item'
  | 'deliverables'
  | 'scope'
  | 'quote_amount'
  | 'expected_deadline'
  | 'usage_rights'
  | 'revision_scope'
  | 'contract'
  | 'payment_terms'
  | 'required_materials'
  | 'submission_deadline'
  | 'publish_deadline'
  | 'next_action';

export const caseStatusStageMap: Record<CaseStatus, CaseStage> = {
  潛在詢問: 'inquiry',
  需求確認中: 'inquiry',
  已報價: 'quotation',
  等待回覆: 'quotation',
  已確認合作: 'confirmed',
  進行中: 'execution',
  等待素材: 'execution',
  待修改: 'execution',
  待交付: 'execution',
  已完成: 'completed',
  已流失: 'cancelled',
};

export function mapCaseStatusToStage(status: string): CaseStage {
  return caseStatusStageMap[status as CaseStatus] ?? 'inquiry';
}

export const missingFieldDefinitions: Record<MissingFieldName, string> = {
  client_name: 'The client company, brand, or person responsible for the case.',
  project_item: 'The primary service or project category requested by the client.',
  deliverables: 'Concrete output items to deliver, such as one Reels video or six social posts.',
  scope: 'Boundary of work, including quantity, included tasks, excluded tasks, and scope changes.',
  quote_amount: 'Budget, quoted price, or fee amount for the case.',
  expected_deadline: 'General deadline when the message does not distinguish submission vs publish timing.',
  usage_rights: 'Usage period, channels, licensing, reposting, ad usage, or ownership terms.',
  revision_scope: 'Allowed revision rounds and what types of changes are included.',
  contract: 'Whether contract/signing workflow is mentioned or still needs confirmation before execution.',
  payment_terms: 'Deposit, final payment, invoice, tax, and payment milestone terms.',
  required_materials: 'Materials the client must provide before work can proceed.',
  submission_deadline: 'Deadline for freelancer draft, first version, final files, or submission to client.',
  publish_deadline: 'Deadline for public launch, posting, campaign go-live, or website release.',
  next_action: 'The next action is unclear, such as whether to quote, schedule, request material, or close the case.',
};

export const missingFieldOrder: MissingFieldName[] = [
  'client_name',
  'project_item',
  'deliverables',
  'scope',
  'quote_amount',
  'expected_deadline',
  'usage_rights',
  'revision_scope',
  'contract',
  'payment_terms',
  'required_materials',
  'submission_deadline',
  'publish_deadline',
  'next_action',
];

export const stageRequiredFields: Record<CaseStage, MissingFieldName[]> = {
  inquiry: ['client_name', 'project_item', 'deliverables', 'expected_deadline', 'quote_amount'],
  quotation: ['project_item', 'deliverables', 'quote_amount', 'expected_deadline', 'scope', 'usage_rights', 'revision_scope'],
  confirmed: ['project_item', 'deliverables', 'expected_deadline', 'quote_amount', 'contract', 'payment_terms', 'revision_scope'],
  execution: ['project_item', 'deliverables', 'expected_deadline', 'required_materials', 'next_action'],
  completed: [],
  cancelled: [],
};

const missingFieldAliases: Record<string, MissingFieldName> = {
  clientName: 'client_name',
  customerName: 'client_name',
  projectItem: 'project_item',
  project: 'project_item',
  amount: 'quote_amount',
  quoteAmount: 'quote_amount',
  budget: 'quote_amount',
  deadline: 'expected_deadline',
  expectedDeadline: 'expected_deadline',
  materials: 'required_materials',
  material: 'required_materials',
  required_material: 'required_materials',
  reference: 'required_materials',
  references: 'required_materials',
  revision: 'revision_scope',
  revisions: 'revision_scope',
  usage: 'usage_rights',
  rights: 'usage_rights',
  payment: 'payment_terms',
  nextStep: 'next_action',
};

export function normalizeMissingFieldName(field: string): MissingFieldName | string {
  return missingFieldAliases[field] ?? field;
}

export function normalizeMissingFields(fields: string[]): string[] {
  const normalized = Array.from(new Set(fields.map(normalizeMissingFieldName)));
  return normalized.sort((a, b) => {
    const aIndex = missingFieldOrder.indexOf(a as MissingFieldName);
    const bIndex = missingFieldOrder.indexOf(b as MissingFieldName);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
}

export type ReplyStatus = 'pending_reply' | 'replied' | 'no_reply_needed';
export type ReplyStatusSource = 'system' | 'user';
export type NextActionSource = 'extracted' | 'inferred' | 'user_confirmed';

export interface Customer {
  id: string;
  name: string;
  platform: Platform;
  contactHandle: string;
  lastContactAt: string;
}

export interface CustomerSummary extends Customer {
  caseCount: number;
  activeCaseCount: number;
  riskCaseCount: number;
  latestCaseUpdatedAt: string | null;
}

export interface CustomerDetail {
  customer: CustomerSummary;
  cases: CaseRecord[];
  messages: MessageEvent[];
  businessProfile: BusinessProfile | null;
  businessRiskScore: BusinessRiskScore | null;
}

export interface CaseRecord {
  id: string;
  code: string;
  customerId: string;
  customerName: string;
  title: string;
  platform: Platform;
  status: CaseStatus;
  caseStage: CaseStage;
  projectItem: string;
  quoteAmount: number | null;
  expectedDeadline: string | null;
  submissionDeadline: string | null;
  publishDeadline: string | null;
  nextAction: string | null;
  nextActionSource: NextActionSource | null;
  requiredMaterials: string[];
  providedMaterials: string[];
  summary: string;
  riskLevel: 'normal' | 'warning' | 'danger';
  missingFields: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CaseDetail {
  case: CaseRecord;
  messages: MessageEvent[];
  alerts: Alert[];
  aiExtractions: AiExtraction[];
  businessProfile: BusinessProfile | null;
  businessRiskScore: BusinessRiskScore | null;
  similarCases: RagExample[];
}

export interface MessageEvent {
  id: string;
  platform: Platform;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  threadId: string;
  caseId?: string;
  reviewStatus?: 'none' | 'pending' | 'resolved';
  needsHumanReview?: boolean;
  replyStatus: ReplyStatus;
  replyStatusUpdatedAt: string;
  replyStatusSource: ReplyStatusSource;
}

export interface MessageReplyStatusHistoryItem {
  id: string;
  messageId: string;
  previousStatus: ReplyStatus | null;
  newStatus: ReplyStatus;
  source: ReplyStatusSource;
  changedAt: string;
}

export interface Alert {
  id: string;
  caseId: string;
  type: 'reply_overdue' | 'deadline_risk' | 'missing_fields' | 'scope_change' | 'low_budget' | 'urgent_reply' | 'needs_clarification' | 'needs_human_review';
  title: string;
  message: string;
  severity: 'warning' | 'danger';
  metadata?: Record<string, unknown>;
  resolvedAt: string | null;
  createdAt: string;
}

export interface AiExtraction {
  clientName: string | null;
  projectItem: string | null;
  quoteAmount: number | null;
  expectedDeadline: string | null;
  submissionDeadline: string | null;
  publishDeadline: string | null;
  nextAction: string | null;
  nextActionSource: NextActionSource | null;
  requiredMaterials: string[];
  providedMaterials: string[];
  intent: string;
  caseStatus: CaseStatus;
  missingFields: string[];
  summary: string;
  suggestedReply: string;
}

export type ThreadAwareField = 'clientName' | 'projectItem' | 'quoteAmount' | 'expectedDeadline' | 'submissionDeadline' | 'publishDeadline' | 'nextAction' | 'requiredMaterials' | 'intent' | 'caseStatus' | 'missingFields';

export interface ThreadFieldConflict {
  field: ThreadAwareField;
  existing: unknown;
  extracted: unknown;
  reason: string;
}

export interface ThreadAwareExtractionResult {
  extraction: AiExtraction;
  extractedFields: Partial<AiExtraction>;
  inheritedFields: Partial<AiExtraction>;
  changedFields: Partial<AiExtraction>;
  conflictingFields: ThreadFieldConflict[];
  needsHumanReview: boolean;
  threadSummary: string | null;
  existingCaseId: string | null;
}

export interface AiReviewItem {
  id: string;
  messageId: string;
  caseId: string;
  alertId: string | null;
  field: ThreadAwareField;
  existingValue: unknown;
  suggestedValue: unknown;
  source: 'extracted' | 'inherited' | 'changed' | 'conflict';
  isConflict: boolean;
  status: 'pending' | 'applied' | 'kept' | 'edited';
  resolvedAt: string | null;
  createdAt: string;
}

export interface AiReviewHistoryItem {
  id: string;
  reviewItemId: string;
  messageId: string;
  caseId: string;
  field: ThreadAwareField;
  action: 'apply' | 'keep' | 'edit';
  previousValue: unknown;
  suggestedValue: unknown;
  finalValue: unknown;
  actor: string;
  createdAt: string;
}

export interface AiReviewDetail {
  items: AiReviewItem[];
  history: AiReviewHistoryItem[];
}

export interface RagExample {
  id: string;
  title: string;
  platform: Platform;
  projectItem: string;
  quoteAmount: number | null;
  outcome: string;
  summary: string;
  replyExample: string;
  isActive: boolean;
  caseType: string | null;
  projectAliases: string[];
  typicalMissingFields: string[];
  quoteRangeMin: number | null;
  quoteRangeMax: number | null;
  successPattern: string | null;
  score: number;
}

export interface CreateRagExampleInput {
  title: string;
  platform: Platform;
  projectItem: string;
  quoteAmount: number | null;
  outcome: string;
  summary: string;
  replyExample: string;
  caseType?: string | null;
  projectAliases?: string[];
  typicalMissingFields?: string[];
  quoteRangeMin?: number | null;
  quoteRangeMax?: number | null;
  successPattern?: string | null;
}

export interface RuleScheduleStatus {
  thresholdHours: number;
  mode: 'manual';
  nextRunAt: string | null;
  description: string;
}

export interface BusinessProfile {
  id: string;
  customerId: string | null;
  businessAccountingNo: string | null;
  businessName: string;
  businessType: 'company' | 'business' | 'unknown';
  statusCode: string | null;
  statusDesc: string | null;
  capitalAmount: number | null;
  paidInCapitalAmount: number | null;
  responsibleName: string | null;
  registeredAddress: string | null;
  registerOrganization: string | null;
  setupDate: string | null;
  lastChangeDate: string | null;
  source: 'mock' | 'gcis';
  fetchedAt: string;
}

export interface BusinessRiskFactor {
  type: string;
  label: string;
  scoreDelta: number;
}

export interface BusinessRiskScore {
  id: string;
  customerId: string | null;
  businessProfileId: string | null;
  score: number;
  riskLevel: 'low' | 'medium' | 'high' | 'unverified';
  positiveFactors: BusinessRiskFactor[];
  negativeFactors: BusinessRiskFactor[];
  calculatedAt: string;
}

export interface BusinessRiskSummary {
  low: number;
  medium: number;
  high: number;
  unverified: number;
  averageScore: number | null;
}
