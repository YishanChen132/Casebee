# LINE Integration

## Current Scope

LINE real integration is removed from the short-term plan. The current endpoint only acknowledges webhook payloads and should not be demoed as a real connected channel.

## Future Goal

Receive real LINE messages through LINE Messaging API webhook and convert them into Casebee message events.

## Required Settings

- LINE Developers provider.
- Messaging API channel.
- Channel secret.
- Channel access token.
- Public HTTPS webhook URL.

## Webhook URL

`https://<domain>/api/webhooks/line`

## Deferred Work

- Verify LINE request signatures with `LINE_CHANNEL_SECRET`.
- Parse LINE message events.
- Persist LINE messages into `messages`.
- Route LINE messages through the same message-to-case pipeline used by Gmail/demo/manual import.
- Add retry/error handling and operational logs.
