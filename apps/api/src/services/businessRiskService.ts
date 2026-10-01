import type {BusinessProfile, BusinessRiskFactor, BusinessRiskScore} from '@casebee/shared';
import {findMockBusinessProfile} from '../data/mockBusinessRegistry.js';
import {createBusinessRiskScore, getBusinessRiskSummary, upsertBusinessProfile} from '../repositories/businessRepository.js';
import {findOrCreateCustomer} from '../repositories/customersRepository.js';
import {findGcisBusinessProfile} from './gcisBusinessRegistryProvider.js';

function clampScore(score: number) {
  return Math.max(0, Math.min(100, score));
}

function riskLevelFromScore(score: number): BusinessRiskScore['riskLevel'] {
  if (score >= 80) {
    return 'low';
  }
  if (score >= 50) {
    return 'medium';
  }
  return 'high';
}

function yearFromDateText(dateText: string | null) {
  if (!dateText) {
    return null;
  }
  const year = Number(dateText.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

export function calculateBusinessRisk(profile: BusinessProfile): Omit<BusinessRiskScore, 'id' | 'calculatedAt'> {
  let score = 50;
  const positiveFactors: BusinessRiskFactor[] = [];
  const negativeFactors: BusinessRiskFactor[] = [];

  const addFactor = (target: BusinessRiskFactor[], type: string, label: string, scoreDelta: number) => {
    target.push({type, label, scoreDelta});
    score += scoreDelta;
  };

  if (profile.statusDesc?.includes('核准') || profile.statusCode === '01') {
    addFactor(positiveFactors, 'active_status', '登記狀態正常', 20);
  } else if (profile.statusDesc?.includes('解散') || profile.statusDesc?.includes('廢止') || profile.statusDesc?.includes('撤銷')) {
    addFactor(negativeFactors, 'inactive_status', `登記狀態為${profile.statusDesc}`, -45);
  } else {
    addFactor(negativeFactors, 'unknown_status', '登記狀態不明', -15);
  }

  if (profile.businessAccountingNo) {
    addFactor(positiveFactors, 'tax_id_verified', '統一編號可驗證', 10);
  } else {
    addFactor(negativeFactors, 'missing_tax_id', '尚未取得統一編號', -10);
  }

  if (profile.capitalAmount !== null && profile.capitalAmount >= 1000000) {
    addFactor(positiveFactors, 'capital_sufficient', '資本額高於 100 萬', 10);
  } else if (profile.capitalAmount !== null && profile.capitalAmount < 200000) {
    addFactor(negativeFactors, 'low_capital', '資本額偏低', -10);
  } else if (profile.capitalAmount === null) {
    addFactor(negativeFactors, 'missing_capital', '缺少資本額資料', -5);
  }

  const setupYear = yearFromDateText(profile.setupDate);
  const currentYear = new Date().getFullYear();
  if (setupYear && currentYear - setupYear >= 3) {
    addFactor(positiveFactors, 'stable_age', '成立超過 3 年', 10);
  } else if (setupYear && currentYear - setupYear < 1) {
    addFactor(negativeFactors, 'new_business', '成立未滿 1 年', -8);
  }

  const finalScore = clampScore(score);
  return {
    customerId: profile.customerId,
    businessProfileId: profile.id,
    score: finalScore,
    riskLevel: riskLevelFromScore(finalScore),
    positiveFactors,
    negativeFactors,
  };
}

export async function enrichBusinessRisk(input: {customerName: string; taxId?: string; customerId?: string | null}) {
  const customer = input.customerId
    ? null
    : await findOrCreateCustomer({name: input.customerName, platform: 'Manual', contactHandle: input.taxId ?? input.customerName});
  const customerId = input.customerId ?? customer?.id ?? null;
  const provider = process.env.BUSINESS_REGISTRY_PROVIDER ?? 'mock';
  const gcisRecord = provider === 'gcis' ? await findGcisBusinessProfile({taxId: input.taxId}).catch(() => null) : null;
  const registryRecord = gcisRecord ?? findMockBusinessProfile({name: input.customerName, taxId: input.taxId});
  const providerName = gcisRecord ? 'gcis' : 'mock';

  if (!registryRecord) {
    const riskScore = await createBusinessRiskScore({
      customerId,
      businessProfileId: null,
      score: 35,
      riskLevel: 'unverified',
      positiveFactors: [],
      negativeFactors: [{type: 'not_found', label: '查無商工登記資料，建議索取統編或人工確認', scoreDelta: -25}],
    });
    return {profile: null, riskScore, provider: providerName};
  }

  const profile = await upsertBusinessProfile({...registryRecord, customerId, rawPayload: registryRecord});
  const riskScore = await createBusinessRiskScore(calculateBusinessRisk(profile));
  return {profile, riskScore, provider: providerName};
}

export {getBusinessRiskSummary};
