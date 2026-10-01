# Deployment

## Recommended Host Environment

- Ubuntu 22.04 or 24.04 LTS.
- Docker and Docker Compose.
- Caddy or Nginx for HTTPS reverse proxy.
- Cloudflare Tunnel or a real domain for Gmail OAuth callback in hosted demos.

## Target Services

- `web`: React frontend.
- `api`: Node.js/Express backend.
- `postgres`: PostgreSQL database.

## Notes

- WSL is acceptable for development, but not recommended as the final always-on host.
- Gmail hosted OAuth requires a public HTTPS callback URL. Local OAuth can use `http://localhost:4000/api/integrations/gmail/callback`.
- LINE real webhook integration is deferred from short-term scope.
- Keep secrets in `.env`; never commit API keys or OAuth secrets.

## Secrets Checklist

- `DATABASE_URL`: required for API and scripts.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`: required only for real Gmail OAuth.
- `AI_PROVIDER`: use `rule` for offline demo stability; use `openai` or `gemini` only with valid API keys.
- `BUSINESS_REGISTRY_PROVIDER`: use `mock` for reliable demo, `gcis` for tax-id trial lookup.
- `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN`: reserved for future LINE work; not required for short-term demo.

## Current Local Commands

```bash
npm install
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev:api
npm run dev:web
```

Use separate terminals for `dev:api` and `dev:web` during development.

## PostgreSQL

The default local database URL is:

```text
postgresql://casebee:casebee@localhost:5432/casebee
```

This matches the `postgres` service in `docker-compose.yml`.

## Gmail OAuth

For local Gmail OAuth testing, configure Google Cloud redirect URI as:

```text
http://localhost:4000/api/integrations/gmail/callback
```

For host deployment, replace it with the public HTTPS callback URL.
