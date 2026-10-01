import type {AiExtraction, RagExample} from '@casebee/shared';
import {findActiveRagExamples} from '../repositories/ragExamplesRepository.js';

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[\s,，。！？、/＋+｜|:：()（）-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreExample(extraction: AiExtraction, example: RagExample) {
  let score = 0;
  const queryTokens = new Set(tokenize([extraction.projectItem, extraction.intent, extraction.summary].filter(Boolean).join(' ')));
  const exampleTokens = tokenize([example.title, example.projectItem, example.outcome, example.summary, example.caseType ?? '', ...example.projectAliases].join(' '));

  if (extraction.projectItem && example.projectItem.includes(extraction.projectItem)) {
    score += 60;
  }
  if (extraction.intent && example.caseType && extraction.intent.includes('合作') && example.caseType === 'collaboration_invite') score += 18;
  if (extraction.projectItem && example.projectAliases.some((alias) => extraction.projectItem?.includes(alias) || alias.includes(extraction.projectItem ?? ''))) score += 32;
  if (extraction.projectItem && extraction.projectItem.includes(example.projectItem)) {
    score += 45;
  }
  if (extraction.quoteAmount && example.quoteAmount) {
    const distance = Math.abs(extraction.quoteAmount - example.quoteAmount) / Math.max(extraction.quoteAmount, example.quoteAmount);
    score += Math.max(0, 20 - Math.round(distance * 20));
  }

  const overlap = exampleTokens.filter((token) => queryTokens.has(token)).length;
  score += Math.min(20, overlap * 4);

  return score;
}

function scoreExampleForText(text: string, example: RagExample) {
  let score = 0;
  const queryTokens = new Set(tokenize(text));
  const exampleTokens = tokenize([example.title, example.projectItem, example.outcome, example.summary, example.replyExample].join(' '));
  const normalizedText = text.toLowerCase();
  const exampleText = [example.title, example.projectItem, example.summary, example.replyExample, example.caseType ?? '', ...example.projectAliases].join(' ').toLowerCase();

  if (text.includes(example.projectItem)) {
    score += 50;
  }
  for (const alias of example.projectAliases) {
    if (alias && normalizedText.includes(alias.toLowerCase())) score += 28;
  }
  if (/(影片|短影音|宣傳影片|reels)/i.test(normalizedText) && /(影片|短影音|reels)/i.test(example.projectItem)) {
    score += 34;
  }
  if (/(網站|官網|網頁)/i.test(normalizedText) && /(網站|官網|網頁)/i.test(example.projectItem)) {
    score += 34;
  }

  for (const token of exampleTokens) {
    if (queryTokens.has(token)) {
      score += 4;
    }
  }

  const phraseGroups = [
    ['reels', '短影音', '影片', '限動', '宣傳影片'],
    ['網站', '官網', '網頁', 'landing page'],
    ['logo', '品牌識別', '名片'],
    ['貼文', '社群', 'instagram'],
    ['產品攝影', '攝影', '拍攝', '修圖'],
    ['品牌合作', '合作邀請', '合作形式'],
  ];

  for (const group of phraseGroups) {
    if (group.some((term) => normalizedText.includes(term)) && group.some((term) => exampleText.includes(term))) {
      score += 18;
    }
  }

  return Math.min(100, score);
}

export async function findSimilarCases(extraction: AiExtraction, limit = 3) {
  const examples = await findActiveRagExamples();
  return examples
    .map((example) => ({...example, score: scoreExample(extraction, example)}))
    .filter((example) => example.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function findSimilarCasesForText(text: string, limit = 3) {
  const examples = await findActiveRagExamples();
  return examples
    .map((example) => ({...example, score: scoreExampleForText(text, example)}))
    .filter((example) => example.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
