import type {PreprocessedEmail} from './emailPreprocessor.js';

export type MessageType =
  | 'collaboration_invite'
  | 'quote_inquiry'
  | 'revision_request'
  | 'deadline_or_material_risk'
  | 'confirmation_or_contract'
  | 'announcement'
  | 'calendar_invite'
  | 'newsletter'
  | 'system_notification'
  | 'unknown';

export interface MessageClassification {
  type: MessageType;
  confidence: number;
  reasons: string[];
}

function has(text: string, pattern: RegExp) {
  return pattern.test(text);
}

export function classifyPreparedMessage(prepared: PreprocessedEmail): MessageClassification {
  const text = prepared.cleanText.toLowerCase();
  const reasons: string[] = [];

  if (has(text, /google calendar|邀請：|calendar event|會議邀請/i)) {
    return {type: 'calendar_invite', confidence: 0.92, reasons: ['calendar marker']};
  }
  if (has(text, /unsubscribe|取消訂閱|newsletter|edm/i)) {
    return {type: 'newsletter', confidence: 0.9, reasons: ['newsletter marker']};
  }
  if (has(text, /驗證碼|security code|verification code|otp|登入代碼|two-factor|2fa|authentication/i)) {
    return {type: 'system_notification', confidence: 0.9, reasons: ['verification marker']};
  }
  if (has(text, /競賽|徵件|報名|入圍|公告|活動通知|賽務|獎金獵人/i)) {
    return {type: 'announcement', confidence: 0.82, reasons: ['announcement terms']};
  }
  if (has(text, /合作邀請|合作邀約|邀請您合作|品牌合作|宣傳合作|拍攝.*宣傳影片/i)) {
    reasons.push('collaboration terms');
    return {type: 'collaboration_invite', confidence: 0.86, reasons};
  }
  if (has(text, /取消|暫停合作|先暫停|不繼續|流失/i)) {
    reasons.push('cancellation terms');
    return {type: 'unknown', confidence: 0.78, reasons};
  }
  if (has(text, /延期|來不及|下週才能|素材|延後|無法準時|趕不上/i)) {
    reasons.push('deadline/material risk terms');
    return {type: 'deadline_or_material_risk', confidence: 0.84, reasons};
  }
  if (has(text, /修改|調整|修正|追加|加做|順便|改成/i)) {
    reasons.push('revision terms');
    return {type: 'revision_request', confidence: 0.82, reasons};
  }
  if (has(text, /確認可以|可以合作|簽約|合約|成交|首付款/i)) {
    reasons.push('confirmation terms');
    return {type: 'confirmation_or_contract', confidence: 0.8, reasons};
  }
  if (has(text, /補充一下|補充：|補充:/i) && !has(text, /詢問|估價|多少錢|請問/i)) {
    reasons.push('follow-up context');
    return {type: 'unknown', confidence: 0.68, reasons};
  }
  if (has(text, /多少錢|報價|費用|預算|詢問|估價|價格|收費/i)) {
    reasons.push('quote terms');
    return {type: 'quote_inquiry', confidence: 0.8, reasons};
  }

  return {type: 'unknown', confidence: 0.45, reasons: ['no strong classifier match']};
}
