# Zicket Developer Infrastructure API (BR-09 / Section 12)

Public, API-key-authenticated endpoints that let third-party Stellar apps,
event portals, and community tools query ticket validity, verify attendance
credentials, and check ticket ownership — without rebuilding Zicket's
ticketing infrastructure or requiring end-user login.

Base URL: `/api/v1/developer`

## Authentication

Every request must include the developer API key in the
`X-Zicket-API-Key` header:

```
GET /api/v1/developer/events/64f1.../tickets
X-Zicket-API-Key: zk_live_ab12cd34ef56_9f8e7d6c5b4a3928170695a4b3c2d1e0
```

- Keys are issued per organizer (see [Managing API keys](#managing-api-keys)
  below) and are scoped to that organizer's own events only — a key can
  never read or verify data belonging to another organizer's event, even if
  given a valid event/ticket id.
- The raw key is shown **exactly once**, at creation time. Zicket only ever
  stores a bcrypt hash of it — if it's lost, revoke it and issue a new one.
- Missing, malformed, unknown, revoked, or expired keys all return `401`.
- A key missing the permission scope a route requires returns `403`.

### Permission scopes

| Scope                | Required by                |
| -------------------- | -------------------------- |
| `tickets:read`       | `GET /events/:id/tickets`  |
| `tickets:verify`     | `POST /tickets/verify`     |
| `credentials:verify` | `POST /credentials/verify` |

A key is granted one or more scopes when it's created. By default a new key
gets all three.

## Rate limiting

Each API key has its own request budget, enforced with a Redis-backed
fixed-window counter (independent of the caller's IP, and independent of
other keys). Defaults (overridable per key):

- **Window:** 60 seconds (`DEVELOPER_API_RATE_LIMIT_WINDOW_MS`)
- **Max requests per window:** 60 (`DEVELOPER_API_RATE_LIMIT_MAX`)

Every response includes:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1735689600
```

Exceeding the budget returns `429`:

```json
{
  "status": 429,
  "message": "Developer API rate limit exceeded. Please slow down your requests.",
  "code": "DEVELOPER_RATE_LIMIT_EXCEEDED",
  "retryAfterMs": 15234
}
```

with a `Retry-After` header (seconds).

> **Resilience note:** if Redis is unreachable, the limiter fails **open**
> (requests are allowed and the incident is logged) rather than taking the
> whole public API down. This matches the resilience posture already used
> elsewhere in this codebase (e.g. `InventoryLockService`).

## Endpoints

### `GET /api/v1/developer/events/:id/tickets`

Query ticket availability for an event.

**Required scope:** `tickets:read`

```
GET /api/v1/developer/events/64f1a2b3c4d5e6f7a8b9c0d1/tickets
X-Zicket-API-Key: zk_live_...
```

```json
{
  "success": true,
  "data": {
    "eventId": "64f1a2b3c4d5e6f7a8b9c0d1",
    "name": "Stellar Meridian Meetup",
    "eventStatus": "upcoming",
    "eventDate": "2026-10-01T18:00:00.000Z",
    "totalTickets": 100,
    "availableTickets": 42,
    "soldTickets": 58,
    "ticketType": [
      {
        "ticketName": "General Admission",
        "quantity": 100,
        "currencyOrToken": "XLM",
        "price": 10
      }
    ]
  }
}
```

### `POST /api/v1/developer/tickets/verify`

Verify a ticket's state and ownership. **Read-only** — it does not mark
the ticket as used. (Marking a ticket used remains the organizer's
authenticated `POST /event-tickets/scan` flow inside the Zicket app; this
endpoint is for a third-party app to ask "is this ticket good?" before,
e.g., admitting someone at the door of an external check-in system.)

**Required scope:** `tickets:verify`

```
POST /api/v1/developer/tickets/verify
X-Zicket-API-Key: zk_live_...
Content-Type: application/json

{
  "ticketOrderId": "64f1a2b3c4d5e6f7a8b9c0d2",
  "eventId": "64f1a2b3c4d5e6f7a8b9c0d1"
}
```

`eventId` is optional — if provided, the ticket must belong to that event
or the request fails with `400`.

```json
{
  "success": true,
  "data": {
    "valid": true,
    "ticket": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "eventId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "eventName": "Stellar Meridian Meetup",
      "ticketType": "General Admission",
      "quantity": 1,
      "isUsed": false,
      "usedAt": null,
      "purchasedAt": "2026-08-01T12:00:00.000Z"
    }
  }
}
```

When `valid` is `false`, `data.reason` is one of:
`TICKET_NOT_COMPLETED` (purchase never completed) or
`TICKET_ALREADY_USED`.

### `POST /api/v1/developer/credentials/verify`

Verify a zkPassport-derived attendance credential (nullifier) for an
event, without exposing attendee identity — only confirms whether that
credential attended, mirroring the privacy model already used internally
(only an HMAC digest of the nullifier is ever compared/stored, never the
raw value).

**Required scope:** `credentials:verify`

```
POST /api/v1/developer/credentials/verify
X-Zicket-API-Key: zk_live_...
Content-Type: application/json

{
  "eventId": "64f1a2b3c4d5e6f7a8b9c0d1",
  "nullifier": "1234567890"
}
```

```json
{
  "success": true,
  "data": {
    "verified": true,
    "eventId": "64f1a2b3c4d5e6f7a8b9c0d1",
    "attendedAt": "2026-10-01T18:32:11.000Z",
    "onChainTxHash": "abcd1234..."
  }
}
```

## Error format

All errors share the shape used across the rest of the API:

```json
{
  "status": 401,
  "message": "Invalid API key",
  "code": "UNAUTHORIZED"
}
```

| Status | Code                            | Meaning                                                |
| ------ | ------------------------------- | ------------------------------------------------------ |
| 400    | `VALIDATION_ERROR`              | Malformed request body/params                          |
| 401    | `UNAUTHORIZED`                  | Missing/invalid/revoked/expired API key                |
| 403    | `FORBIDDEN`                     | Key lacks the required scope, or doesn't own the event |
| 404    | `NOT_FOUND`                     | Event/ticket not found                                 |
| 429    | `DEVELOPER_RATE_LIMIT_EXCEEDED` | Per-key rate limit exceeded                            |
| 503    | `SERVICE_UNAVAILABLE`           | Credential verification temporarily unavailable        |

## Managing API keys

Organizers manage their own keys via the normal authenticated (JWT)
account API — these are **not** part of the public `/api/v1/developer/*`
surface:

- `POST /account/developer-keys` — create a key. Body: `{ "name": "...", "permissions"?: [...], "rateLimit"?: { "windowMs": ..., "maxRequests": ... } }`. Response includes the raw key **once**.
- `GET /account/developer-keys` — list the organizer's keys (masked).
- `DELETE /account/developer-keys/:id` — revoke a key (idempotent).

Example:

```
POST /account/developer-keys
Authorization: Bearer <organizer JWT>
Content-Type: application/json

{ "name": "Acme Event Portal — Production" }
```

```json
{
  "success": true,
  "data": {
    "id": "64f1a2b3c4d5e6f7a8b9c0e0",
    "name": "Acme Event Portal — Production",
    "apiKey": "zk_live_ab12cd34ef56_9f8e7d6c5b4a3928170695a4b3c2d1e0",
    "maskedKey": "zk_live_ab12cd34ef56…",
    "permissions": ["tickets:read", "tickets:verify", "credentials:verify"],
    "rateLimit": { "windowMs": 60000, "maxRequests": 60 },
    "createdAt": "2026-08-29T12:00:00.000Z"
  }
}
```

## Implementation notes for reviewers

- `src/models/developer-key.ts` — `DeveloperApiKey` schema: hashed key,
  non-secret lookup prefix, permissions, per-key rate limit override,
  status, timestamps.
- `src/utils/developer-api-key.ts` — key generation (`zk_live_<prefix>_<secret>`),
  prefix extraction, bcrypt hashing/verification.
- `src/middlewares/developer-auth.middleware.ts` — `X-Zicket-API-Key`
  validation + scope enforcement; attaches `req.developer`.
- `src/services/developer-rate-limit.service.ts` +
  `src/middlewares/developer-rate-limit.middleware.ts` — Redis fixed-window
  limiter per API key (reuses the existing `redisConfig` from
  `src/config/queue.ts`, same connection the queue/worker system already
  uses).
- `src/services/developer-api.service.ts` — business logic; every method
  asserts the calling key's organizer owns the target event before
  returning anything.
- `src/routes/developer.route.ts` — mounted at `/api/v1/developer` in
  `src/app.ts`.
- `src/services/developer-key.service.ts` +
  `src/controllers/developer-key.controller.ts` — organizer-facing key
  issuance/listing/revocation, wired into `src/routes/account.route.ts`
  behind the existing `authGuard` (JWT). Added beyond the original
  proposed steps because the public API is otherwise impossible to
  provision or test end-to-end.

## Tests

- `tests/developer-auth.middleware.test.ts` — missing/malformed/unknown/
  revoked/expired keys, bcrypt mismatch, missing scope, happy path.
- `tests/developer-rate-limit.service.test.ts` — window/limit accounting
  and fail-open behavior on Redis errors.
- `tests/developer.route.test.ts` — end-to-end route wiring (401/403/429/
  200/400) via supertest against the real Express app.
- `tests/developer-api.service.test.ts` — organizer-ownership checks and
  the three verification flows.
- `tests/developer-key.service.test.ts` — key creation, listing, and
  idempotent revocation.
