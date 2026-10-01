# Gmail Integration

## Goal

Use Gmail OAuth and Gmail API to read real email messages and convert them into Casebee message events.

## MVP Approach

- Use OAuth 2.0 authorization.
- Poll Gmail messages periodically.
- Use Gmail Push Notifications later if time allows.

## Implemented Endpoints

- `GET /api/integrations/gmail/status`
- `GET /api/integrations/gmail/auth`
- `GET /api/integrations/gmail/callback`
- `POST /api/integrations/gmail/poll`

## Required Settings

- Google Cloud project.
- Gmail API enabled.
- OAuth consent screen.
- OAuth client ID and client secret.
- Redirect URI.

If polling returns `Gmail API has not been used ... or it is disabled`, open the Gmail API page for the Google Cloud project, enable `gmail.googleapis.com`, wait a few minutes, and retry polling.

## Environment Variables

```text
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4000/api/integrations/gmail/callback
GMAIL_POLL_QUERY=newer_than:30d
GMAIL_POLL_MAX_RESULTS=10
GMAIL_AUTO_POLL_ENABLED=true
GMAIL_AUTO_POLL_INTERVAL_SECONDS=60
```

The API loads environment variables from the current working directory `.env` and the workspace root `.env`, so workspace scripts such as `npm run dev:api` can read the root project credentials.

## Current Polling Behavior

The polling endpoint reads recent Gmail messages using `GMAIL_POLL_QUERY`, extracts sender, subject, and plain text body, then imports each message through the standard Casebee message-to-case pipeline.

Before import, Casebee runs a lightweight Gmail triage classifier. Only `case_candidate` messages enter the message-to-case pipeline.

The API server starts a background Gmail polling scheduler by default when Gmail is configured and connected. The scheduler checks Gmail every `GMAIL_AUTO_POLL_INTERVAL_SECONDS` seconds, skips overlapping runs, and uses the same deduplication/triage/exclusion pipeline as manual polling. Set `GMAIL_AUTO_POLL_ENABLED=false` to disable it.

For messages that pass triage, Casebee also infers a cleaner customer name before creating a customer/case. The inference uses:

- Known aliases for noisy sender accounts.
- Organization names in subject/body/signature text.
- Display-name cleanup rules that remove department/account suffixes such as `企劃部` and `第二帳號`.
- Email local-part fallback only when no better organization name is found.

Example: `fupin.mp2企劃部第二帳號 <fupin.mp2@gmail.com>` with `富品盃` context is inferred as `富品建設`.

Default query: `newer_than:30d`.

Default max results: `10`.

## Deduplication

Before importing a Gmail message, Casebee checks whether `messages.raw_payload.gmailMessageId` already exists. Existing messages are skipped and returned in the `skipped` array.

Polling response includes:

- `checkedCount`
- `importedCount`
- `skippedCount`
- `emptyCount`
- `failedCount`
- `query`
- `imported`
- `skipped`
- `failed`

Skipped items include a `category` and `reason` so Settings can explain why a message was not imported.

## Gmail Triage Categories

- `case_candidate`: likely customer/project related and imported.
- `duplicate`: already imported Gmail message id.
- `verification_code`: OTP, security code, or login verification.
- `calendar_invite`: Google Calendar or meeting invite.
- `automated_notification`: no-reply/system notification.
- `newsletter`: newsletter, EDM, unsubscribe-style marketing mail.
- `announcement`: competition, event, announcement, or registration broadcast.

This is intentionally conservative for MVP demo quality. Existing imported Gmail records are not deleted automatically; cleanup should be a separate user-approved action.

## Settings UI

Gmail authorization and polling controls live in Settings, not in Messages. Settings shows:

- OAuth environment status.
- Connection status and account email.
- Redirect URI.
- Last sync or latest sync result.
- Connect, refresh status, and sync actions.

## Messages UI

The Messages page no longer shows the generic pipeline banner. It shows a Gmail triage assistant instead:

- Sync and classify Gmail from the workspace.
- Refresh visible messages automatically while the Messages page is open.
- Jump to Gmail-only messages.
- Use demo import as fallback.
- Expand the current filtering standard so users understand why messages are imported or skipped.
- Exclude an unrelated Gmail message after import by selecting a reason. Exclusion is soft: the message is hidden from normal lists, and if its generated case has no other active messages, that case is hidden too.

## Manual Exclusion

Imported Gmail messages may still be noisy. Users can exclude a selected Gmail message from the Messages page.

When a Gmail message is excluded, Casebee learns a sender-email exclusion rule. Future Gmail polls skip messages from the same sender before they enter the message-to-case pipeline.

Current exclusion reasons:

- Not customer/case related.
- Newsletter or marketing email.
- Event announcement or competition notice.
- System notification or verification code.
- Calendar or meeting invite.

Learned skips are returned as `learned_exclusion` in the Gmail polling response.

Excluded records are retained with `excluded_at` and `excluded_reason`; they are not deleted automatically.

## 2026-08-16 Real OAuth Test

- OAuth connection succeeded with a real Gmail account.
- Initial poll succeeded after enabling Gmail API in Google Cloud.
- Follow-up poll checked 10 messages, imported 0, skipped 10, failed 0, confirming deduplication.
- Imported Gmail messages appeared in Messages, Cases, and Customers APIs.
