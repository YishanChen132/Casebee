# Architecture

## Target Architecture

Casebee uses a React frontend, Node.js/Express backend, PostgreSQL database, Gmail OAuth/API integration, demo/manual message import, and an AI analysis layer. LINE remains a future integration and is not part of the short-term real-data scope.

## Data Flow

1. Gmail, demo import, or manual import receives a client message.
2. Backend normalizes the platform event into a unified message format.
3. AI extraction identifies client, project item, amount, deadline, intent, and missing fields.
4. The case service creates or updates a case record.
5. The rule engine checks reply delay, deadline risk, and missing information.
6. The frontend displays cases, messages, alerts, and AI suggestions.

## MVP Priority

- Gmail API polling through OAuth.
- Demo/manual message import as the reliable fallback path.
- PostgreSQL-backed cases and messages.
- AI JSON extraction.
- Rule-based alerts.
- Frontend board and message analysis pages.
- LINE webhook persistence and signature verification are deferred.
