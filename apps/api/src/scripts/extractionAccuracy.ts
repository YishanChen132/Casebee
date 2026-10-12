import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {normalizeMissingFields} from '@casebee/shared';
import type {AiExtraction, CaseRecord, MessageEvent} from '@casebee/shared';
import {preprocessEmail} from '../services/emailPreprocessor.js';
import {extractMessage} from '../services/extractionService.js';
import {validateExtraction} from '../services/extractionValidator.js';
import {classifyPreparedMessage, type MessageType} from '../services/messageClassifier.js';
import {findSimilarCasesForText} from '../services/ragService.js';
import {analyzeMessage} from '../services/aiService.js';
import {analyzeThreadAwareMessage} from '../services/threadContextService.js';

type ExpectedExtraction = Pick<AiExtraction, 'clientName' | 'projectItem' | 'quoteAmount' | 'expectedDeadline' | 'submissionDeadline' | 'publishDeadline' | 'nextAction' | 'requiredMaterials' | 'intent' | 'missingFields'>;
type DatasetName = 'development' | 'holdout' | 'thread';
type RagMode = 'rag_on' | 'rag_off' | 'thread_current_rag_off' | 'thread_current_rag_on' | 'thread_context_rag_off' | 'thread_context_rag_on' | 'thread_context';
type NormalizedErrorType = 'false_positive' | 'false_negative' | 'wrong_value' | 'normalization_mismatch' | 'evaluation_mismatch' | 'thread_inheritance_error' | 'RAG_interference' | 'rule_engine_interference';

interface ExtractionFixture {
  id: string;
  category: string;
  senderName: string;
  text: string;
  receivedAt?: string;
  expectedClassification?: MessageType;
  expected: ExpectedExtraction | null;
}

interface FieldResult {
  field: keyof ExpectedExtraction | 'classification' | 'inheritedFields' | 'changedFields' | 'conflictingFields' | 'needsHumanReview';
  passed: boolean;
  expected: unknown;
  actual: unknown;
  errorType: string | null;
  receivedAt?: string;
}

interface DetailedError {
  fixtureId: string;
  dataset: DatasetName;
  field: string;
  expected: unknown;
  actual: unknown;
  ragMode: RagMode;
  errorType: NormalizedErrorType;
  possibleCause: string;
  missing?: string[];
  extra?: string[];
  actualFieldSources?: Record<string, string>;
}

interface ThreadFixture {
  id: string;
  existingCase: Pick<AiExtraction, 'clientName' | 'projectItem' | 'quoteAmount' | 'expectedDeadline' | 'submissionDeadline' | 'publishDeadline' | 'nextAction' | 'requiredMaterials' | 'providedMaterials' | 'intent' | 'caseStatus' | 'missingFields'> & {customerName: string};
  messages: Array<{senderName: string; text: string}>;
  expected: Pick<AiExtraction, 'clientName' | 'projectItem' | 'quoteAmount' | 'expectedDeadline' | 'submissionDeadline' | 'publishDeadline' | 'nextAction' | 'requiredMaterials' | 'intent'> & {
    inheritedFields: string[];
    changedFields: string[];
    conflictingFields: string[];
    needsHumanReview: boolean;
  };
}

const developmentFixturePath = fileURLToPath(new URL('../fixtures/extraction/accuracy-fixtures.json', import.meta.url));
const holdoutFixturePath = fileURLToPath(new URL('../fixtures/extraction/holdout-fixtures.json', import.meta.url));
const threadFixturePath = fileURLToPath(new URL('../fixtures/extraction/thread-fixtures.json', import.meta.url));
const scalarFields: Array<keyof Omit<ExpectedExtraction, 'missingFields' | 'requiredMaterials'>> = ['clientName', 'projectItem', 'quoteAmount', 'expectedDeadline', 'submissionDeadline', 'publishDeadline', 'nextAction', 'intent'];
const reportedFields = ['projectItem', 'expectedDeadline', 'submissionDeadline', 'publishDeadline', 'nextAction', 'intent', 'requiredMaterials', 'missingFields'];
const legacyCoreFields = new Set(['clientName', 'projectItem', 'quoteAmount', 'expectedDeadline', 'intent', 'missingFields', 'classification']);
const extendedFields = new Set(['submissionDeadline', 'publishDeadline', 'nextAction', 'requiredMaterials']);

const actionCategoryMap: Record<string, string> = {
  '提供報價': 'provide_quote',
  '回覆合作報價': 'provide_quote',
  '確認檔期': 'confirm_schedule',
  '等待客戶確認': 'wait_for_client_confirmation',
  '請客戶提供素材': 'request_materials',
  '等待客戶提供素材': 'wait_for_materials',
  '等品牌補素材': 'wait_for_materials',
  '準備／提交初稿': 'submit_draft',
  '準備初稿': 'prepare_draft',
  '提交初稿': 'submit_draft',
  '修改內容': 'revise_content',
  '確認合約': 'confirm_contract',
  '確認付款': 'confirm_payment',
  '發布內容': 'publish_content',
};

function normalize(value: unknown) {
  if (value === undefined) return null;
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLowerCase() : value;
}

function formatIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function taipeiYear(receivedAt?: string) {
  const date = receivedAt ? new Date(receivedAt) : new Date('2026-08-31T00:00:00+08:00');
  return Number(new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Taipei', year: 'numeric'}).format(date));
}

function normalizeDateForComparison(value: unknown, receivedAt?: string) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return value;
  const year = taipeiYear(receivedAt);
  const compact = value.replace(/\s+/g, '');
  if (compact === '這週五' || compact === '本週五') return formatIsoDate(year, 9, 4);
  if (compact === '後天') return formatIsoDate(year, 9, 2);
  if (compact === '本週') return formatIsoDate(year, 9, 4);
  if (compact === '下週五') return formatIsoDate(year, 9, 11);
  if (compact === '月底') return formatIsoDate(year, 8, 31);
  const monthOnly = compact.match(/^(\d{1,2})月底$/);
  if (monthOnly?.[1]) return formatIsoDate(year, Number(monthOnly[1]), 31);
  const month = compact.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (month?.[1] && month[2]) return formatIsoDate(year, Number(month[1]), Number(month[2]));
  const yearMonth = compact.match(/^\d{4}年(\d{1,2})月(\d{1,2})日$/);
  if (yearMonth?.[1] && yearMonth[2]) return formatIsoDate(year, Number(yearMonth[1]), Number(yearMonth[2]));
  const fullSlash = compact.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (fullSlash?.[1] && fullSlash[2] && fullSlash[3]) return formatIsoDate(Number(fullSlash[1]), Number(fullSlash[2]), Number(fullSlash[3]));
  const slash = compact.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (slash?.[1] && slash[2]) return formatIsoDate(year, Number(slash[1]), Number(slash[2]));
  return compact.toLowerCase();
}

function actionCategory(value: unknown) {
  if (value === null || value === undefined || value === '') return 'no_action';
  return actionCategoryMap[String(value).replace(/\s+/g, '').trim()] ?? `unmapped:${String(value).replace(/\s+/g, '').trim()}`;
}

function normalizedErrorType(result: FieldResult, pairedPassed?: boolean): NormalizedErrorType {
  if (pairedPassed) return 'RAG_interference';
  if (result.field === 'inheritedFields' || result.field === 'changedFields' || result.field === 'conflictingFields') return 'thread_inheritance_error';
  if (result.errorType === 'extra_fields' || result.errorType === 'false_positive') return 'false_positive';
  if (result.errorType === 'missing_required_fields' || result.errorType === 'missing') return 'false_negative';
  if (result.field === 'expectedDeadline' || result.field === 'submissionDeadline' || result.field === 'publishDeadline') {
    const expected = result.expected;
    const actual = result.actual;
    if (expected !== null && actual !== null && normalizeDateForComparison(expected, result.receivedAt) === normalizeDateForComparison(actual, result.receivedAt)) return 'normalization_mismatch';
    return 'evaluation_mismatch';
  }
  if (result.errorType === 'missing_and_extra_fields') return 'wrong_value';
  return 'wrong_value';
}

function possibleCause(result: FieldResult, run: Awaited<ReturnType<typeof runFixture>> | Awaited<ReturnType<typeof runThreadFixture>>, dataset: DatasetName, ragMode: RagMode, pairedPassed?: boolean) {
  if (pairedPassed) return 'RAG-on differs from RAG-off and introduced this field mismatch.';
  if (dataset === 'thread' || result.field === 'inheritedFields' || result.field === 'changedFields' || result.field === 'conflictingFields') return 'Thread context inheritance/conflict expectation differs from current comparison output.';
  if (result.field === 'nextAction') return 'Exact nextAction string evaluation may be stricter than action semantics; compare category metrics before changing extraction.';
  if (result.field === 'missingFields') return 'MissingFields exact-set scoring hides partial matches; inspect missing/extra fields and field-level F1.';
  if (result.field === 'expectedDeadline') return 'Could be expectedDeadline compatibility strategy, relative-date normalization, or fixture natural-language/date-format mismatch.';
  if (result.field === 'submissionDeadline' || result.field === 'publishDeadline') return 'Could be typed deadline classification issue or generic deadline being treated as typed deadline.';
  if (result.field === 'requiredMaterials') return 'Could be pending/provided material distinction or generic material keyword overmatch.';
  if (ragMode === 'rag_on' && 'similarCases' in run && run.similarCases.length > 0) return 'RAG context may have affected project item or typical missing fields.';
  return 'Deterministic extraction output differs from fixture expectation.';
}

function setDiff(expected: unknown, actual: unknown) {
  if (!Array.isArray(expected) || !Array.isArray(actual)) return {};
  const expectedSet = new Set(expected.map(String));
  const actualSet = new Set(actual.map(String));
  return {
    missing: expected.map(String).filter((item) => !actualSet.has(item)),
    extra: actual.map(String).filter((item) => !expectedSet.has(item)),
  };
}

function sourceMissingFields(run: {extraction?: AiExtraction; similarCases?: Array<{typicalMissingFields: string[]}>}, ragEnabled: boolean) {
  const sources: Record<string, string> = {};
  for (const field of run.extraction?.missingFields ?? []) {
    const fromRag = ragEnabled && (run.similarCases ?? []).some((item) => item.typicalMissingFields.includes(field));
    sources[field] = fromRag ? 'RAG' : 'AI/deterministic';
  }
  return sources;
}

function scalarMetricRecord(results: FieldResult[]) {
  const total = results.length;
  const correct = results.filter((result) => result.passed).length;
  let falsePositive = 0;
  let falseNegative = 0;
  let wrongValue = 0;

  for (const result of results.filter((item) => !item.passed)) {
    if ((result.expected === null || result.expected === undefined || result.expected === '') && result.actual) falsePositive += 1;
    else if (result.expected && (result.actual === null || result.actual === undefined || result.actual === '')) falseNegative += 1;
    else wrongValue += 1;
  }

  const precisionDenominator = correct + falsePositive + wrongValue;
  const recallDenominator = correct + falseNegative + wrongValue;
  const precision = precisionDenominator === 0 ? 1 : correct / precisionDenominator;
  const recall = recallDenominator === 0 ? 1 : correct / recallDenominator;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    samples: total,
    correct,
    falsePositive,
    falseNegative,
    wrongValue,
    exactValueAccuracy: Number((correct / Math.max(1, total)).toFixed(3)),
    presencePrecision: Number(precision.toFixed(3)),
    presenceRecall: Number(recall.toFixed(3)),
    presenceF1: Number(f1.toFixed(3)),
  };
}

function setMetricRecord(results: FieldResult[]) {
  const metrics = missingFieldsMetrics(results);
  return {
    samples: results.length,
    exactSetCorrect: results.filter((result) => result.passed).length,
    falsePositiveFixtures: results.filter((result) => Array.isArray(result.actual) && Array.isArray(result.expected) && setDiff(result.expected, result.actual).extra?.length).length,
    falseNegativeFixtures: results.filter((result) => Array.isArray(result.actual) && Array.isArray(result.expected) && setDiff(result.expected, result.actual).missing?.length).length,
    exactSetAccuracy: metrics.missingFieldsExactSetAccuracy,
    microPrecision: metrics.missingFieldsMicroPrecision,
    microRecall: metrics.missingFieldsMicroRecall,
    microF1: metrics.missingFieldsMicroF1,
    macroF1: metrics.missingFieldsMacroF1,
  };
}

function missingFieldsMetrics(results: FieldResult[]) {
  if (results.length === 0) {
    return {
      missingFieldsExactSetAccuracy: null,
      missingFieldsMicroPrecision: null,
      missingFieldsMicroRecall: null,
      missingFieldsMicroF1: null,
      missingFieldsMacroF1: null,
      details: [],
    };
  }

  let exactCorrect = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const fixtureF1Scores: number[] = [];
  const details = [];

  for (const result of results) {
    const expected = Array.isArray(result.expected) ? result.expected.map(String) : [];
    const actual = Array.isArray(result.actual) ? result.actual.map(String) : [];
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const missing = expected.filter((field) => !actualSet.has(field));
    const extra = actual.filter((field) => !expectedSet.has(field));
    const matched = actual.filter((field) => expectedSet.has(field));
    tp += matched.length;
    fp += extra.length;
    fn += missing.length;
    if (expected.length === 0 && actual.length === 0) {
      fixtureF1Scores.push(1);
    } else {
      const fixturePrecision = matched.length / Math.max(1, matched.length + extra.length);
      const fixtureRecall = matched.length / Math.max(1, matched.length + missing.length);
      fixtureF1Scores.push(fixturePrecision + fixtureRecall === 0 ? 0 : (2 * fixturePrecision * fixtureRecall) / (fixturePrecision + fixtureRecall));
    }
    if (missing.length === 0 && extra.length === 0) exactCorrect += 1;
    if (!result.passed) details.push({expected, actual, missing, extra});
  }

  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const macroF1 = fixtureF1Scores.reduce((sum, value) => sum + value, 0) / Math.max(1, fixtureF1Scores.length);
  return {
    missingFieldsExactSetAccuracy: Number((exactCorrect / Math.max(1, results.length)).toFixed(3)),
    missingFieldsMicroPrecision: Number(precision.toFixed(3)),
    missingFieldsMicroRecall: Number(recall.toFixed(3)),
    missingFieldsMicroF1: Number(f1.toFixed(3)),
    missingFieldsMacroF1: Number(macroF1.toFixed(3)),
    details,
  };
}

function nextActionCategoryAccuracy(results: FieldResult[]) {
  const correct = results.filter((result) => actionCategory(result.expected) === actionCategory(result.actual)).length;
  return Number((correct / Math.max(1, results.length)).toFixed(3));
}

interface SummaryRun {
  fixture: {id: string; category?: string};
  fields: FieldResult[];
  extraction?: AiExtraction;
  similarCases?: Array<{typicalMissingFields: string[]}>;
}

function classifyScalarError(field: FieldResult['field'], expected: unknown, actual: unknown) {
  if (actual === null || actual === undefined || actual === '') return 'missing';
  if (expected === null || expected === undefined || expected === '') return 'false_positive';
  if (field === 'quoteAmount') return 'amount_mismatch';
  if (field === 'expectedDeadline') return 'date_or_context_mismatch';
  if (field === 'projectItem') return typeof actual === 'string' && typeof expected === 'string' && actual.length < expected.length ? 'too_generic' : 'wrong_project';
  if (field === 'clientName') return 'wrong_client';
  if (field === 'intent' || field === 'classification') return 'wrong_type';
  return 'mismatch';
}

function compareStringSet(field: FieldResult['field'], expected: string[], actual: string[]): FieldResult {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((item) => !actualSet.has(item));
  const extra = actual.filter((item) => !expectedSet.has(item));
  const passed = missing.length === 0 && extra.length === 0;
  return {field, passed, expected, actual, errorType: passed ? null : missing.length > 0 && extra.length > 0 ? 'missing_and_extra_fields' : missing.length > 0 ? 'missing_required_fields' : 'extra_fields'};
}

function compareScalar(field: keyof Omit<ExpectedExtraction, 'missingFields' | 'requiredMaterials'>, expected: ExpectedExtraction, actual: AiExtraction, receivedAt?: string): FieldResult {
  const expectedValue = expected[field] ?? null;
  const actualValue = actual[field];
  const passed = ['expectedDeadline', 'submissionDeadline', 'publishDeadline'].includes(field) ? normalizeDateForComparison(expectedValue, receivedAt) === normalizeDateForComparison(actualValue, receivedAt) : normalize(expectedValue) === normalize(actualValue);
  return {field, passed, expected: expectedValue, actual: actualValue, errorType: passed ? null : classifyScalarError(field, expectedValue, actualValue), receivedAt};
}

function compareMissingFields(expected: string[], actual: string[]): FieldResult {
  const normalizedExpected = normalizeMissingFields(expected);
  const normalizedActual = normalizeMissingFields(actual);
  const expectedSet = new Set(normalizedExpected);
  const actualSet = new Set(normalizedActual);
  const missing = normalizedExpected.filter((field) => !actualSet.has(field));
  const extra = normalizedActual.filter((field) => !expectedSet.has(field));
  const passed = missing.length === 0 && extra.length === 0;
  const errorType = passed ? null : missing.length > 0 && extra.length > 0 ? 'missing_and_extra_fields' : missing.length > 0 ? 'missing_required_fields' : 'extra_fields';
  return {field: 'missingFields', passed, expected: normalizedExpected, actual: normalizedActual, errorType};
}

async function runFixture(fixture: ExtractionFixture, ragEnabled: boolean) {
  const prepared = preprocessEmail(fixture.text);
  const classification = classifyPreparedMessage(prepared);
  const similarCases = ragEnabled ? await findSimilarCasesForText(prepared.cleanText) : [];
  const extraction = extractMessage({senderName: fixture.senderName, text: fixture.text, prepared, classification, similarCases, receivedAt: fixture.receivedAt ?? '2026-08-31T00:00:00+08:00'});
  const validation = validateExtraction({extraction, prepared, classification, similarCases});
  const fields: FieldResult[] = [];

  if (fixture.expectedClassification) {
    const passed = classification.type === fixture.expectedClassification;
    fields.push({field: 'classification', passed, expected: fixture.expectedClassification, actual: classification.type, errorType: passed ? null : classifyScalarError('classification', fixture.expectedClassification, classification.type)});
  }

  if (fixture.expected) {
    for (const field of scalarFields) {
      fields.push(compareScalar(field, fixture.expected, extraction, fixture.receivedAt));
    }
    fields.push(compareStringSet('requiredMaterials', fixture.expected.requiredMaterials ?? [], extraction.requiredMaterials));
    fields.push(compareMissingFields(fixture.expected.missingFields, extraction.missingFields));
  }

  return {fixture, classification, extraction, validation, similarCases, fields};
}

function makeCaseRecord(fixture: ThreadFixture): CaseRecord {
  return {
    id: `case-${fixture.id}`,
    code: '#THREAD',
    customerId: `customer-${fixture.id}`,
    customerName: fixture.existingCase.customerName,
    title: fixture.existingCase.customerName,
    platform: 'Gmail',
    status: fixture.existingCase.caseStatus,
    caseStage: 'inquiry',
    projectItem: fixture.existingCase.projectItem ?? '待釐清需求',
    quoteAmount: fixture.existingCase.quoteAmount,
    expectedDeadline: fixture.existingCase.expectedDeadline,
    submissionDeadline: fixture.existingCase.submissionDeadline,
    publishDeadline: fixture.existingCase.publishDeadline,
    nextAction: fixture.existingCase.nextAction ?? null,
    nextActionSource: fixture.existingCase.nextAction ? 'user_confirmed' : null,
    requiredMaterials: fixture.existingCase.requiredMaterials ?? [],
    providedMaterials: fixture.existingCase.providedMaterials ?? [],
    summary: fixture.existingCase.intent,
    riskLevel: fixture.existingCase.missingFields.length > 0 ? 'warning' : 'normal',
    missingFields: fixture.existingCase.missingFields,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function makeThreadMessages(fixture: ThreadFixture): MessageEvent[] {
  return fixture.messages.map((message, index) => ({
    id: `msg-${fixture.id}-${index}`,
    platform: 'Gmail',
    senderId: message.senderName,
    senderName: message.senderName,
    text: message.text,
    timestamp: new Date(index * 1000).toISOString(),
    threadId: `thread-${fixture.id}`,
    caseId: `case-${fixture.id}`,
    replyStatus: 'pending_reply',
    replyStatusUpdatedAt: new Date(index * 1000).toISOString(),
    replyStatusSource: 'system',
  }));
}

function fieldNames(value: Partial<AiExtraction>) {
  return Object.keys(value).sort();
}

function accuracyForFields(results: FieldResult[], fieldSet: Set<string>) {
  const scoped = results.filter((result) => fieldSet.has(String(result.field)));
  return {
    scoredFields: scoped.length,
    correct: scoped.filter((result) => result.passed).length,
    accuracy: Number((scoped.filter((result) => result.passed).length / Math.max(1, scoped.length)).toFixed(3)),
  };
}

function compareThreadExtraction(fixture: ThreadFixture, extraction: AiExtraction) {
  const fields: FieldResult[] = [];

  for (const field of ['clientName', 'projectItem', 'quoteAmount', 'expectedDeadline', 'submissionDeadline', 'publishDeadline', 'nextAction', 'intent'] as const) {
    fields.push(compareScalar(field, {...fixture.expected, missingFields: []}, extraction));
  }
  fields.push(compareStringSet('requiredMaterials', fixture.expected.requiredMaterials ?? [], extraction.requiredMaterials));
  return fields;
}

async function runThreadCurrentFixture(fixture: ThreadFixture, ragEnabled: boolean) {
  const current = fixture.messages[fixture.messages.length - 1];
  const analyzed = await analyzeMessage({senderName: current.senderName, text: current.text, ragEnabled});
  return {fixture, extraction: analyzed.extraction, similarCases: analyzed.similarCases, fields: compareThreadExtraction(fixture, analyzed.extraction)};
}

async function runThreadFixture(fixture: ThreadFixture, ragEnabled = true) {
  const current = fixture.messages[fixture.messages.length - 1];
  const {result} = await analyzeThreadAwareMessage({
    senderName: current.senderName,
    text: current.text,
    threadMessages: makeThreadMessages(fixture),
    existingCase: makeCaseRecord(fixture),
    ragEnabled,
  });
  const fields: FieldResult[] = compareThreadExtraction(fixture, result.extraction);
  fields.push(compareStringSet('inheritedFields', fixture.expected.inheritedFields, fieldNames(result.inheritedFields)));
  fields.push(compareStringSet('changedFields', fixture.expected.changedFields, fieldNames(result.changedFields)));
  fields.push(compareStringSet('conflictingFields', fixture.expected.conflictingFields, result.conflictingFields.map((field) => field.field).sort()));
  fields.push({field: 'needsHumanReview', passed: result.needsHumanReview === fixture.expected.needsHumanReview, expected: fixture.expected.needsHumanReview, actual: result.needsHumanReview, errorType: result.needsHumanReview === fixture.expected.needsHumanReview ? null : 'human_review_mismatch'});

  return {fixture, result, fields};
}

function summarize(runs: SummaryRun[], options: {dataset: DatasetName; ragMode: RagMode; pairedRuns?: SummaryRun[]}): {
  totalFixtures: number;
  scoredFields: number;
  fullOverall: {scoredFields: number; correct: number; accuracy: number};
  legacyCoreOverall: {scoredFields: number; correct: number; accuracy: number};
  extendedOverall: {scoredFields: number; correct: number; accuracy: number};
  overallAccuracy: number;
  fieldAccuracy: Record<string, number>;
  errors: Array<{fixture: string; category?: string; field: string; expected: unknown; actual: unknown; errorType: string | null}>;
  detailedErrors: DetailedError[];
  fieldMetrics: Record<string, ReturnType<typeof scalarMetricRecord> | ReturnType<typeof setMetricRecord>>;
  nextActionExactAccuracy: number;
  nextActionCategoryAccuracy: number;
  missingFieldsMetrics: ReturnType<typeof missingFieldsMetrics>;
} {
  const allFields = runs.flatMap((run) => run.fields);
  const byField = new Map<string, {passed: number; total: number}>();
  const errors = [];
  const detailedErrors: DetailedError[] = [];
  const pairedPass = new Map<string, boolean>();
  for (const paired of options.pairedRuns ?? []) {
    for (const result of paired.fields) pairedPass.set(`${paired.fixture.id}:${result.field}`, result.passed);
  }

  for (const run of runs) {
    for (const result of run.fields) {
      const summary = byField.get(result.field) ?? {passed: 0, total: 0};
      summary.total += 1;
      if (result.passed) summary.passed += 1;
      byField.set(result.field, summary);

      if (!result.passed) {
        errors.push({fixture: run.fixture.id, category: run.fixture.category, field: result.field, expected: result.expected, actual: result.actual, errorType: result.errorType});
        const diff = setDiff(result.expected, result.actual);
        const pairedPassed = pairedPass.get(`${run.fixture.id}:${result.field}`) === true;
        detailedErrors.push({
          fixtureId: run.fixture.id,
          dataset: options.dataset,
          field: String(result.field),
          expected: result.expected,
          actual: result.actual,
          ragMode: options.ragMode,
          errorType: normalizedErrorType(result, pairedPassed && options.ragMode === 'rag_on'),
          possibleCause: possibleCause(result, run as Awaited<ReturnType<typeof runFixture>>, options.dataset, options.ragMode, pairedPassed && options.ragMode === 'rag_on'),
          ...diff,
          actualFieldSources: result.field === 'missingFields' ? sourceMissingFields(run, options.ragMode === 'rag_on') : undefined,
        });
      }
    }
  }
  const fieldMetrics = Object.fromEntries(reportedFields.map((field) => {
    const results = allFields.filter((result) => result.field === field);
    return [field, field === 'missingFields' || field === 'requiredMaterials' ? setMetricRecord(results) : scalarMetricRecord(results)];
  }));
  const nextActionResults = allFields.filter((result) => result.field === 'nextAction');
  const missingResults = allFields.filter((result) => result.field === 'missingFields');
  const fullOverall = accuracyForFields(allFields, new Set(allFields.map((result) => String(result.field))));

  return {
    totalFixtures: runs.length,
    scoredFields: allFields.length,
    fullOverall,
    legacyCoreOverall: accuracyForFields(allFields, legacyCoreFields),
    extendedOverall: accuracyForFields(allFields, extendedFields),
    overallAccuracy: fullOverall.accuracy,
    fieldAccuracy: Object.fromEntries(Array.from(byField.entries()).map(([field, value]) => [field, Number((value.passed / value.total).toFixed(3))])),
    errors,
    detailedErrors,
    fieldMetrics,
    nextActionExactAccuracy: nextActionResults.length === 0 ? 1 : Number((nextActionResults.filter((result) => result.passed).length / nextActionResults.length).toFixed(3)),
    nextActionCategoryAccuracy: nextActionCategoryAccuracy(nextActionResults),
    missingFieldsMetrics: missingFieldsMetrics(missingResults),
  };
}

function compareRag(before: ReturnType<typeof summarize>, after: ReturnType<typeof summarize>) {
  return {
    overallDelta: Number((after.overallAccuracy - before.overallAccuracy).toFixed(3)),
    fieldDelta: Object.fromEntries(Object.entries(after.fieldAccuracy).map(([field, value]) => [field, Number((value - (before.fieldAccuracy[field] ?? 0)).toFixed(3))])),
  };
}

async function runExtractionDataset(path: string) {
  const fixtures = JSON.parse(await readFile(path, 'utf8')) as ExtractionFixture[];
  const ragOffRuns = [];
  const ragOnRuns = [];
  for (const fixture of fixtures) {
    ragOffRuns.push(await runFixture(fixture, false));
    ragOnRuns.push(await runFixture(fixture, true));
  }
  const ragOff = summarize(ragOffRuns, {dataset: path === developmentFixturePath ? 'development' : 'holdout', ragMode: 'rag_off'});
  const ragOn = summarize(ragOnRuns, {dataset: path === developmentFixturePath ? 'development' : 'holdout', ragMode: 'rag_on', pairedRuns: ragOffRuns});
  return {
    fixtureCount: fixtures.length,
    ragOff,
    ragOn,
    ragBeforeAfter: compareRag(ragOff, ragOn),
    lowConfidence: ragOnRuns
      .filter((run) => run.validation.confidence < 0.75 || run.validation.warnings.length > 0)
      .map((run) => ({fixture: run.fixture.id, confidence: run.validation.confidence, warnings: run.validation.warnings, needsHumanReview: run.validation.confidence < 0.75})),
  };
}

async function runThreadDataset() {
  const fixtures = JSON.parse(await readFile(threadFixturePath, 'utf8')) as ThreadFixture[];
  const currentRagOffRuns = [];
  const currentRagOnRuns = [];
  const contextRagOffRuns = [];
  const contextRagOnRuns = [];
  for (const fixture of fixtures) {
    currentRagOffRuns.push(await runThreadCurrentFixture(fixture, false));
    currentRagOnRuns.push(await runThreadCurrentFixture(fixture, true));
    contextRagOffRuns.push(await runThreadFixture(fixture, false));
    contextRagOnRuns.push(await runThreadFixture(fixture, true));
  }
  const currentOnlyRagOff = summarize(currentRagOffRuns, {dataset: 'thread', ragMode: 'thread_current_rag_off'});
  const currentOnlyRagOn = summarize(currentRagOnRuns, {dataset: 'thread', ragMode: 'thread_current_rag_on', pairedRuns: currentRagOffRuns});
  const threadContextRagOff = summarize(contextRagOffRuns, {dataset: 'thread', ragMode: 'thread_context_rag_off'});
  const threadContextRagOn = summarize(contextRagOnRuns, {dataset: 'thread', ragMode: 'thread_context_rag_on', pairedRuns: contextRagOffRuns});
  return {
    fixtureCount: fixtures.length,
    currentOnlyRagOff,
    currentOnlyRagOn,
    threadContextRagOff,
    threadContextRagOn,
    currentRagBeforeAfter: compareRag(currentOnlyRagOff, currentOnlyRagOn),
    threadContextBeforeAfter: compareRag(threadContextRagOff, threadContextRagOn),
    threadContextGainOverCurrent: compareRag(currentOnlyRagOn, threadContextRagOn),
    ...threadContextRagOn,
    needsHumanReviewCount: contextRagOnRuns.filter((run) => run.result.needsHumanReview).length,
    conflicts: contextRagOnRuns.flatMap((run) => run.result.conflictingFields.map((field) => ({fixture: run.fixture.id, ...field}))),
  };
}

function errorOverview(results: Array<{ragOff?: {detailedErrors: DetailedError[]}; ragOn?: {detailedErrors: DetailedError[]}; detailedErrors?: DetailedError[]}>) {
  const errors = results.flatMap((result) => [...(result.ragOff?.detailedErrors ?? []), ...(result.ragOn?.detailedErrors ?? []), ...(result.detailedErrors ?? [])]);
  const byType = new Map<string, number>();
  const byCause = new Map<string, number>();
  for (const error of errors) {
    byType.set(error.errorType, (byType.get(error.errorType) ?? 0) + 1);
    byCause.set(error.possibleCause, (byCause.get(error.possibleCause) ?? 0) + 1);
  }
  const top = (map: Map<string, number>) => Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, count]) => ({label, count}));
  return {totalErrors: errors.length, topErrorTypes: top(byType), topPossibleCauses: top(byCause)};
}

async function main() {
  const development = await runExtractionDataset(developmentFixturePath);
  const holdout = await runExtractionDataset(holdoutFixturePath);
  const thread = await runThreadDataset();
  console.log(JSON.stringify({
    ok: true,
    comparability: {
      previousDevelopmentFixtures: 20,
      currentDevelopmentFixtures: development.fixtureCount,
      previousDevelopmentScoredFields: 100,
      currentDevelopmentScoredFields: development.ragOn.scoredFields,
      previousHoldoutFixtures: 5,
      currentHoldoutFixtures: holdout.fixtureCount,
      previousHoldoutScoredFields: 25,
      currentHoldoutScoredFields: holdout.ragOn.scoredFields,
      directlyComparableWithPreviousOverallAccuracy: false,
      reason: 'Day 9-2B-2 added scored fields for submissionDeadline, publishDeadline, nextAction, and requiredMaterials and expanded development/thread fixtures, so the denominator and task difficulty changed.',
    },
    errorOverview: errorOverview([development, holdout, {detailedErrors: thread.threadContextRagOn.detailedErrors}]),
    development,
    holdout,
    thread,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
