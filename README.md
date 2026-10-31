# Social App

JavaScript MERN foundation for an authenticated, photo-first social application. The homepage uses **Gather** as its working visual identity. React and Vite provide the browser UI; Express runs as one modular monolith; Mongoose manages a reusable MongoDB connection. The repository includes the backend foundation and a responsive homepage design preview.

## Homepage preview

The homepage follows the supplied Gather reference: forest green and sage, a warm off-white canvas, Inter typography, white photo cards, left navigation and a contextual right sidebar. Desktop uses three columns, tablet uses a compact navigation rail, and mobile uses a single feed with top and bottom navigation.

Run `npm.cmd run dev:frontend` and open `http://localhost:5173`. The homepage works without a running backend. The visible **Design preview** label identifies fictional sample people, posts and counts. Following/Recent tabs, local feed search, photo carousels, likes, saves, sample comments and suggested follows are browser UI demonstrations; their state survives switching preview views and resets on refresh. Create post, Explore, account settings and other future pages show clear coming-next dialogs. No authentication, real publishing or feature API requests have been added.

UI code lives in `frontend/src/pages/HomePage.jsx`, `frontend/src/components/`, and `frontend/src/features/feed/`. Sample data is isolated in `preview-data.js` for replacement by API data later. The supplied design's story-like row is represented as people in **Your circle**; stories, reposts and ranked discovery remain outside V1.

The design references contain differing token values. This implementation uses green `#496657`, deep green `#324e40`, canvas `#f7f8f6`, sage `#eaf0eb`, text `#252b29`, muted text `#69736d`, borders `#e1e6e1`, 16px cards and 12px controls. These are reusable CSS variables in `global.css`; no component-library dependency was added.

Preview photos and portraits use the exact public image URLs from the provided design exports (`lh3.googleusercontent.com`), and Inter loads from Google Fonts. These assets require internet access; image and font fallbacks keep the layout usable when unavailable. Preview asset download was blocked in the development sandbox. Real product media will use the documented authorized backend delivery instead.

The frontend scripts use Vite's native loader for the JavaScript configuration. This also avoids unnecessary configuration bundling that is blocked by parent-directory access restrictions in the Windows sandbox. The usual root commands (`npm.cmd run dev:frontend`, `npm.cmd run build`, `npm.cmd run preview`) work with this setting.

The first release will cover email authentication, profiles and privacy, follows, photo posts, engagement, saved collections, feed/search, polling notifications, moderation and text-based AI captions. Chat, calls, video/reels, stories, image understanding and broader AI workflows are deferred.

## Design sources and decisions

The four original files in `docs/` remain the design sources and are read-only:

- `Social_Media_App_PRD.docx`: product direction, phased scope and acceptance criteria.
- `Social_Media_System_Design.docx`: system design **and high-level architecture**.
- `Social_Media_MongoDB_Design.docx`: collection, integrity and lifecycle design.
- `Social_Media_API_Design.docx`: HTTP contracts, response shapes and operational endpoints.

The database document's **Scope and authority** explicitly prioritizes the later architecture and agreed V1 scope over broader PRD proposals. The API document's **Source alignment** also states that the later architecture/database decisions govern V1. These statements establish email/password with server sessions, text-only AI captions and no Redis or microservices for V1. The architecture's `client/` and `server/` layout is a proposal; this empty repository uses the requested `frontend/` and `backend/` names.

The selected browser topology is one origin: Vite proxies API requests locally, and a hosting reverse proxy should provide the same arrangement later. The backend therefore does not enable CORS. Separate browser/API origins require an explicit hosting/security decision and a credentialed exact-origin allowlist before use.

Future layers follow route → controller → service → repository. Services enforce business rules and call other modules through internal service interfaces. MongoDB owns identity, relationships, content metadata and operational state; photo bytes belong in private object storage. Growing relationships use separate collections, bounded values may be embedded, and unique indexes enforce identities and relationships. Use UTC dates, ObjectId references, cursor pagination, and transactions for coupled writes. TTL deletion is cleanup, never an authorization check. Schema/index migrations remain future work; automatic schema/index creation is disabled here.

Future authentication uses opaque MongoDB-backed sessions: only token hashes are stored; the browser receives `__Host-session` with Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain. No token belongs in localStorage. The proposed absolute session duration is seven days. Session logic, password hashing, cookies and account checks are **not implemented**. Validate HTTPS and cookie behavior before that milestone.

Open decisions that do not block this scaffold:

- System Design §3 calls for CSRF tokens plus Origin validation; API §1 specifies an exact Origin plus `X-App-Request: web`. Neither explicitly supersedes the other. Resolve the final policy before implementing mutations. The client includes the API header foundation; the server does not yet implement CSRF protection or any feature mutation endpoint.
- System Design proposes notification polling every 30 seconds; API §7 proposes 60 seconds. Resolve when notifications are implemented.
- The proposed 20-second AI provider timeout and 25-second HTTP request budget may be compatible; confirm both during AI integration. No AI call exists here.
- Product identity, providers, hosting/TLS, exact MongoDB deployment/version, retention, age/region eligibility and moderation ownership remain open. No services have been provisioned.

## Structure

```text
.
├── docs/                         Original product and technical documents
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── app/                  Future app composition
│   │   ├── components/           Shared icons, avatars and accessible dialog
│   │   ├── features/feed/        Reusable post cards and isolated sample data
│   │   ├── pages/HomePage.jsx    Responsive homepage preview
│   │   ├── services/api.js       Credentialed JSON client; no automatic requests
│   │   ├── hooks/
│   │   ├── styles/global.css
│   │   ├── utils/
│   │   ├── App.jsx               Homepage entry
│   │   └── main.jsx
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── backend/
│   ├── src/
│   │   ├── config/               Environment loading/validation and MongoDB
│   │   ├── middleware/           Request IDs, JSON transport and safe errors
│   │   ├── modules/              Reserved module boundaries listed below
│   │   ├── shared/               Shared HTTP error type
│   │   ├── routes.js             Empty /api/v1 feature-router mount point
│   │   ├── app.js                Express setup and health routes
│   │   └── server.js             Startup, failure handling and resource shutdown
│   ├── test/                     Foundation behavior checks
│   ├── .env.example
│   └── package.json
├── .gitignore
├── .npmrc                        Workspace-local ignored npm cache
├── .nvmrc
├── eslint.config.js
├── package.json                  npm workspace commands
├── package-lock.json             One lockfile for both workspaces
└── README.md
```

Reserved backend modules contain `.gitkeep` files only:

| Module | Future responsibility |
| --- | --- |
| `auth` | Registration, verification, sessions and recovery |
| `users` | Profiles, account/privacy settings and deletion |
| `social` | Follows, requests, blocks and mutes |
| `posts` | Publishing, edits, deletion and post access |
| `media` | Private upload validation, ownership and delivery |
| `engagement` | Likes, comments/replies, saved collections and share links |
| `feed` | Following feed, Explore, user and hashtag search |
| `notifications` | Persistent deduplicated events and polling |
| `ai` | Text caption assistance and usage controls |
| `moderation` | Reports, appeals, decisions and audit records |

## Local setup

Use Node.js **22.13+ within major 22**, or **24.x**, and npm **10+**. `.nvmrc` selects major 22. The development machine has Node 22.20.0 and npm 10.9.3. These minimums satisfy the installed build and lint tools; use an updated patch of a supported [Node LTS release](https://nodejs.org/en/about/previous-releases).

Run from the repository root. Commands use `npm.cmd` because this Windows machine blocks PowerShell's `npm.ps1`; on other shells, use `npm`.

```powershell
npm.cmd ci
```

This installs both workspaces from the root `package-lock.json`. Use `npm.cmd install` when intentionally changing dependencies and retain the updated lockfile. Do not create separate workspace lockfiles.

Copy environment examples only if the destination does not already exist:

```powershell
if (!(Test-Path -LiteralPath backend/.env)) { Copy-Item -LiteralPath backend/.env.example -Destination backend/.env }
if (!(Test-Path -LiteralPath frontend/.env)) { Copy-Item -LiteralPath frontend/.env.example -Destination frontend/.env }
```

Edit `backend/.env` and supply a real development `MONGODB_URI`. Use an existing local replica set or managed development database; this scaffold does not install, configure or seed MongoDB. The documented future transaction paths require a replica set or supported transaction-capable cluster, rather than standalone MongoDB. Health checks alone do not prove transaction support. Use separate development and production data.

| Variable | Location | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Backend only | Required MongoDB connection string; replace the example database and replica-set values with your own |
| `NODE_ENV` | Backend only | `development` by default; also accepts `test` and `production` |
| `HOST` | Backend only | Bind address, default `127.0.0.1`; hosting may need `0.0.0.0` |
| `PORT` | Backend only | Integer 1–65535, default `3000` |
| `VITE_API_BASE_URL` | Frontend, public | API base path, default `/api/v1` |
| `TEST_MONGODB_URI` | Test process only, optional | Enables the read-only MongoDB integration check |

Native Node environment-file loading resolves `backend/.env` regardless of the current working directory. Existing process variables take priority. Missing or invalid required configuration produces a clear error and nonzero exit. No `.env` file or credentials are supplied. All `VITE_*` values are public browser code: never put database, session, email, storage or AI secrets there.

Start the backend in one terminal:

```powershell
npm.cmd run dev:backend
```

Start the frontend in another terminal:

```powershell
npm.cmd run dev:frontend
```

Open `http://localhost:5173`. Vite uses a strict port and proxies `/api` and `/health` to `http://127.0.0.1:3000`. If you change the backend host/port, update that development proxy too. The homepage runs independently of backend availability and makes no feature API requests. Fonts and preview images load from the external hosts listed above. Stop foreground servers with Ctrl+C; the backend closes HTTP and MongoDB resources with a bounded shutdown deadline.

For non-watch backend startup:

```powershell
npm.cmd start
```

## Validation and health

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

The frontend production build goes to `frontend/dist`. Preview serves only the built shell; it does not configure the production `/api` reverse proxy. Deployment infrastructure is outside this scaffold.

| Endpoint | Expected result |
| --- | --- |
| `GET /health/live` | `200 {"status":"ok"}` while the HTTP process is serving |
| `GET /health/ready` | `200 {"status":"ready"}` after a successful bounded MongoDB ping; otherwise `503 {"status":"unavailable"}` |

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health/live
Invoke-RestMethod http://127.0.0.1:3000/health/ready
```

Startup waits for MongoDB before opening HTTP. An initial connection failure exits nonzero, so no health endpoint is exposed for that failed process. If MongoDB later becomes unavailable, liveness stays independent and readiness returns 503. Optional future AI/email outages will not affect core readiness.

API JSON bodies are limited to exactly 32 KiB. Unknown routes, malformed JSON, oversized payloads and unsupported JSON media types use safe error codes and `{error:{code,message},meta:{requestId}}`. Every response receives a generated `X-Request-Id`; caller-supplied IDs are ignored. Health responses have the documented simple shape. There are no mounted feature routes, so `/api/v1/...` currently returns a documented error, not fake feature data.

Tests use Node's built-in runner and real ephemeral HTTP listeners to check configuration validation, readiness transitions, response envelopes, request IDs, JSON boundaries and content types. The optional database test connects, pings and closes without writing records:

```powershell
$env:TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/your_development_database?replicaSet=your_replica_set'
npm.cmd test
Remove-Item Env:TEST_MONGODB_URI
```

Without `TEST_MONGODB_URI`, that integration test explicitly skips. A passing isolated HTTP test with an injected checker does not establish a live database connection.

## Scaffold boundary and next milestone

Implemented: workspace/tooling configuration, responsive homepage UI preview and reusable frontend components, credentialed JSON API-client foundation, environment validation, reusable small-pool MongoDB connection, health routes, API transport/error foundation and process lifecycle. Backend feature directories establish ownership without empty controller/service/repository files.

Not implemented: authentication/session business logic, feature schemas/index migrations, persisted profiles/follows, uploads/posts, engagement/saves, feed/search APIs, notifications/outbox workers, AI integrations, moderation, or later-phase chat/calls/reels. Sample homepage data is a visual preview, without an API mock server. There are no provider adapters, Redis, Docker, CI/CD, queues or deployment resources.

After scaffold review, resolve CSRF and the development HTTPS/cookie setup, then implement the documented **register → verify email → sign in → edit profile → sign out** slice. Define request-validation schemas and OpenAPI contracts for that slice, use transaction-capable MongoDB, and verify expiry/revocation, restricted accounts, unauthorized access and error recovery.
