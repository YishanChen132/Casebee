import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {preprocessEmail} from '../services/emailPreprocessor.js';
import {classifyPreparedMessage, type MessageType} from '../services/messageClassifier.js';

interface ClassificationFixture {
  id: string;
  category: string;
  senderName: string;
  text: string;
  expectedClassification: MessageType;
}

const fixturePath = fileURLToPath(new URL('../fixtures/classification/p4-classification-fixtures.json', import.meta.url));

async function main() {
  const fixtures = JSON.parse(await readFile(fixturePath, 'utf8')) as ClassificationFixture[];
  const results = fixtures.map((fixture) => {
    const prepared = preprocessEmail(fixture.text);
    const classification = classifyPreparedMessage(prepared);
    return {
      fixture: fixture.id,
      category: fixture.category,
      expected: fixture.expectedClassification,
      actual: classification.type,
      confidence: classification.confidence,
      reasons: classification.reasons,
      passed: classification.type === fixture.expectedClassification,
    };
  });

  const errors = results.filter((result) => !result.passed);
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
    byType,
    errors,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

void main();
