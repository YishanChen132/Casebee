import {normalizeMissingFields} from '@casebee/shared';
import type {AiExtraction, CaseStatus, RagExample} from '@casebee/shared';
import {inferCustomerName} from './customerNameInference.js';
import type {MessageClassification} from './messageClassifier.js';
import type {PreprocessedEmail} from './emailPreprocessor.js';

const projectKeywords = [
  'Instagram Reels',
  'Reels 影片',
  'Instagram 限時動態',
  'IG 貼文設計',
  'IG 貼文',
  '社群貼文',
  'landing page',
  '官網設計',
  '網站重新設計',
  'Reels',
  '短影音宣傳合作',
  '短影音',
  '產品宣傳影片',
  '品牌合作',
  '包裝設計',
  'Logo + 名片設計',
  'Logo',
  '名片',
  '網站',
  '貼文',
  '影片',
  'Banner',
  '產品攝影',
  '社群貼文',
  '簡報設計',
  'DM 設計',
];

const projectNormalization: Record<string, string> = {
  'landing page': '網站重新設計',
  'IG 貼文': 'IG 貼文設計',
};

const missingFieldLabels: Record<string, string> = {
  project_item: '專案項目',
  quote_amount: '預算/報價金額',
  expected_deadline: '預期到期時間',
  usage_rights: '授權期間與使用範圍',
  revision_scope: '修改/審稿範圍',
  deliverables: '交付項目',
  reference: '參考素材',
  scope: '合作範圍',
  contract: '合約/付款節點',
  materials: '素材提供時間',
  required_materials: '必要素材',
  submission_deadline: '交稿期限',
  publish_deadline: '發布/上線期限',
  next_action: '下一步',
};

const materialNames = ['品牌 Logo', 'Logo', '產品圖片', '商品連結', '活動連結', 'brief', '文案', '樣品', '參考素材'];
type ExtractionProfile = 'legacy' | 'p5_event_decision';

const datePattern = '(今天|明天|後天|這週五|本週五|下週五|下週|本週|\\d{1,2}\\s*月(?:底|中)|月底|月中|\\d{4}\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日|\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日|\\d{1,2}\\/\\d{1,2})';

function normalizeText(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function extractSubject(text: string) {
  const normalized = normalizeText(text).trim();
  const match = normalized.match(/^Subject:\s*(.+?)(?:\n\n|$)/i);
  return match?.[1]?.trim() ?? '';
}

function stripMailSubject(text: string) {
  const normalized = normalizeText(text).trim();
  if (!/^Subject:\s*/i.test(normalized)) {
    return normalized;
  }

  const separatorIndex = normalized.indexOf('\n\n');
  return separatorIndex === -1 ? '' : normalized.slice(separatorIndex).trim();
}

function compactText(text: string) {
  return normalizeText(text).replace(/\s+/g, ' ').trim();
}

function taipeiDate(receivedAt?: string) {
  const base = receivedAt ? new Date(receivedAt) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(base);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

function formatMonthDay(date: Date) {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function normalizeDateToken(token: string, receivedAt?: string) {
  const compact = token.replace(/\s+/g, '');
  const base = taipeiDate(receivedAt);
  const addDays = (days: number) => {
    const next = new Date(base);
    next.setUTCDate(next.getUTCDate() + days);
    return formatMonthDay(next);
  };
  if (compact === '今天') return addDays(0);
  if (compact === '明天') return addDays(1);
  if (compact === '後天') return addDays(2);
  if (compact === '這週五' || compact === '本週五') return addDays((5 - base.getUTCDay() + 7) % 7);
  if (compact === '下週五') return addDays(((5 - base.getUTCDay() + 7) % 7) + 7);
  if (compact === '本週') return addDays(Math.max(0, 5 - base.getUTCDay()));
  if (compact === '下週') return addDays(((1 - base.getUTCDay() + 7) % 7) + 7);
  const monthPart = compact.match(/^(\d{1,2})月(?:底|中)$/);
  if (monthPart?.[1]) return compact.endsWith('月底') ? `${Number(monthPart[1])}/31` : `${Number(monthPart[1])}/15`;
  if (compact === '月底') return `${base.getUTCMonth() + 1}/31`;
  if (compact === '月中') return `${base.getUTCMonth() + 1}/15`;
  const full = compact.match(/^(?:\d{4}年)?(\d{1,2})月(\d{1,2})日$/);
  if (full?.[1] && full[2]) return `${Number(full[1])}/${Number(full[2])}`;
  const slash = compact.match(/^(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/);
  if (slash?.[1] && slash[2]) return `${Number(slash[1])}/${Number(slash[2])}`;
  return token;
}

function findLabeledValue(text: string, labels: string[]) {
  const normalized = normalizeText(text);
  for (const label of labels) {
    const pattern = new RegExp(`${label}[：:\\s]*([^\\n，,。；;]+)`, 'i');
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function parseAmountValue(raw: string) {
  const match = raw.match(/([0-9][0-9,]*(?:\.\d+)?)\s*(萬|元|塊|k|K)?/);
  if (!match?.[1]) {
    return null;
  }

  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) {
    return null;
  }

  const unit = match[2];
  if (unit === '萬') {
    return Math.round(value * 10000);
  }
  if (unit === 'k' || unit === 'K') {
    return Math.round(value * 1000);
  }
  return Math.round(value);
}

function extractAmount(text: string) {
  const labeled = findLabeledValue(text, ['預算', '報價', '費用', '酬勞', '稿費', '合作金額', '授權費用', '未稅報價', '含稅報價']);
  if (labeled) {
    const amount = parseAmountValue(labeled);
    if (amount && amount >= 1000) {
      return amount;
    }
  }

  const contextualMatch = text.match(/(?:預算|報價|費用|酬勞|稿費|合作金額|授權費用|未稅報價|含稅報價|NT\$|\$)[^0-9]{0,16}([0-9][0-9,]*(?:\.\d+)?\s*(?:萬|元|塊|k|K)?)/);
  const amount = contextualMatch?.[1] ? parseAmountValue(contextualMatch[1]) : null;
  return amount && amount >= 1000 ? amount : null;
}

function extractProjectItem(text: string) {
  const labeled = findLabeledValue(text, ['合作形式', '需求項目', '專案項目', '製作項目', '服務項目', '委託內容', '工作內容']);
  if (labeled) {
    const keyword = projectKeywords.find((item) => labeled.includes(item));
    return keyword ? (projectNormalization[keyword] ?? keyword) : labeled.replace(/一支|一篇|一張|一組|乙式/g, '').trim();
  }

  const subject = extractSubject(text);
  const source = `${subject}\n${text}`;
  if (/拍攝商品|商品[^。；;\n]{0,12}拍攝/.test(source)) return '產品攝影';
  const keyword = projectKeywords.find((item) => source.toLowerCase().includes(item.toLowerCase()));
  return keyword ? (projectNormalization[keyword] ?? keyword) : null;
}

function mergeMissingFields(input: {baseFields: string[]; projectItem: string | null; quoteAmount: number | null; expectedDeadline: string | null; intent: string; sourceText: string; profile: ExtractionProfile}) {
  if (input.intent === '確認合作' || input.intent === '取消合作' || input.intent === '完成結案') {
    return input.intent === '取消合作' || input.intent === '完成結案' ? [] : input.baseFields;
  }

  // P2 guardrail: missing fields are derived from current-message schema rules only.
  // Similar cases may guide replies, but must not create current-case facts.
  const fields = new Set<string>(input.baseFields);
  if (input.intent === '合作邀請') {
    if (!input.projectItem || input.projectItem === '品牌合作') fields.add('project_item');
    fields.add('deliverables');
    fields.add('usage_rights');
    if (input.profile === 'legacy' || (input.projectItem && input.projectItem !== '品牌合作')) fields.add('revision_scope');
  }
  if (input.intent === '詢價' && /網站|官網|landing page/i.test(input.sourceText)) {
    fields.add('scope');
    fields.add('contract');
  }
  if (input.profile === 'p5_event_decision') {
    if ((input.intent === '詢價' || input.intent === '修改需求') && /改成\s*\d+\s*張|(?:社群貼文|IG 貼文|貼文)[^。；;\n]*(?:風格|參考|範圍|追加)/.test(input.sourceText)) fields.add('scope');
    if (input.intent === '詢價' && /Logo.*名片|名片.*Logo|新品牌.*Logo/.test(input.sourceText)) fields.add('reference');
    if (input.intent === '詢價' && /產品攝影|攝影.*修圖/.test(input.sourceText)) fields.add('revision_scope');
    if (input.intent === '交期風險') {
      fields.add('materials');
      fields.add('revision_scope');
    }
    if (input.intent === '一般訊息' && /授權|使用範圍|使用\s*\d+\s*個月/.test(input.sourceText)) {
      fields.add('deliverables');
      fields.add('revision_scope');
    }
  }
  return normalizeMissingFields(Array.from(fields));
}

function extractDeadline(text: string, receivedAt?: string) {
  const datePattern = '(今天|明天|後天|這週五|本週五|下週五|下週|本週|\\d{1,2}\\s*月(?:底|中)|月底|月中|\\d{4}\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日|\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日|\\d{1,2}\\/\\d{1,2})';
  const deadlineContext = text.match(new RegExp(`${datePattern}[^。；;，,\\n]{0,12}(?:交件|完成|上線|截止|交付|完稿)`));
  if (deadlineContext?.[1]) {
    return normalizeDateToken(deadlineContext[1], receivedAt);
  }

  const labeled = findLabeledValue(text, ['預計上線時間', '上線時間', '交件時間', '完成時間', '截止時間', '期限', '交期', 'deadline']);
  if (labeled) {
    const labeledDate = labeled.match(new RegExp(datePattern))?.[1];
    if (labeledDate) {
      return normalizeDateToken(labeledDate, receivedAt);
    }
  }

  const deadlineMatch = text.match(new RegExp(datePattern));
  return deadlineMatch?.[1] ? normalizeDateToken(deadlineMatch[1], receivedAt) : null;
}

function extractTypedDeadline(text: string, type: 'submission' | 'publish', receivedAt?: string) {
  const keywords = type === 'submission' ? '(?:交稿|交初稿|交第一版|初稿|第一版|腳本|素材|成品|修改稿|交件|交付|完稿|提交|交)' : '(?:上線|發布|貼文日|貼文上線|貼文發布|公開|活動開始|上架|刊登)';
  const before = text.match(new RegExp(`${datePattern}[^。；;，,\n]{0,16}${keywords}`));
  if (before?.[1]) return normalizeDateToken(before[1], receivedAt);
  const after = text.match(new RegExp(`${keywords}[^。；;，,\n]{0,16}?${datePattern}`));
  if (after?.[1]) return normalizeDateToken(after[1], receivedAt);
  return null;
}

function resolveExpectedDeadline(input: {expectedDeadline: string | null; submissionDeadline: string | null; publishDeadline: string | null}) {
  if (input.submissionDeadline && input.publishDeadline) return input.submissionDeadline;
  return input.submissionDeadline ?? input.publishDeadline ?? input.expectedDeadline;
}

function extractProvidedMaterials(text: string) {
  const provided: string[] = [];
  if (!/附件|已提供|附上|給你/.test(text)) {
    return provided;
  }
  for (const material of materialNames) {
    const normalized = material === 'Logo' ? '品牌 Logo' : material;
    const pattern = new RegExp(`(?:附件|已提供|附上|提供|給你)[^。；;，,\n]{0,20}${material}|${material}[^。；;，,\n]{0,20}(?:附件|已提供|附上|提供|給你)`, 'i');
    if (pattern.test(text)) provided.push(normalized);
  }
  return Array.from(new Set(provided));
}

function extractRequiredMaterials(text: string, providedMaterials: string[]) {
  const required: string[] = [];
  const materialRequest = text.match(/(?:請提供|待提供|補|等待|缺|還需要|需要.*(?:素材|圖片|連結|brief|文案|Logo|樣品))([^。；;\n]*)/i)?.[1] ?? '';
  const hasMaterialRequest = /請提供|待提供|補|等待|缺|還需要|需要.*(?:素材|圖片|連結|brief|文案|Logo|樣品)/.test(text);
  for (const material of materialNames) {
    const normalized = material === 'Logo' ? '品牌 Logo' : material;
    const pattern = new RegExp(`(?:(?:需要|請提供|待提供|補|等|等待|缺)[^。；;，,\n]{0,20}${material}|${material}[^。；;，,\n]{0,20}(?:需要|待提供|補|等|等待|缺))`, 'i');
    if ((pattern.test(text) || materialRequest.includes(material) || (hasMaterialRequest && text.includes(material))) && !providedMaterials.includes(normalized)) required.push(normalized);
  }
  const unique = Array.from(new Set(required));
  return unique.includes('產品圖片') ? unique.filter((item) => item !== '產品') : unique;
}

function inferNextAction(input: {text: string; intent: string; quoteAmount: number | null; caseStatus: CaseStatus; requiredMaterials: string[]; submissionDeadline: string | null; profile: ExtractionProfile}) {
  const explicit: Array<[RegExp, string]> = [
    [/請.*報價|提供報價|估價/, '提供報價'],
    [/確認檔期|檔期/, '確認檔期'],
    [/確認合約|簽約|合約/, '確認合約'],
    [input.profile === 'legacy' ? /交初稿|提交初稿|給初稿|交稿/ : /請[^。；;\n]*(?:交|給|提交|完稿)|修改稿請[^。；;\n]*(?:交|給|提交)|交初稿|提交初稿|給初稿|交稿/, '準備／提交初稿'],
    [/請提供|待提供|等待.*素材|補.*素材/, '等待客戶提供素材'],
  ];
  const explicitAction = explicit.find(([pattern]) => pattern.test(input.text))?.[1];
  if (explicitAction) return {nextAction: explicitAction, nextActionSource: 'extracted' as const};
  if (input.caseStatus === '已完成' || input.caseStatus === '已流失') return {nextAction: null, nextActionSource: null};
  if (input.intent === '交期風險') return {nextAction: null, nextActionSource: null};
  if (input.profile === 'p5_event_decision') {
    if (input.requiredMaterials.length > 0) return {nextAction: '等待客戶提供素材', nextActionSource: 'inferred' as const};
    if (!input.quoteAmount && input.intent === '詢價' && /多少錢|費用大概|報價大概|價格大概/.test(input.text)) return {nextAction: '提供報價', nextActionSource: 'inferred' as const};
    return {nextAction: null, nextActionSource: null};
  }
  if (!input.quoteAmount && (input.intent === '詢價' || input.intent === '合作邀請')) return {nextAction: '提供報價', nextActionSource: 'inferred' as const};
  if (input.caseStatus === '已報價' || input.caseStatus === '等待回覆') return {nextAction: '等待客戶確認', nextActionSource: 'inferred' as const};
  if (input.requiredMaterials.length > 0) return {nextAction: '等待客戶提供素材', nextActionSource: 'inferred' as const};
  if (input.submissionDeadline) return {nextAction: '準備／提交初稿', nextActionSource: 'inferred' as const};
  return {nextAction: null, nextActionSource: null};
}

function classifyIntent(text: string, profile: ExtractionProfile) {
  if (/已完成|結案|已交付|完成交付|尾款.*(?:收到|已收)|款項.*收到/.test(text)) {
    return '完成結案';
  }
  if (/取消|暫停合作|先暫停|不繼續|流失/.test(text)) {
    return '取消合作';
  }
  if (/補充一下|補充：|補充:/.test(text) && !/詢問|估價|多少錢|請問/.test(text)) {
    return '一般訊息';
  }
  if (/合作邀請|合作邀約|邀請您合作|品牌合作|宣傳合作|拍攝.*宣傳影片/.test(text)) {
    return '合作邀請';
  }
  if (/確認可以|可以合作|確認合作|簽約|成交/.test(text)) {
    return '確認合作';
  }
  if (/修改|調整|改|修正|追加|加做|順便/.test(text)) {
    return '修改需求';
  }
  if (/延期|來不及|下週才能|素材|延後|無法準時|趕不上/.test(text)) {
    return '交期風險';
  }
  if (profile === 'p5_event_decision' && /想請你|想委託|需要.*(?:設計|攝影|修圖|製作)|請.*(?:報價|估價)|多少錢|報價|費用|詢問|估價|價格|收費/.test(text)) {
    return '詢價';
  }
  if (profile === 'p5_event_decision') {
    return '一般訊息';
  }
  if (/多少錢|報價|費用|預算|詢問|估價|價格|收費/.test(text)) {
    return '詢價';
  }
  return '一般訊息';
}

function intentFromClassification(classification?: MessageClassification) {
  if (!classification) return null;
  const mapping: Partial<Record<MessageClassification['type'], string>> = {
    collaboration_invite: '合作邀請',
    quote_inquiry: '詢價',
    revision_request: '修改需求',
    deadline_or_material_risk: '交期風險',
    confirmation_or_contract: '確認合作',
  };
  return mapping[classification.type] ?? null;
}

function formatMissingFields(missingFields: string[]) {
  return missingFields.map((field) => missingFieldLabels[field] ?? field).join('、');
}

export function buildSummary(input: {senderName: string; text: string; projectItem: string | null; quoteAmount: number | null; expectedDeadline: string | null; intent: string; missingFields: string[]; similarCases?: RagExample[]}) {
  const body = compactText(stripMailSubject(input.text));
  const parts = [`${input.senderName} 的訊息判斷為「${input.intent}」`];
  const bestExample = input.similarCases?.[0];

  if (input.projectItem) {
    parts.push(`需求項目：${input.projectItem}`);
  }

  if (input.quoteAmount) {
    parts.push(`提到金額約 NT$ ${input.quoteAmount.toLocaleString('zh-TW')}`);
  }

  if (input.expectedDeadline) {
    parts.push(`期限/時程：${input.expectedDeadline}`);
  }
  

  if (input.missingFields.length > 0) {
    parts.push(`仍缺 ${formatMissingFields(input.missingFields)}`);
  }

  if (bestExample && bestExample.score >= 40) {
    parts.push(`相似案例：${bestExample.title}`);
  }

  if (!input.projectItem && !input.quoteAmount && !input.expectedDeadline && body) {
    parts.push(`主要內容：${body.slice(0, 80)}${body.length > 80 ? '...' : ''}`);
  }

  return `${parts.join('；')}。`;
}

export function buildSuggestedReply(input: {clientName: string; text: string; intent: string; projectItem: string | null; quoteAmount: number | null; expectedDeadline: string | null; missingFields: string[]; similarCases?: RagExample[]}) {
  const bestExample = input.similarCases?.[0];
  const referenceText = '';
  const successText = '';
  const projectText = input.projectItem ? `這次 ${input.projectItem} 的合作方向我有興趣` : '這次合作方向我有興趣';
  const deadlineText = input.expectedDeadline ? `我也先記下預計時程是 ${input.expectedDeadline}` : '';

  if (input.intent === '合作邀請') {
    const questions = [];
    if (!input.quoteAmount) {
      questions.push('合作報價或預算範圍');
    }
    questions.push('授權期間與使用範圍');
    questions.push('拍攝/審稿/上線時程');
    questions.push('是否需要露出指定口播、Hashtag 或追蹤連結');

    return `您好，謝謝邀請。${referenceText}${projectText}。${deadlineText ? `${deadlineText}，` : ''}想先確認 ${questions.join('、')}，確認後我可以回覆可配合的方案與報價。${successText}`;
  }

  if (input.intent === '詢價') {
    const knownParts = [
      input.projectItem ? `需求項目是 ${input.projectItem}` : null,
      input.quoteAmount ? `預算約 NT$ ${input.quoteAmount.toLocaleString('zh-TW')}` : null,
      input.expectedDeadline ? `預期時間是 ${input.expectedDeadline}` : null,
    ].filter(Boolean).join('，');
    const rangeText = bestExample && bestExample.score >= 40 && bestExample.quoteRangeMin && bestExample.quoteRangeMax
      ? `依類似專案的經驗，報價範圍約 NT$ ${bestExample.quoteRangeMin.toLocaleString('zh-TW')}–${bestExample.quoteRangeMax.toLocaleString('zh-TW')}。`
      : '';

    return `您好，謝謝您的詢問。${knownParts ? `我目前理解 ${knownParts}。` : ''}${rangeText}${input.missingFields.length > 0 ? `想再確認 ${formatMissingFields(input.missingFields)}，` : ''}確認後我會整理報價與可執行範圍給您。${successText}`;
  }

  if (input.intent === '修改需求') {
    return `您好，收到您的修改需求。${input.projectItem ? `我會以 ${input.projectItem} 為主確認調整範圍。` : ''}我先整理會影響的交付內容、修改次數與時程，再回覆您是否需要調整報價或交期。`;
  }

  if (input.intent === '交期風險') {
        return `您好，收到。目前看起來可能會影響${input.expectedDeadline ? `${input.expectedDeadline} ` : ''}的交付安排。我會先依素材提供時間重新評估排程，確認是否需要調整交期後回覆您。`;
  }

  if (input.intent === '確認合作') {
    return `您好，感謝您確認合作！${input.projectItem ? `專案內容為 ${input.projectItem}，` : ''}${input.quoteAmount ? `報價確認為 NT$ ${input.quoteAmount.toLocaleString('zh-TW')}。` : ''}我會整理合約與付款方式（含訂金資訊）後提供給您，確認後即可開始安排進度。`;
  }

  if (/匯款|已轉帳|已付款|付款完成|已匯|匯入/.test(input.text)) {
    return '您好，收到您的訂金匯款，謝謝！我會先核對入帳狀況，確認後即安排製作，並同步更新時程給您。';
  }

  if (input.missingFields.length > 0) {
    return `您好，謝謝您的訊息。${referenceText}為了協助評估後續安排，想先確認 ${formatMissingFields(input.missingFields)}，再整理合作方式給您。${successText}`;
  }

  return `您好，謝謝您的訊息。${referenceText}目前需求、預算與時程已初步清楚，我會整理可執行方案與下一步安排給您確認。`;
}

function mapStatus(intent: string): CaseStatus {
  if (intent === '確認合作') {
    return '已確認合作';
  }
  if (intent === '修改需求') {
    return '待修改';
  }
  if (intent === '交期風險') {
    return '等待素材';
  }
  if (intent === '詢價' || intent === '合作邀請') {
    return '需求確認中';
  }
  if (intent === '取消合作') {
    return '已流失';
  }
  if (intent === '完成結案') {
    return '已完成';
  }
  return '潛在詢問';
}

export function extractMessage(input: {senderName: string; text: string; prepared?: PreprocessedEmail; classification?: MessageClassification; similarCases?: RagExample[]; receivedAt?: string; profile?: ExtractionProfile}): AiExtraction {
  const profile = input.profile ?? 'p5_event_decision';
  const sourceText = input.prepared?.cleanText ?? input.text;
  const clientName = inferCustomerName({senderName: input.senderName, text: sourceText});
  const projectItem = extractProjectItem(sourceText);
  const quoteAmount = extractAmount(sourceText);
  const submissionDeadline = extractTypedDeadline(sourceText, 'submission', input.receivedAt);
  const publishDeadline = extractTypedDeadline(sourceText, 'publish', input.receivedAt);
  const expectedDeadline = resolveExpectedDeadline({expectedDeadline: extractDeadline(sourceText, input.receivedAt), submissionDeadline, publishDeadline});
  const classifiedIntent = classifyIntent(sourceText, profile);
  const intent = profile === 'legacy' && classifiedIntent !== '取消合作' && classifiedIntent !== '完成結案' ? (intentFromClassification(input.classification) ?? classifiedIntent) : classifiedIntent;
  const caseStatus = mapStatus(intent);
  const providedMaterials = extractProvidedMaterials(sourceText);
  const requiredMaterials = extractRequiredMaterials(sourceText, providedMaterials);
  const next = inferNextAction({text: sourceText, intent, quoteAmount, caseStatus, requiredMaterials, submissionDeadline, profile});
  const baseMissingFields = [
    projectItem ? null : 'project_item',
    quoteAmount ? null : 'quote_amount',
    expectedDeadline ? null : 'expected_deadline',
    /交稿|初稿|腳本|成品|修改稿|交件|交付|完稿|提交/.test(sourceText) && !submissionDeadline ? 'submission_deadline' : null,
    /上線|發布|貼文日|貼文上線|貼文發布|公開|活動開始|上架|刊登/.test(sourceText) && !publishDeadline ? 'publish_deadline' : null,
    /請提供.*(素材|圖片|連結|brief|文案|Logo|產品|樣品)|待提供|等待.*素材|補.*素材|缺.*素材/.test(sourceText) && requiredMaterials.length === 0 ? 'required_materials' : null,
    profile === 'legacy' && !next.nextAction && ['已確認合作', '進行中', '等待素材', '待修改', '待交付'].includes(caseStatus) ? 'next_action' : null,
  ].filter((field): field is string => Boolean(field));
  const missingFields = mergeMissingFields({baseFields: baseMissingFields, projectItem, quoteAmount, expectedDeadline, intent, sourceText, profile});

  return {
    clientName,
    projectItem,
    quoteAmount,
    expectedDeadline,
    submissionDeadline,
    publishDeadline,
    nextAction: next.nextAction,
    nextActionSource: next.nextActionSource,
    requiredMaterials,
    providedMaterials,
    intent,
    caseStatus,
    missingFields,
    summary: buildSummary({senderName: clientName, text: sourceText, projectItem, quoteAmount, expectedDeadline, intent, missingFields, similarCases: input.similarCases}),
    suggestedReply: buildSuggestedReply({clientName, text: sourceText, intent, projectItem, quoteAmount, expectedDeadline, missingFields, similarCases: input.similarCases}),
  };
}
