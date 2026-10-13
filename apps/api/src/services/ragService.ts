import type {AiExtraction, RagExample} from '@casebee/shared';
import {findActiveRagExamples} from '../repositories/ragExamplesRepository.js';

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[\s,，。！？、/＋+｜|:：()（）-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function totalScore(breakdown: Record<string, number>) {
  return Object.values(breakdown).reduce((sum, value) => sum + value, 0);
}

function scoreExample(extraction: AiExtraction, example: RagExample) {
  const breakdown: Record<string, number> = {};
  const queryTokens = new Set(tokenize([extraction.projectItem, extraction.intent, extraction.summary].filter(Boolean).join(' ')));
  const exampleTokens = tokenize([example.title, example.projectItem, example.outcome, example.summary, example.caseType ?? '', ...example.projectAliases].join(' '));

  if (extraction.projectItem && example.projectItem.includes(extraction.projectItem)) {
    breakdown.projectExact = 60;
  }
  if (extraction.intent && example.caseType && extraction.intent.includes('合作') && example.caseType === 'collaboration_invite') breakdown.caseType = 18;
  if (extraction.projectItem && example.projectAliases.some((alias) => extraction.projectItem?.includes(alias) || alias.includes(extraction.projectItem ?? ''))) breakdown.alias = 32;
  if (extraction.projectItem && extraction.projectItem.includes(example.projectItem)) {
    breakdown.projectContains = 45;
  }
  if (extraction.quoteAmount && example.quoteAmount) {
    const distance = Math.abs(extraction.quoteAmount - example.quoteAmount) / Math.max(extraction.quoteAmount, example.quoteAmount);
    breakdown.amountProximity = Math.max(0, 20 - Math.round(distance * 20));
  }

  const overlap = exampleTokens.filter((token) => queryTokens.has(token)).length;
  breakdown.tokenOverlap = Math.min(20, overlap * 4);

  return {score: totalScore(breakdown), breakdown};
}

function scoreExampleForText(text: string, example: RagExample) {
  const breakdown: Record<string, number> = {};
  const queryTokens = new Set(tokenize(text));
  const exampleTokens = tokenize([example.title, example.projectItem, example.outcome, example.summary, example.replyExample].join(' '));
  const normalizedText = text.toLowerCase();
  const exampleText = [example.title, example.projectItem, example.summary, example.replyExample, example.caseType ?? '', ...example.projectAliases].join(' ').toLowerCase();

  if (text.includes(example.projectItem)) {
    breakdown.projectExact = 50;
  }
  let aliasScore = 0;
  for (const alias of example.projectAliases) {
    if (alias && normalizedText.includes(alias.toLowerCase())) aliasScore += 28;
  }
  if (aliasScore > 0) breakdown.alias = aliasScore;
  if (/(影片|短影音|宣傳影片|reels)/i.test(normalizedText) && /(影片|短影音|reels)/i.test(example.projectItem)) {
    breakdown.mediaPhrase = 34;
  }
  if (/(網站|官網|網頁)/i.test(normalizedText) && /(網站|官網|網頁)/i.test(example.projectItem)) {
    breakdown.websitePhrase = 34;
  }

  let tokenScore = 0;
  for (const token of exampleTokens) {
    if (queryTokens.has(token)) {
      tokenScore += 4;
    }
  }
  if (tokenScore > 0) breakdown.tokenOverlap = tokenScore;

  const phraseGroups = [
    ['reels', '短影音', '影片', '限動', '宣傳影片'],
    ['網站', '官網', '網頁', 'landing page'],
    ['logo', '品牌識別', '名片'],
    ['貼文', '社群', 'instagram'],
    ['產品攝影', '攝影', '拍攝', '修圖'],
    ['品牌合作', '合作邀請', '合作形式'],
  ];

  let phraseScore = 0;
  for (const group of phraseGroups) {
    if (group.some((term) => normalizedText.includes(term)) && group.some((term) => exampleText.includes(term))) {
      phraseScore += 18;
    }
  }
  if (phraseScore > 0) breakdown.phraseGroup = phraseScore;

  const score = Math.min(100, totalScore(breakdown));
  return {score, breakdown};
}

export async function findSimilarCases(extraction: AiExtraction, limit = 3) {
  const examples = await findActiveRagExamples();
  return examples
    .map((example) => {
      const scored = scoreExample(extraction, example);
      return {...example, score: scored.score, scoreBreakdown: scored.breakdown};
    })
    .filter((example) => example.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function findSimilarCasesForText(text: string, limit = 3) {
  const examples = await findActiveRagExamples();
  return examples
    .map((example) => {
      const scored = scoreExampleForText(text, example);
      return {...example, score: scored.score, scoreBreakdown: scored.breakdown};
    })
    .filter((example) => example.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
