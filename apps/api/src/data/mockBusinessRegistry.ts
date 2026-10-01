import type {BusinessProfile} from '@casebee/shared';

export type MockBusinessRegistryRecord = Omit<BusinessProfile, 'id' | 'customerId' | 'fetchedAt'>;

export const mockBusinessRegistry: MockBusinessRegistryRecord[] = [
  {
    businessAccountingNo: '24500001',
    businessName: '晴天行銷有限公司',
    businessType: 'company',
    statusCode: '01',
    statusDesc: '核准設立',
    capitalAmount: 5000000,
    paidInCapitalAmount: 5000000,
    responsibleName: '林晴文',
    registeredAddress: '臺北市信義區松仁路100號',
    registerOrganization: '臺北市政府',
    setupDate: '2018-06-12',
    lastChangeDate: '2024-03-20',
    source: 'mock',
  },
  {
    businessAccountingNo: '53000002',
    businessName: '森木科技股份有限公司',
    businessType: 'company',
    statusCode: '01',
    statusDesc: '核准設立',
    capitalAmount: 20000000,
    paidInCapitalAmount: 12000000,
    responsibleName: '陳森',
    registeredAddress: '新北市板橋區文化路一段88號',
    registerOrganization: '新北市政府',
    setupDate: '2014-11-05',
    lastChangeDate: '2023-12-01',
    source: 'mock',
  },
  {
    businessAccountingNo: '88100003',
    businessName: '小島咖啡商行',
    businessType: 'business',
    statusCode: '01',
    statusDesc: '核准設立',
    capitalAmount: 200000,
    paidInCapitalAmount: null,
    responsibleName: '吳小島',
    registeredAddress: '臺中市西區公益路77號',
    registerOrganization: '臺中市政府',
    setupDate: '2022-04-18',
    lastChangeDate: '2025-01-08',
    source: 'mock',
  },
  {
    businessAccountingNo: '90000004',
    businessName: '美好生活品牌有限公司',
    businessType: 'company',
    statusCode: '04',
    statusDesc: '解散',
    capitalAmount: 100000,
    paidInCapitalAmount: 100000,
    responsibleName: '張美好',
    registeredAddress: '高雄市前鎮區中山二路1號',
    registerOrganization: '高雄市政府',
    setupDate: '2025-02-10',
    lastChangeDate: '2026-01-15',
    source: 'mock',
  },
];

export function findMockBusinessProfile(query: {name?: string; taxId?: string}) {
  if (query.taxId) {
    return mockBusinessRegistry.find((item) => item.businessAccountingNo === query.taxId) ?? null;
  }

  const normalizedName = query.name?.replace(/股份有限公司|有限公司|商行|工作室/g, '').trim();
  if (!normalizedName) {
    return null;
  }

  return mockBusinessRegistry.find((item) => item.businessName.includes(normalizedName) || normalizedName.includes(item.businessName.replace(/股份有限公司|有限公司|商行|工作室/g, ''))) ?? null;
}
