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
