import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {preprocessEmail} from '../services/emailPreprocessor.js';
import {classifyPreparedMessage, type MessageType} from '../services/messageClassifier.js';

type ClassificationBucket = 'NON_CASE' | 'CASE_RELATED' | 'UNCERTAIN';

interface ClassificationFixture {
  id: string;
  category: string;
  senderName: string;
  text: string;
  expectedBucket: ClassificationBucket;
  expectedClassification: MessageType;
}

const fixturePath = fileURLToPath(new URL('../fixtures/classification/p4-classification-fixtures.json', import.meta.url));

const nonCaseTypes = new Set<MessageType>(['announcement', 'calendar_invite', 'newsletter', 'system_notification']);
const caseRelatedTypes = new Set<MessageType>(['collaboration_invite', 'quote_inquiry', 'revision_request', 'deadline_or_material_risk', 'confirmation_or_contract']);

function bucketFor(type: MessageType): ClassificationBucket {
  if (nonCaseTypes.has(type)) return 'NON_CASE';
  if (caseRelatedTypes.has(type)) return 'CASE_RELATED';
  return 'UNCERTAIN';
}

async function main() {
  const fixtures = JSON.parse(await readFile(fixturePath, 'utf8')) as ClassificationFixture[];
  const results = fixtures.map((fixture) => {
    const prepared = preprocessEmail(fixture.text);
    const classification = classifyPreparedMessage(prepared);
    const actualBucket = bucketFor(classification.type);
    return {
      fixture: fixture.id,
      category: fixture.category,
      expectedBucket: fixture.expectedBucket,
      actualBucket,
      expected: fixture.expectedClassification,
      actual: classification.type,
      confidence: classification.confidence,
      reasons: classification.reasons,
      bucketPassed: actualBucket === fixture.expectedBucket,
      typePassed: classification.type === fixture.expectedClassification,
      passed: actualBucket === fixture.expectedBucket && classification.type === fixture.expectedClassification,
    };
  });

  const errors = results.filter((result) => !result.passed);
  const bucketErrors = results.filter((result) => !result.bucketPassed);
  const nonCaseResults = results.filter((result) => result.expectedBucket === 'NON_CASE');
  const caseResults = results.filter((result) => result.expectedBucket === 'CASE_RELATED');
  const ambiguousResults = results.filter((result) => result.expectedBucket === 'UNCERTAIN');
  const byType = Object.fromEntries(
    Array.from(new Set(fixtures.map((fixture) => fixture.expectedClassification))).map((type) => {
      const scoped = results.filter((result) => result.expected === type);
      return [type, {total: scoped.length, correct: scoped.filter((result) => result.passed).length}];
    }),
  );

  const summary = {
    ok: errors.length === 0,
    totalFixtures: fixtures.length,
    correct: results.length - errors.length,
    accuracy: Number(((results.length - errors.length) / Math.max(1, results.length)).toFixed(3)),
    bucketAccuracy: Number(((results.length - bucketErrors.length) / Math.max(1, results.length)).toFixed(3)),
    nonCaseFalseCaseRate: Number((nonCaseResults.filter((result) => result.actualBucket === 'CASE_RELATED').length / Math.max(1, nonCaseResults.length)).toFixed(3)),
    caseRelatedMissRate: Number((caseResults.filter((result) => result.actualBucket !== 'CASE_RELATED').length / Math.max(1, caseResults.length)).toFixed(3)),
    uncertainOverCreateRate: Number((ambiguousResults.filter((result) => result.actualBucket === 'CASE_RELATED').length / Math.max(1, ambiguousResults.length)).toFixed(3)),
    byType,
    bucketErrors,
    errors,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

void main();
