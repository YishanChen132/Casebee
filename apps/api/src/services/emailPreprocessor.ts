export interface PreprocessedEmail {
  subject: string;
  bodyText: string;
  cleanText: string;
  candidateLines: string[];
  labeledFields: Record<string, string>;
  quotedTextRemoved: boolean;
}

function normalizeText(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitSubject(text: string) {
  const normalized = normalizeText(text).trim();
  const match = normalized.match(/^Subject:\s*(.+?)(?:\n\n|$)/i);
  const subject = match?.[1]?.trim() ?? '';
  const bodyText = subject && match ? normalized.slice(match[0].length).trim() : normalized;
  return {subject, bodyText};
}

function removeQuotedText(text: string) {
  const markers = [/^On .+ wrote:$/im, /^寄件者:/im, /^From:/im, /^-----Original Message-----/im];
  const indexes = markers.map((pattern) => text.search(pattern)).filter((index) => index >= 0);
  if (indexes.length === 0) {
    return {text, removed: false};
  }

  return {text: text.slice(0, Math.min(...indexes)).trim(), removed: true};
}

function removeNoise(text: string) {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[image:[^\]]+\]/gi, '')
    .replace(/\n--\s*\n[\s\S]*$/m, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractLabeledFields(lines: string[]) {
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^[-•*\s]*([^：:\n]{2,18})[：:]\s*(.+)$/);
    if (match?.[1] && match[2]) {
      fields[match[1].trim()] = match[2].trim();
    }
  }
  return fields;
}

export function preprocessEmail(text: string): PreprocessedEmail {
  const {subject, bodyText} = splitSubject(text);
  const quoted = removeQuotedText(bodyText);
  const cleanBody = removeNoise(quoted.text);
  const candidateLines = cleanBody
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 2 && line.length <= 160);

  return {
    subject,
    bodyText,
    cleanText: [subject, cleanBody].filter(Boolean).join('\n\n'),
    candidateLines,
    labeledFields: extractLabeledFields(candidateLines),
    quotedTextRemoved: quoted.removed,
  };
}
