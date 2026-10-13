const knownAliases: Array<{pattern: RegExp; name: string}> = [
  {pattern: /fupin|富品/i, name: '富品建設'},
];

const noisyNamePatterns = [
  /^我是\s*/g,
  /^我們是\s*/g,
  /^來自\s*/g,
  /企劃部/g,
  /行銷部/g,
  /行銷團隊/g,
  /客服部/g,
  /第二帳號/g,
  /第[一二三四五六七八九十]+帳號/g,
  /帳號/g,
  /官方/g,
  /小編/g,
  /團隊/g,
];

function cleanCandidateName(value: string) {
  const cleaned = noisyNamePatterns.reduce((current, pattern) => current.replace(pattern, ''), value)
    .replace(/[「」【】]/g, '')
    .replace(/[-_\.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.replace(/\s+(Amy|Andy|Annie|Ben|Cathy|David|Emily|Jenny|Kevin|Leo|Linda|Mary|May|Tina|Tom)$/i, '').trim();
}

function extractOrganizationFromText(text: string) {
  const patterns = [
    /(?:主辦單位|執行單位|承辦單位|發信單位|敬上)[：:：\s]*([^\n\r，,。]{2,24})/,
    /([^\n\r，,。]{2,20}(?:股份有限公司|有限公司|建設|科技|行銷|設計|工作室|實驗室|基金會|協會|學校|大學|小組|團隊))/,
  ];

    for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const candidate = cleanCandidateName(match[1]);
      // Reject candidates that look like a sentence fragment rather than a name:
      // contains a conversational/request phrase anywhere (not just at the start),
      // or has more than one space (real brand/company names are compact).
      const looksLikeSentence = /(你好|您好|我們|我想|想問|想要|需要|不好意思|請問|麻煩|可以|希望|Logo|Reels|網站|官網|IG|社群|產品攝影|包裝|簡報|DM)/i.test(candidate)
        || (candidate.match(/\s/g)?.length ?? 0) > 1;
      if (!looksLikeSentence) {
        return candidate;
      }
    }
  }

  return null;
}

export function inferCustomerName(input: {from?: string; senderName: string; senderEmail?: string; subject?: string; text?: string}) {
  const senderName = input.senderName.trim();
  const senderEmail = (input.senderEmail ?? input.from ?? '').trim();
  const combined = [input.from, senderName, senderEmail, input.subject, input.text].filter(Boolean).join('\n');

  for (const alias of knownAliases) {
    if (alias.pattern.test(combined)) {
      return alias.name;
    }
  }

  const organization = extractOrganizationFromText(combined);
  if (organization) {
    return organization;
  }

  const cleanedSenderName = cleanCandidateName(senderName);
  if (cleanedSenderName && cleanedSenderName !== senderEmail && !/^[a-z0-9._%+-]+@[a-z0-9.-]+$/i.test(cleanedSenderName)) {
    return cleanedSenderName;
  }

  const localPart = senderEmail.match(/^([^@<\s]+)@/)?.[1] ?? senderEmail.match(/<([^@]+)@/)?.[1] ?? '';
  const cleanedLocalPart = cleanCandidateName(localPart);
  return cleanedLocalPart || senderName || senderEmail || 'Unknown Sender';
}
