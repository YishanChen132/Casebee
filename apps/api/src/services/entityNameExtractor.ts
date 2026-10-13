export type ExtractedEntityName = {
  name: string;
  kind: 'company' | 'brand';
  reason: string;
};

// 公司名稱常見結尾（有結尾才算公司）
const companySuffixes = '股份有限公司|有限責任公司|有限公司|企業社|工作室|工作坊|事務所|商行|企業|集團|基金會|協會';
// 沒有正式結尾，但常出現在公司或商號名稱裡的字
const looseSuffixes = '行銷|科技|傳媒|媒體|文創|顧問|影像|實業|貿易|生技|咖啡|餐飲|廣告|國際';
// 名稱開頭不可能是這些，遇到就當成不是名稱
const badStarts = /^(貴|本|我們|你們|他們|這家|那家|這間|那間|該|各|某|一家|一間|新|老|大|小型|的|是|有|和|跟|與|想|要)/;
// 只用多字的引導詞，避免把名稱裡的單字（例如「和泰」「理想」）誤切掉
const connectorPrefix = /^.*?(?:來自|任職於|隸屬於|服務於|代表|目前在|我是|我們是|這裡是|這邊是|敝公司是|敝司為|請問|聯絡|聯繫|關於|針對|也想聯名|聯名|合作)/;
const verbLike = /[想要做找問請需有能可]/;

function clean(raw: string) {
  let value = raw.trim();
  // 去掉「我是」「來自」等引導詞，只留名稱本身
  for (let i = 0; i < 3; i += 1) {
    const stripped = value.replace(connectorPrefix, '');
    if (stripped === value || stripped.length < 2) break;
    value = stripped;
  }
  // 英文句子：只留 from / at / of / with 後面的名稱
  value = value.replace(/^.*\b(?:from|at|of|with)\s+/i, '');
  return value.replace(/^[「『"“'（(]+|[」』"”'）)，。；;、,]+$/g, '').trim();
}

export function extractEntityNames(text: string): ExtractedEntityName[] {
  const results: ExtractedEntityName[] = [];
  const seen = new Set<string>();

  const add = (rawName: string, kind: ExtractedEntityName['kind'], reason: string) => {
    const name = clean(rawName);
    if (name.length < 2 || name.length > 40 || badStarts.test(name) || seen.has(name)) return;
    // 已經被更完整的名稱包含，就不重複列
    if (results.some((item) => item.name.includes(name))) return;
    for (let i = results.length - 1; i >= 0; i -= 1) {
      if (name.includes(results[i].name)) {
        seen.delete(results[i].name);
        results.splice(i, 1);
      }
    }
    seen.add(name);
    results.push({name, kind, reason});
  };

  // 1. 有正式結尾的公司名，例如 ○○股份有限公司、○○工作室
  for (const match of text.matchAll(new RegExp(`([\\p{Script=Han}A-Za-z0-9&()（）·.\\-]{1,22}?(?:${companySuffixes}))`, 'gu'))) {
    add(match[1], 'company', '訊息中出現公司名稱');
  }

  // 2. 英文公司名，例如 Sunny Studio Co., Ltd.
  for (const match of text.matchAll(/([A-Z][A-Za-z0-9&.\- ]{1,30}(?:Co\.,? ?Ltd\.?|Inc\.?|Ltd\.?|Corp\.?|Company|Studio|Agency))/g)) {
    add(match[1], 'company', '訊息中出現英文公司名稱');
  }

  // 3. 有標示的名稱，例如「公司名稱：○○」「品牌：○○」
  for (const match of text.matchAll(/(公司名稱|公司|品牌名稱|品牌|商號|店名|廠商|單位)[:：]\s*[「『"“]?([^\s」』"”，。；;,\n]{2,20})/g)) {
    add(match[2], match[1].includes('品牌') ? 'brand' : 'company', `訊息中標示「${match[1]}」`);
  }

  // 4. 「我是○○的王小姐」「來自○○的」這類自我介紹
  for (const match of text.matchAll(/(?:我是|我們是|這裡是|這邊是|來自|任職於|服務於|代表)([^\s，。；;,的]{2,12})的/g)) {
    const name = match[1];
    if (!verbLike.test(name)) add(name, 'company', '自我介紹中提到的單位');
  }

  // 5. ○○品牌、「○○」品牌
  for (const match of text.matchAll(/[「『"“]([^」』"”]{2,12})[」』"”]\s*品牌/g)) {
    add(match[1], 'brand', '訊息中提到的品牌');
  }
  for (const match of text.matchAll(/品牌\s*[「『"“]([^」』"”]{2,12})[」』"”]/g)) {
    add(match[1], 'brand', '訊息中提到的品牌');
  }
  for (const match of text.matchAll(/([\p{Script=Han}A-Za-z0-9]{2,10})品牌/gu)) {
    const cleaned = clean(match[1]);
    if (!verbLike.test(cleaned)) add(cleaned, 'brand', '訊息中提到的品牌');
  }

  // 6. 沒有正式結尾，但名字看起來像公司或商號，例如 晴天行銷、小島咖啡
  for (const match of text.matchAll(new RegExp(`([\\p{Script=Han}]{2,5}(?:${looseSuffixes}))`, 'gu'))) {
    if (!verbLike.test(match[1].slice(0, -2))) add(match[1], 'company', '名稱看起來像公司或商號');
  }

  return results.slice(0, 6);
}