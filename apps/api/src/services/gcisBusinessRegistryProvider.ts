import type {BusinessProfile} from '@casebee/shared';

type GcisCompanyRecord = {
  Business_Accounting_NO?: string;
  Company_Status_Desc?: string;
  Company_Name?: string;
  Capital_Stock_Amount?: string | number;
  Paid_In_Capital_Amount?: string | number;
  Responsible_Name?: string;
  Company_Location?: string;
  Register_Organization_Desc?: string;
  Company_Setup_Date?: string;
  Change_Of_Approval_Data?: string;
};

export type GcisBusinessRegistryRecord = Omit<BusinessProfile, 'id' | 'customerId' | 'fetchedAt'> & {rawPayload: GcisCompanyRecord};

const defaultCompanyProfileEndpoint = 'https://data.gcis.nat.gov.tw/od/data/api/5F64D864-61CB-4D0D-8AD9-492047CC1EA6';

function numberOrNull(value: string | number | undefined) {
  if (value === undefined || value === '') {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function rocDateToIso(value: string | undefined) {
  const text = value?.trim();
  if (!text || !/^\d{7}$/.test(text)) {
    return null;
  }

  const year = Number(text.slice(0, 3)) + 1911;
  const month = text.slice(3, 5);
  const day = text.slice(5, 7);
  return `${year}-${month}-${day}`;
}

function mapCompanyRecord(record: GcisCompanyRecord): GcisBusinessRegistryRecord | null {
  if (!record.Company_Name) {
    return null;
  }

  return {
    businessAccountingNo: record.Business_Accounting_NO ?? null,
    businessName: record.Company_Name,
    businessType: 'company',
    statusCode: null,
    statusDesc: record.Company_Status_Desc ?? null,
    capitalAmount: numberOrNull(record.Capital_Stock_Amount),
    paidInCapitalAmount: numberOrNull(record.Paid_In_Capital_Amount),
    responsibleName: record.Responsible_Name ?? null,
    registeredAddress: record.Company_Location ?? null,
    registerOrganization: record.Register_Organization_Desc ?? null,
    setupDate: rocDateToIso(record.Company_Setup_Date),
    lastChangeDate: rocDateToIso(record.Change_Of_Approval_Data),
    source: 'gcis',
    rawPayload: record,
  };
}

export async function findGcisBusinessProfile(query: {taxId?: string}) {
  if (!query.taxId || !/^\d{8}$/.test(query.taxId)) {
    return null;
  }

  const endpoint = process.env.GCIS_COMPANY_PROFILE_ENDPOINT ?? defaultCompanyProfileEndpoint;
  const url = new URL(endpoint);
  url.searchParams.set('$format', 'json');
  url.searchParams.set('$filter', `Business_Accounting_NO eq ${query.taxId}`);
  url.searchParams.set('$top', '1');

  const response = await fetch(url, {signal: AbortSignal.timeout(10000)});
  if (!response.ok) {
    throw new Error(`GCIS lookup failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  if (!Array.isArray(data) || !data[0]) {
    return null;
  }

  return mapCompanyRecord(data[0] as GcisCompanyRecord);
}

// ===== 客戶真偽篩選器：名稱關鍵字查詢 =====

const defaultCompanyKeywordEndpoint = 'https://data.gcis.nat.gov.tw/od/data/api/6BBA2268-1367-4B42-9CCA-BC17499EBE8C';
const defaultBusinessKeywordEndpoint = 'https://data.gcis.nat.gov.tw/od/data/api/A1B4CBFF-2D3A-409B-8A78-2AD94F63AE4A';

export type RegistryLookupStatus = 'found' | 'not_found' | 'multiple';

export type RegistryCandidate = {
  taxId: string | null;
  name: string;
  entityType: 'company' | 'business';
  statusDesc: string | null;
  address: string | null;
  responsibleName: string | null;
};

export type RegistrySearchResult = {
  status: RegistryLookupStatus;
  candidates: RegistryCandidate[];
  query: {taxId: string | null; keyword: string | null};
  queriedAt: string;
  source: 'gcis';
  hint: string | null;
};

type LooseRecord = Record<string, unknown>;

function pickText(record: LooseRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

// 商業登記欄位名稱尚未用 curl 結果確認，所以每個欄位放多個候選名稱
function mapCompanyCandidate(record: LooseRecord): RegistryCandidate | null {
  const name = pickText(record, ['Company_Name']);
  if (!name) {
    return null;
  }
  return {
    taxId: pickText(record, ['Business_Accounting_NO']),
    name,
    entityType: 'company',
    statusDesc: pickText(record, ['Company_Status_Desc']),
    address: pickText(record, ['Company_Location']),
    responsibleName: pickText(record, ['Responsible_Name']),
  };
}

function mapBusinessCandidate(record: LooseRecord): RegistryCandidate | null {
  const name = pickText(record, ['Business_Name']);
  if (!name) {
    return null;
  }
  return {
    taxId: pickText(record, ['Business_Accounting_NO']),
    name,
    entityType: 'business',
    statusDesc: pickText(record, ['Business_Current_Status_Desc', 'Business_Status_Desc', 'Current_Status_Desc']),
    address: pickText(record, ['Business_Address', 'Business_Location']),
    responsibleName: pickText(record, ['Responsible_Name']),
  };
}

async function fetchGcisList(endpoint: string, filter: string, top: number): Promise<LooseRecord[]> {
  const url = new URL(endpoint);
  url.searchParams.set('$format', 'json');
  url.searchParams.set('$filter', filter);
  url.searchParams.set('$top', String(top));

  const response = await fetch(url, {signal: AbortSignal.timeout(10000)});
  if (!response.ok) {
    throw new Error(`GCIS keyword lookup failed with HTTP ${response.status}`);
  }

  // 無結果時可能回空內容，先讀文字再解析，避免 response.json() 直接爆錯
  const text = (await response.text()).trim();
  if (!text) {
    return [];
  }

  const data = JSON.parse(text) as unknown;
  return Array.isArray(data) ? (data as LooseRecord[]) : [];
}

export async function searchGcisByKeyword(keyword: string, options: {statusCode?: string; top?: number} = {}) {
  // 只留文字與數字，避免特殊字元破壞 $filter 語法
  const safeKeyword = keyword.replace(/[^\p{L}\p{N}]/gu, '');
  if (safeKeyword.length < 2) {
    return [];
  }

  const statusCode = options.statusCode ?? '01';
  const top = options.top ?? 10;
  const companyEndpoint = process.env.GCIS_COMPANY_KEYWORD_ENDPOINT ?? defaultCompanyKeywordEndpoint;
  const businessEndpoint = process.env.GCIS_BUSINESS_KEYWORD_ENDPOINT ?? defaultBusinessKeywordEndpoint;

  const [companies, businesses] = await Promise.all([
    fetchGcisList(companyEndpoint, `Company_Name like ${safeKeyword} and Company_Status eq ${statusCode}`, top),
    fetchGcisList(businessEndpoint, `Business_Name like ${safeKeyword} and Business_Current_Status eq ${statusCode}`, top),
  ]);

  const candidates = [
    ...companies.map(mapCompanyCandidate),
    ...businesses.map(mapBusinessCandidate),
  ].filter((item): item is RegistryCandidate => item !== null);

  // 同統編 + 同類型只留一筆
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = `${item.entityType}:${item.taxId ?? item.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function screenRegistry(input: {taxId?: string; keyword?: string}): Promise<RegistrySearchResult> {
  const taxId = input.taxId?.trim() || null;
  const keyword = input.keyword?.trim() || null;
  let candidates: RegistryCandidate[] = [];

  if (taxId && /^\d{8}$/.test(taxId)) {
    const profile = await findGcisBusinessProfile({taxId});
    if (profile) {
      candidates = [{
        taxId: profile.businessAccountingNo,
        name: profile.businessName,
        entityType: 'company',
        statusDesc: profile.statusDesc,
        address: profile.registeredAddress,
        responsibleName: profile.responsibleName,
      }];
    }
  }

  if (candidates.length === 0 && keyword) {
    candidates = await searchGcisByKeyword(keyword);
  }

  const status: RegistryLookupStatus = candidates.length === 0 ? 'not_found' : candidates.length === 1 ? 'found' : 'multiple';
  const hint = status === 'not_found'
    ? '查無登記資料，請請對方補充統一編號，或確認公司名稱是否正確。'
    : status === 'multiple'
      ? '找到多筆候選，請依統編、地址或負責人確認是哪一個登記主體。'
      : null;

  return {status, candidates, query: {taxId, keyword}, queriedAt: new Date().toISOString(), source: 'gcis', hint};
}