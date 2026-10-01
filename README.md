# Casebee

Casebee is a message-driven case management system for freelancers. It turns Gmail, manual, and demo messages into manageable case records, then supports AI extraction, reply suggestions, rule-based alerts, business-risk checks, RAG similar cases, and a visual case board.

## Current Goal

- Build an operable MVP in two weeks.
- Prepare a stable demo version within one month.
- Use `school/Ifm/frontend` as the UI style reference.
- Prioritize Gmail as the near-term real data source.
- Keep LINE as a future integration. The current LINE endpoint is a placeholder and is not part of the short-term demo scope.

## MVP Status

- Demo-ready MVP: roughly 85% complete, excluding Gmail real-account verification.
- Production-stable version: roughly 60% complete.
- Short-term focus: Gmail verification, demo rehearsal, deployment checklist, and test coverage.
- Deferred from short-term scope: real LINE webhook verification, event persistence, and signature validation.

## Documentation

- `docs/01-architecture.md`: system architecture and data flow.
- `docs/02-development-log.md`: major change records.
- `docs/03-deployment.md`: local, host, and Docker deployment notes.
- `docs/04-api-contract.md`: frontend/backend API contract.
- `docs/05-database-schema.md`: database schema notes.
- `docs/06-integration-line.md`: LINE Messaging API setup.
- `docs/07-integration-gmail.md`: Gmail API setup.
- `docs/08-ai-rag-rules.md`: AI extraction, RAG, and rule engine notes.
- `docs/09-testing-report.md`: testing metrics and validation records.
- `docs/10-demo-script.md`: demo checklist and backup flow.
- `docs/11-business-risk.md`: business registry enrichment and risk score design.
- `docs/12-mvp-delivery-checklist.md`: current remaining work, demo readiness, deployment/secrets checklist, and test plan.

## Change Rule

After every major change, update `docs/02-development-log.md`. Also update the relevant document when the change affects API, database, deployment, integrations, AI, or demo flow.

## Project Structure

```text
apps/
  api/      Express backend
  web/      React frontend
packages/
  shared/   Shared TypeScript types
database/
  migrations/
  seed/
docs/
```

## Local Development

```bash
npm install
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev:api
npm run dev:web
```

Default URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:4000`
- Health check: `http://localhost:4000/api/health`

## Environment

Copy `.env.example` to `.env` before enabling real integrations. Do not commit real API keys, OAuth secrets, or channel tokens.

AI extraction can be switched with `AI_PROVIDER=rule`, `AI_PROVIDER=openai`, or `AI_PROVIDER=gemini`.

## Demo Verification

Run before every demo:

```bash
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run type-check
npm run build
npm run smoke
npm audit --omit=dev
```
