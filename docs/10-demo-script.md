# Demo Script

## Demo Checklist

- Backend is running.
- Frontend is running.
- PostgreSQL is running.
- `npm run db:migrate` has completed.
- `npm run db:seed` has completed.
- `npm run smoke` passes.
- Gmail OAuth credentials are configured if showing real Gmail data.
- AI API key is optional because rule-based fallback is available.
- Backup mock messages are available.

## Demo Flow

1. Open Settings and show Gmail connection status.
2. If credentials are configured, connect or sync Gmail from Settings.
3. Open Messages and show the unified message stream.
4. Use manual/demo import if real Gmail data is unavailable.
5. Show AI extraction, rule alerts, RAG similar cases, business-risk lookup, and reply draft.
6. Open Kanban and show the generated case card in the 5-phase board.
7. Drag the case card to update status.
8. Open the centered case modal.
9. Edit status, quote amount, expected deadline, and summary.
10. Run business-risk lookup from the case modal if not already available.
11. Open Customers and show customer summaries, active case counts, and risk counts.
12. In the case modal, mark one alert as handled and show the handled timestamp.
13. Return to Settings and show RAG knowledge-base management plus manual rule execution.
14. Add one RAG example or deactivate a low-quality example to demonstrate tuning.

## Backup Demo Flow Without Gmail Data

1. Open the Messages page.
2. Click `一鍵匯入模擬資料`.
3. Confirm imported and skipped counts.
4. Show the latest AI extraction fields.
5. Show generated rule alerts.
6. Show RAG similar historical cases and explain how they support reply suggestions.
7. Open the Kanban page and confirm new cases appear in status columns.
8. Open a case modal and edit quote/deadline/status.
9. Run business-risk lookup from the case modal.
10. Mark one alert as handled.
11. Open Customers and show that imported/demo messages created customer summaries.
12. Return to Settings and show rule threshold, manual mode, and RAG enable/disable management.
13. Explain that the same pipeline is used for Gmail messages and future LINE webhook messages.

## Rehearsal Path

Use this order for a complete no-Gmail rehearsal:

1. Settings: show Gmail configured/connected state and LINE marked as future setup.
2. Messages: click `一鍵匯入模擬資料`.
3. Messages: explain AI extraction, rule alerts, similar cases, business-risk lookup, and reply draft.
4. Kanban: open the created case, edit fields, run business-risk lookup, and mark an alert handled.
5. Customers: open a customer detail modal and show cases/messages/business-risk context.
6. Settings: run rules manually, show current threshold/manual mode, add or deactivate one RAG example.

## Gmail OAuth Waiting Notes

- If Google Console settings were just saved, OAuth redirect/origin changes may take several minutes to become active.
- Settings should show OAuth configured before connecting Gmail.
- If Gmail is configured but not connected, use demo import as fallback while waiting for Google OAuth propagation.

## LINE Scope

- LINE webhook route currently acknowledges received events only.
- Do not present LINE as a real integration in demo unless channel secret/access token verification and event persistence are implemented.

## Verification Commands

Run before demo:

```bash
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run type-check
npm run build
npm run smoke
npm audit --omit=dev
```
