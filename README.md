# Gather

A JavaScript MERN application for photo-first social networking. React and Vite provide the UI; Express runs one modular backend; Mongoose connects to MongoDB. Signup, login, session restoration, basic own-profile editing and logout now use the real backend. The homepage feed remains a clearly labelled design preview.

## Account flow

The current flow is **create account → enter the homepage → edit your profile → log out → log in again**. Refresh restores a valid session from MongoDB.

Email verification is intentionally omitted at the product owner's request. Registration returns `201`, creates an active account and signs the member in immediately. Email addresses are used as login identities; the application does not claim they have been verified. Verification, email delivery and password recovery are not implemented.

- Signup accepts a display name, username, email and password. Emails and usernames are normalized and protected by unique indexes. Passwords require 15–128 Unicode characters, at most 512 UTF-8 bytes, and are never trimmed or silently truncated.
- Passwords use salted scrypt hashes. Password work is bounded to two concurrent operations; an overloaded backend returns a safe `503`.
- Sessions are opaque random tokens. Only token hashes are stored in MongoDB. The browser receives a `__Host-session` cookie with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` and no `Domain`. Session tokens never enter localStorage.
- Sessions expire absolutely after seven days. Each authenticated request rechecks expiry, revocation, the user's `authVersion` and account state. TTL indexes only clean up expired records.
- Signup creates the user, session and default Saved collection in one transaction. Basic profile editing updates only the authenticated member's display name, username and bio. Logout revokes the presented session and clears its cookie.
- Profile saves include `X-Account-Id`, captured from the account that opened the form. The backend compares it with the session owner before writing; a missing or changed account returns `409 ACCOUNT_CHANGED`. Logout also checks this precondition when supplied, so an old tab cannot sign another account out.
- Tabs revalidate the shared session after authentication changes and on focus. A different account gets a fresh profile form; same-account drafts stay intact. Delayed refreshes cannot overwrite a profile save that has already succeeded.

The implemented routes under `/api/v1` are:

| Method and path | Result |
| --- | --- |
| `GET /auth/csrf` | Session-bound CSRF token and cookie |
| `POST /auth/register` | `201` with account data and a session cookie |
| `POST /auth/login` | Account data and a new session cookie |
| `GET /me` | Current account identity |
| `PATCH /me/profile` | Updated own profile |
| `POST /auth/logout` | Idempotent `204`; clears the presented session |

## Local setup

Use Node.js **22.13+ within major 22**, or **24.x**, and npm **10+**. `.nvmrc` selects major 22. Run commands from the repository root. Windows commands use `npm.cmd` because this machine blocks PowerShell's `npm.ps1`; use `npm` in other shells.

```powershell
npm.cmd ci
if (!(Test-Path -LiteralPath backend/.env)) { Copy-Item -LiteralPath backend/.env.example -Destination backend/.env }
if (!(Test-Path -LiteralPath frontend/.env)) { Copy-Item -LiteralPath frontend/.env.example -Destination frontend/.env }
```

Edit the local, Git-ignored `backend/.env`:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Development MongoDB URI, including a dedicated database name such as `gather_dev` |
| `AUTH_SECRET` | Required 64 random hexadecimal characters; retain it across restarts |
| `APP_ORIGIN` | Exact browser origin; `http://localhost:5173` for local development, HTTPS in production |
| `NODE_ENV` | `development` by default; also accepts `test` and `production` |
| `HOST` | Backend bind address, default `127.0.0.1` |
| `PORT` | Backend port, default `3000` |

Generate an `AUTH_SECRET` once and copy its output into the local `.env`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use an Atlas development database or a local replica set with transaction support. A standalone MongoDB server is insufficient for atomic signup. Keep development and production data separate. Credentials stay in backend configuration; every `VITE_*` variable is public browser code. `VITE_API_BASE_URL` defaults to `/api/v1` and normally needs no change.

Run the explicit database migration before starting the backend:

```powershell
npm.cmd run db:migrate
```

Migration `001-auth` creates collection validators, unique identity/session/default-collection indexes and the session TTL index. It records its completion in `schema_migrations` and is safe to rerun. It does not delete or repair existing data; duplicate identities or conflicting indexes must be resolved deliberately. The backend refuses to start before the migration is recorded. Automatic Mongoose collection/index creation remains disabled.

Start these commands in separate terminals:

```powershell
npm.cmd run dev:backend
```

```powershell
npm.cmd run dev:frontend
```

Open **`http://localhost:5173`** in Chrome or Firefox, using `localhost` rather than the backend's `127.0.0.1` address. Development relies on these browsers accepting Secure cookies on localhost; Safari requires an HTTPS development origin. The cookies retain their Secure attributes in every environment. Production and any non-localhost browser origin require HTTPS.

Vite proxies `/api` and `/health` to `http://127.0.0.1:3000`. If the backend address changes, update that proxy. Both servers are required for the account flow. Native Node environment loading resolves `backend/.env` regardless of the working directory; existing process variables take precedence. Stop foreground servers with Ctrl+C. `npm.cmd start` runs the backend without watch mode.

## Browser security and deployment

Keep browser and API requests on one origin through the development proxy or a hosting reverse proxy. No CORS policy is enabled for separate origins. Every unsafe API request requires the exact configured `Origin`, `X-App-Request: web`, and a valid signed CSRF token that matches its HttpOnly cookie and current session. The JSON client fetches and caches CSRF tokens in memory and refreshes them after authentication changes. Bootstrap reuses an existing valid session-bound CSRF cookie so tabs do not invalidate one another's retries. CSRF rejection may be retried once before a mutation executes, preserving the original account precondition; account conflicts and network failures do not trigger automatic mutation retries.

The bounded rate limiter is in memory and local to one backend process. Signup permits 10 attempts per IP per hour; login permits 30 per IP and 10 per normalized email per 15 minutes. Other mutations permit 120 per IP per minute. Limits reset when the process restarts and are not shared across multiple instances. `429` responses include `Retry-After`.

Express currently uses the socket address for `req.ip`. Before deployment behind a reverse proxy, configure trusted proxy addresses or hops for that specific topology so client IP limits remain meaningful. Do not blindly trust arbitrary `X-Forwarded-For` headers. Multiple-instance deployment also needs a deliberate shared limiting strategy.

## Validation and health

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Tests cover safe HTTP errors, compressed JSON, configuration, normalized Unicode names, signup validation, password hashing, concurrent-tab CSRF/origin checks, account-bound writes, cookie attributes and session/profile behavior. `npm.cmd test` skips live database checks unless `TEST_MONGODB_URI` is present in the test process.

To exercise real MongoDB transactions and session behavior using local backend configuration:

```powershell
npm.cmd run test:integration
```

This runner loads `backend/.env` and uses `TEST_MONGODB_URI` when already set, otherwise `MONGODB_URI`. The connection user must be allowed to create and drop a randomly named `gather_auth_test_<random>` database. Auth tests migrate that isolated database, exercise writes and clean up only that database. They do not write to the application database named in the URI. The separate database readiness test only connects, pings and closes. A failed cleanup can leave the isolated test database for manual inspection.

| Endpoint | Result |
| --- | --- |
| `GET /health/live` | `200 {"status":"ok"}` while HTTP is serving |
| `GET /health/ready` | `200 {"status":"ready"}` after a bounded MongoDB ping; otherwise `503 {"status":"unavailable"}` |

Startup waits for MongoDB and checks migration readiness before exposing HTTP. Later database unavailability leaves liveness independent and makes readiness return `503`.

JSON bodies are limited to exactly 32 KiB. API successes use `{data,meta:{requestId}}`; errors use `{error:{code,message,fields?},meta:{requestId}}`. Every response receives a generated `X-Request-Id`. Caller-supplied IDs are ignored, and raw database errors, password hashes and session tokens are never returned. Health and empty `204` responses are documented exceptions.

The production frontend is written to `frontend/dist`. `npm.cmd run preview` serves that build but does not provide a production `/api` reverse proxy; use the same-origin hosting arrangement when testing the complete account flow.

## Homepage and implementation structure

The Gather UI uses forest green and sage, an off-white canvas, Inter typography and responsive photo cards. Desktop has three columns, tablet a compact navigation rail and mobile top/bottom navigation. Shared visual tokens live in `frontend/src/styles/global.css`.

The account identity and editable profile are real. The visible **Feed preview** label identifies fictional people, posts and counts. Following/Recent tabs, search, carousels, likes, saves, comments and suggested follows remain browser demonstrations; they reset on refresh. Post publishing and other future destinations display coming-next dialogs. No feed or engagement persistence is implied by the account integration.

Preview media uses public `lh3.googleusercontent.com` URLs from the supplied design exports, and Inter loads from Google Fonts. Fallbacks keep the layout usable if those assets cannot load. Future product photos will use authorized private media delivery.

- `frontend/src/App.jsx`: session restoration and account/navigation state.
- `frontend/src/features/auth/`: signup, login and own-profile forms.
- `frontend/src/pages/HomePage.jsx`: homepage with the signed-in account.
- `frontend/src/features/feed/`: reusable post cards and isolated preview data.
- `frontend/src/services/api.js`: credentialed requests, CSRF and safe API errors.
- `backend/src/modules/auth/`: routes, services, repositories, models, validation and password helpers.
- `backend/src/migrations/001-auth.js`: explicit auth database schema/index migration.
- `backend/src/middleware/`: transport, request IDs, CSRF/rate limits and safe errors.
- `backend/src/config/`: environment validation and reusable MongoDB connection.
- `backend/test/`: isolated HTTP/unit tests and optional real-database integration tests.

## Design sources and next milestone

Original documents in `docs/` remain read-only:

- `Social_Media_App_PRD.docx`: product scope and acceptance criteria.
- `Social_Media_System_Design.docx`: architecture and feature flows.
- `Social_Media_MongoDB_Design.docx`: collection and lifecycle design.
- `Social_Media_API_Design.docs`: API contracts; this file currently contains a ZIP-based Word document despite its `.docs` extension.

The database/API documents govern V1 technical scope where older proposals differ. The explicit product-owner decision to skip email verification overrides their pending-account/verification flow for this implementation; the source documents themselves have not been changed. This slice combines their Origin/custom-header requirements with signed session-bound CSRF tokens.

Implemented: real account creation, login, seven-day sessions, basic own-profile editing, logout, auth schema/index migration, transport security, health checks and the responsive homepage preview.

Next milestone: **photo upload and post creation**, followed by connecting published posts to the real feed. It needs a private media-storage choice, upload validation, ownership checks and authorized delivery. Password recovery must also be completed before inviting external testers. Public/private profile access, follows, persisted engagement and saved items, search, notifications, moderation and text-based AI captions remain future work. Chat, calls, video/reels and stories are later phases. Retention, moderation ownership and launch eligibility remain product decisions.
