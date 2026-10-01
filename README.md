# Casebee

Casebee 是為自由工作者設計的訊息驅動案件管理系統。它可以把 Gmail、手動輸入與 demo 訊息整理成可追蹤的案件，並支援 AI 欄位萃取、回覆建議、規則警示、商業風險檢查、RAG 相似案件輔助，以及視覺化案件看板。

## 目前目標

- 兩週內完成可操作的 MVP。
- 一個月內準備穩定 demo 版本。
- UI 風格參考 `school/Ifm/frontend`。
- 近期優先以 Gmail 作為真實資料來源。
- LINE 保留為後續整合項目；目前 LINE endpoint 是 placeholder，不屬於短期 demo 範圍。

## MVP 狀態

- Demo-ready MVP：約 85% 完成，不含 Gmail 真實帳號驗證。
- Production-stable 版本：約 60% 完成。
- 短期重點：Gmail 驗證、demo 彩排、部署檢查清單、測試覆蓋。
- 短期暫緩：真實 LINE webhook 驗證、事件持久化、signature validation。

## 功能摘要

- 案件管理：從訊息建立案件，追蹤客戶、預算、交期、狀態與缺漏欄位。
- Gmail 匯入：支援 Gmail OAuth 與 thread-aware 案件合併。
- AI 萃取：支援 rule-based、OpenAI、Gemini provider，失敗時可 fallback。
- RAG 輔助：以相似案件補強專案項目與常見缺漏欄位判斷。
- 規則警示：支援缺漏欄位、交期風險、逾時未回覆、低預算、scope change 等 alerts。
- 人工審核：當 thread reanalysis 偵測到衝突欄位時，保留原值並建立 review workflow。
- 商業風險：可用公司登記資料與 mock registry 補強客戶風險判斷。
- 前端看板：提供 Dashboard、Kanban、Messages、Customers、Settings 頁面。

## 文件索引

- `docs/01-architecture.md`：系統架構與資料流。
- `docs/02-development-log.md`：主要開發紀錄。
- `docs/03-deployment.md`：本機、主機與 Docker 部署說明。
- `docs/04-api-contract.md`：前後端 API contract。
- `docs/05-database-schema.md`：資料庫 schema 說明。
- `docs/06-integration-line.md`：LINE Messaging API 設定。
- `docs/07-integration-gmail.md`：Gmail API 設定。
- `docs/08-ai-rag-rules.md`：AI 萃取、RAG 與 rule engine 規則。
- `docs/09-testing-report.md`：測試指標與驗證紀錄。
- `docs/10-demo-script.md`：demo 流程與備援腳本。
- `docs/11-business-risk.md`：商業登記補強與風險分數設計。
- `docs/12-mvp-delivery-checklist.md`：剩餘工作、demo readiness、部署與 secrets 檢查。
- `docs/13-accuracy-error-analysis-day-9-2c-1.md`：AI accuracy 與 fixture contract 分析。

## 專案結構

```text
apps/
  api/      Express 後端
  web/      React 前端
packages/
  shared/   前後端共用 TypeScript 型別
database/
  migrations/
  seed/
docs/
```

## 本機開發

```bash
npm install
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev:api
npm run dev:web
```

預設網址：

- Web：`http://localhost:5173`
- API：`http://localhost:4000`
- Health check：`http://localhost:4000/api/health`

## 環境變數

啟用真實整合前，先複製 `.env.example` 成 `.env`。

```bash
cp .env.example .env
```

不要 commit 真實 API keys、OAuth secrets、LINE channel tokens 或任何 production secrets。

AI 萃取 provider 可透過 `AI_PROVIDER` 切換：

- `AI_PROVIDER=rule`
- `AI_PROVIDER=openai`
- `AI_PROVIDER=gemini`

## 常用指令

```bash
npm run dev:api
npm run dev:web
npm run db:migrate
npm run db:seed
npm run type-check
npm run build
npm run smoke
npm run accuracy
```

## Demo 前驗證

每次 demo 前建議執行：

```bash
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run type-check
npm run build
npm run smoke
npm audit --omit=dev
```

## 變更規則

每次重大變更後，請更新 `docs/02-development-log.md`。如果變更影響 API、database、deployment、integrations、AI 或 demo flow，也要同步更新對應文件。
