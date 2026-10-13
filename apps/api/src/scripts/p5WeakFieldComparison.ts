import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {normalizeMissingFields} from '@casebee/shared';
import type {AiExtraction} from '@casebee/shared';
import {preprocessEmail} from '../services/emailPreprocessor.js';
import {extractMessage} from '../services/extractionService.js';
import {classifyPreparedMessage} from '../services/messageClassifier.js';

type ExpectedExtraction = Pick<AiExtraction, 'intent' | 'nextAction' | 'missingFields'>;
type ExtractionProfile = 'legacy' | 'p5_event_decision';

interface Fixture {
  id: string;
  category: string;
  senderName: string;
  text: string;
  receivedAt?: string;
  expected: ExpectedExtraction | null;
}

const datasets = [
  {name: 'development', path: fileURLToPath(new URL('../fixtures/extraction/accuracy-fixtures.json', import.meta.url))},
  {name: 'holdout', path: fileURLToPath(new URL('../fixtures/extraction/holdout-fixtures.json', import.meta.url))},
] as const;

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

function actionCategory(value: unknown) {
  if (value === null || value === undefined || value === '') return 'no_action';
  return actionCategoryMap[String(value).replace(/\s+/g, '').trim()] ?? `unmapped:${String(value).replace(/\s+/g, '').trim()}`;
}

function sameMissingFields(expected: string[], actual: string[]) {
  return normalizeMissingFields(expected).join('\u0000') === normalizeMissingFields(actual).join('\u0000');
}

function runVariant(fixtures: Fixture[], profile: ExtractionProfile) {
  const scored = fixtures.filter((fixture) => fixture.expected);
  const errors = [];
  let intentCorrect = 0;
  let nextActionExactCorrect = 0;
  let nextActionCategoryCorrect = 0;
  let missingFieldsExactCorrect = 0;

  for (const fixture of scored) {
    const prepared = preprocessEmail(fixture.text);
    const classification = classifyPreparedMessage(prepared);
    const extraction = extractMessage({
      senderName: fixture.senderName,
      text: fixture.text,
      prepared,
      classification,
      receivedAt: fixture.receivedAt ?? '2026-08-31T00:00:00+08:00',
      profile,
    });
    const expected = fixture.expected as ExpectedExtraction;
    const intentPassed = (expected.intent ?? null) === (extraction.intent ?? null);
    const nextActionPassed = (expected.nextAction ?? null) === (extraction.nextAction ?? null);
    const nextActionCategoryPassed = actionCategory(expected.nextAction) === actionCategory(extraction.nextAction);
    const missingFieldsPassed = sameMissingFields(expected.missingFields, extraction.missingFields);

    if (intentPassed) intentCorrect += 1;
    if (nextActionPassed) nextActionExactCorrect += 1;
    if (nextActionCategoryPassed) nextActionCategoryCorrect += 1;
    if (missingFieldsPassed) missingFieldsExactCorrect += 1;

    if (!intentPassed || !nextActionPassed || !missingFieldsPassed) {
      errors.push({
        fixture: fixture.id,
        category: fixture.category,
        intent: intentPassed ? undefined : {expected: expected.intent ?? null, actual: extraction.intent ?? null},
        nextAction: nextActionPassed ? undefined : {expected: expected.nextAction ?? null, actual: extraction.nextAction ?? null},
        missingFields: missingFieldsPassed ? undefined : {expected: normalizeMissingFields(expected.missingFields), actual: normalizeMissingFields(extraction.missingFields)},
      });
    }
  }

  const total = scored.length;
  const accuracy = (value: number) => Number((value / Math.max(1, total)).toFixed(3));
  return {
    profile,
    fixtures: total,
    weakFieldAverage: Number(((intentCorrect + nextActionExactCorrect + missingFieldsExactCorrect) / Math.max(1, total * 3)).toFixed(3)),
    intentAccuracy: accuracy(intentCorrect),
    nextActionExactAccuracy: accuracy(nextActionExactCorrect),
    nextActionCategoryAccuracy: accuracy(nextActionCategoryCorrect),
    missingFieldsExactSetAccuracy: accuracy(missingFieldsExactCorrect),
    errors,
  };
}

function delta(before: ReturnType<typeof runVariant>, after: ReturnType<typeof runVariant>) {
  return {
    weakFieldAverage: Number((after.weakFieldAverage - before.weakFieldAverage).toFixed(3)),
    intentAccuracy: Number((after.intentAccuracy - before.intentAccuracy).toFixed(3)),
    nextActionExactAccuracy: Number((after.nextActionExactAccuracy - before.nextActionExactAccuracy).toFixed(3)),
    nextActionCategoryAccuracy: Number((after.nextActionCategoryAccuracy - before.nextActionCategoryAccuracy).toFixed(3)),
    missingFieldsExactSetAccuracy: Number((after.missingFieldsExactSetAccuracy - before.missingFieldsExactSetAccuracy).toFixed(3)),
  };
}

async function main() {
  const results = [];
  for (const dataset of datasets) {
    const fixtures = JSON.parse(await readFile(dataset.path, 'utf8')) as Fixture[];
    const currentPipeline = runVariant(fixtures, 'legacy');
    const p5EventDecision = runVariant(fixtures, 'p5_event_decision');
    results.push({
      dataset: dataset.name,
      A_currentPipeline: currentPipeline,
      B_p5EventDecision: p5EventDecision,
      B_minus_A: delta(currentPipeline, p5EventDecision),
      C_langChain: {
        status: 'not_configured',
        reason: 'No LangChain dependency or chain implementation is present; keep C explicit instead of silently rewrapping the same pipeline.',
      },
    });
  }

  console.log(JSON.stringify({ok: true, modelCallsAdded: 0, results}, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
