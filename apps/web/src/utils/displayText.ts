const blockTagPattern = /<\s*\/?\s*(?:br|p|div|pre|li|tr|table|tbody|thead|tfoot|ul|ol)\b[^>]*>/gi;
const tagNameFragmentPattern = /\b(?:br|b|u|i|font|pre|script|style|span|div|p)\b/gi;

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function displayText(value: string | null | undefined, fallback = '', options: {preserveLines?: boolean} = {}) {
  const lineBreak = options.preserveLines ? '\n' : ' ';
  const text = decodeHtmlEntities(String(value ?? ''))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(blockTagPattern, lineBreak)
    .replace(/<[^>]*>/g, ' ')
    .replace(/<[^>]*$|<[^>]*\.\.\./g, ' ')
    .replace(tagNameFragmentPattern, ' ')
    .replace(/[<>/]+/g, ' ')
    .replace(options.preserveLines ? /[\t \f\v]+/g : /\s+/g, ' ')
    .replace(options.preserveLines ? / *\n */g : / {2,}/g, options.preserveLines ? '\n' : ' ')
    .replace(options.preserveLines ? /\n{3,}/g : / {2,}/g, options.preserveLines ? '\n\n' : ' ')
    .trim();

  return text || fallback;
}

export function truncateDisplayText(value: string | null | undefined, maxLength: number, fallback = '') {
  const text = displayText(value, fallback);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
