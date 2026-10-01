# MVP Delivery Checklist

## Short-Term Scope

- Gmail is the only near-term real external message source.
- Demo/manual import remains the reliable fallback path.
- LINE real webhook integration is deferred to a future version.
- The short-term demo should not claim LINE event persistence, signature validation, or real channel sync.

## Ten Work Items

1. Complete Gmail OAuth real-account authorization and polling verification. Completed locally on 2026-08-16.
2. Run one full demo rehearsal using Gmail if available, otherwise demo import.
3. Confirm Settings -> Messages -> Kanban -> Customers -> Settings flow is smooth.
4. Verify business-risk lookup works from Messages and Kanban case modal.
5. Verify alert resolve flow shows handled timestamps in Kanban case modal.
6. Verify RAG example create/deactivate works from Settings.
7. Add API integration tests for core endpoints.
8. Add pipeline tests for message import, AI extraction, case creation, alerts, and RAG suggestions.
9. Prepare deployment/secrets checklist for the demo environment.
10. Finalize README, demo script, testing report, and known limitations.

## Demo-Ready Command Checklist

Run before each rehearsal or demo:

```bash
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run type-check
npm run build
npm run smoke
npm audit --omit=dev
```

Run local services in separate terminals:

```bash
npm run dev:api
npm run dev:web
```

## Gmail OAuth Verification Checklist

- Confirm `.env` has `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`.
- Confirm Google Cloud OAuth redirect URI equals `http://localhost:4000/api/integrations/gmail/callback` for local testing.
- Restart `npm run dev:api` after changing `.env`.
- Open Settings and confirm Gmail shows configured.
- Click `連接 Gmail` and complete OAuth.
- Return to Settings and click `重新整理狀態`.
- Click `同步 Gmail`.
- Confirm imported/skipped/failed counts are shown.
- Open Messages and confirm imported Gmail messages are visible.
- Open Kanban and confirm generated cases are visible.

Current local verification status: completed. Gmail API must be enabled in Google Cloud before polling succeeds.

## Deployment And Secrets Checklist

- Keep `.env` out of source control.
- Use `AI_PROVIDER=rule` for stable offline demos unless an API key is intentionally tested.
- Use `BUSINESS_REGISTRY_PROVIDER=mock` for deterministic demos; use `gcis` only when tax-id lookup is needed.
- Use HTTPS public callback only for hosted Gmail OAuth demos.
- Do not configure LINE secrets for the short-term demo unless LINE work is explicitly restarted.

## Test Plan Outline

- API integration tests: health, cases, customer detail, messages, rules status, RAG examples, business risk.
- Message pipeline tests: manual import creates message, extraction, customer, case, alerts, and similar cases.
- Gmail tests: status shape, OAuth URL generation, polling error state when not connected, deduplication with known Gmail message id.
- RAG tests: create active example, deactivate example, ensure inactive examples are excluded from matching.
- Alert tests: create alert, resolve alert, preserve handled timestamp.

## MVP Limitations

- Gmail real-account verification is complete locally. For polished demos, use a narrower `GMAIL_POLL_QUERY` if mailbox noise is distracting.
- LINE webhook is placeholder-only.
- Rule scheduling is manual from Settings.
- RAG supports create/deactivate but not full editing.
- There is no authentication, authorization, or multi-user separation yet.
- There are no formal E2E tests yet.
