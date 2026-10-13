const blockTags = new Set(['address', 'article', 'aside', 'blockquote', 'div', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul']);
const skipTags = new Set(['script', 'style', 'head', 'title', 'meta', 'link']);

const namedEntities: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

export function decodeHtmlEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, value: string) => {
    const lower = value.toLowerCase();
    if (lower.startsWith('#x')) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (lower.startsWith('#')) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return namedEntities[lower] ?? entity;
  });
}

function appendBreak(parts: string[]) {
  const last = parts[parts.length - 1] ?? '';
  if (last !== '\n') parts.push('\n');
}

export function normalizePlainText(text: string) {
  return decodeHtmlEntities(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\t \f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeHtml(text: string) {
  return /<\s*\/?\s*(?:html|body|br|p|div|span|font|pre|table|tr|td|th|ul|ol|li|b|strong|script|style)\b/i.test(text);
}

function splitQuotedAndSignature(text: string) {
  const quoteMarkers = [/^On .+ wrote:$/im, /^寄件者:/im, /^From:/im, /^-----Original Message-----/im, /^>\s?/m];
  const signatureMarkers = [/\n--\s*\n/m, /\n(?:敬上|Best regards,?|Regards,?|Sent from my iPhone)\b/im];
  const quoteIndexes = quoteMarkers.map((pattern) => text.search(pattern)).filter((index) => index >= 0);
  const signatureIndexes = signatureMarkers.map((pattern) => text.search(pattern)).filter((index) => index >= 0);
  const quoteIndex = quoteIndexes.length > 0 ? Math.min(...quoteIndexes) : -1;
  const signatureIndex = signatureIndexes.length > 0 ? Math.min(...signatureIndexes) : -1;
  const cutoffCandidates = [quoteIndex, signatureIndex].filter((index) => index >= 0);
  const cutoff = cutoffCandidates.length > 0 ? Math.min(...cutoffCandidates) : -1;
  return {
    visibleText: cutoff >= 0 ? text.slice(0, cutoff).trim() : text,
    quotedText: quoteIndex >= 0 ? text.slice(quoteIndex).trim() : '',
    signatureText: signatureIndex >= 0 && (quoteIndex < 0 || signatureIndex < quoteIndex) ? text.slice(signatureIndex).trim() : '',
    quoteRemoved: quoteIndex >= 0,
    signatureDetected: signatureIndex >= 0,
  };
}

function normalizeReadableText(text: string) {
  const normalized = normalizePlainText(text);
  return splitQuotedAndSignature(normalized);
}

export function htmlToText(html: string) {
  const parts: string[] = [];
  let index = 0;
  let skipping: string | null = null;

  while (index < html.length) {
    const tagStart = html.indexOf('<', index);
    if (tagStart === -1) {
      if (!skipping) parts.push(html.slice(index));
      break;
    }

    if (!skipping && tagStart > index) parts.push(html.slice(index, tagStart));
    const tagEnd = html.indexOf('>', tagStart + 1);
    if (tagEnd === -1) {
      break;
    }

    const rawTag = html.slice(tagStart + 1, tagEnd).trim();
    const isClosing = rawTag.startsWith('/');
    const tagName = rawTag.replace(/^\//, '').split(/[\s/>]/)[0]?.toLowerCase() ?? '';

    if (skipping) {
      if (isClosing && tagName === skipping) skipping = null;
      index = tagEnd + 1;
      continue;
    }

    if (!isClosing && skipTags.has(tagName)) skipping = tagName;
    else if (tagName === 'br') appendBreak(parts);
    else if (tagName === 'li') {
      appendBreak(parts);
      parts.push('- ');
    } else if (tagName === 'td' || tagName === 'th') {
      const last = parts[parts.length - 1] ?? '';
      if (last && last !== '\n' && last !== ' | ') parts.push(' | ');
    } else if (blockTags.has(tagName)) {
      appendBreak(parts);
    }

    index = tagEnd + 1;
  }

  return normalizePlainText(parts.join(''));
}

export function normalizeEmailBody(input: {plainText?: string | null; htmlText?: string | null}) {
  const rawPlainText = input.plainText ?? '';
  const plainText = looksLikeHtml(rawPlainText) ? htmlToText(rawPlainText) : normalizePlainText(rawPlainText);
  if (plainText) {
    const readable = normalizeReadableText(plainText);
    return {text: readable.visibleText || plainText, readableContent: readable.visibleText || plainText, source: 'text/plain' as const, original: rawPlainText, wasHtml: looksLikeHtml(rawPlainText), ...readable};
  }

  const htmlText = input.htmlText ?? '';
  const normalized = htmlToText(htmlText);
  const readable = normalizeReadableText(normalized);
  return {text: readable.visibleText || normalized, readableContent: readable.visibleText || normalized, source: 'text/html' as const, original: htmlText, wasHtml: Boolean(htmlText), ...readable};
}

export function sanitizeDisplayText(value: string | null | undefined) {
  const normalized = htmlToText(String(value ?? ''));
  const withoutTagFragments = normalized
    .replace(/\b(?:br|b|u|i|font|pre|p|div|span)\b/gi, ' ')
    .replace(/[<>/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutTagFragments;
}

export function isMeaningfulDisplayText(value: string | null | undefined) {
  const sanitized = sanitizeDisplayText(value);
  return sanitized.length >= 2 && !/^(?:html|body|br|b|p|div|span|font|pre)$/i.test(sanitized);
}
