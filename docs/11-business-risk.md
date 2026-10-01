# Business Risk Score

## Goal

Business Risk Score enriches customers with company/business registry data and converts it into a risk signal for Dashboard, Messages, Customers, and case cards. It is not a separate page.

## Data Source Strategy

MVP supports two providers:

- `mock`: local demo data.
- `gcis`: Taiwan GCIS open-data API lookup by tax id.

The app keeps mock fallback because Taiwan GCIS API integration may require usage notification and source IP allowlisting for stable production use.

Current real-data lookup is tax-id driven. Customer-name-only lookup is not reliable enough for the MVP, so Messages and Kanban provide a unified business number input before running business-risk lookup.

Future provider target:

- `data.gcis.nat.gov.tw` company registration APIs.
- Company lookup by tax id.
- Company keyword lookup by name.
- Business registration lookup by tax id/name when company data is unavailable.

Current GCIS test endpoint:

- Dataset: `公司登記基本資料-應用一`.
- Endpoint: `https://data.gcis.nat.gov.tw/od/data/api/5F64D864-61CB-4D0D-8AD9-492047CC1EA6`.
- Filter: `Business_Accounting_NO eq [8-digit tax id]`.

FindBiz is treated as a manual reference website, not the preferred system integration source.

## Current API

- `POST /api/business/enrich`
- `GET /api/business/risk-summary`

## Environment

```env
BUSINESS_REGISTRY_PROVIDER=mock
GCIS_COMPANY_PROFILE_ENDPOINT=https://data.gcis.nat.gov.tw/od/data/api/5F64D864-61CB-4D0D-8AD9-492047CC1EA6
```

Set `BUSINESS_REGISTRY_PROVIDER=gcis` to try the official GCIS provider. If GCIS lookup fails or returns no company record, the service falls back to mock lookup.

## Current Scoring

Base score: `50`.

Positive factors:

- Active registration status.
- Verified tax id.
- Capital amount above 1,000,000.
- Established for more than 3 years.

Negative factors:

- Inactive/dissolved/revoked status.
- Missing tax id.
- Low capital amount.
- Missing capital amount.
- Newly established business.
- Registry record not found.

Risk levels:

- `low`: score >= 80.
- `medium`: score >= 50 and < 80.
- `high`: score < 50.
- `unverified`: no registry match.

## UI Integration

- Dashboard shows risk distribution and average score.
- Messages page can enrich the latest extracted customer and show risk score inline.
- Kanban case modal shows the latest stored customer business risk score when available.
