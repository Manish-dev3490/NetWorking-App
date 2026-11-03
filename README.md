# Gather

A JavaScript MERN application for photo-first social networking. React and Vite provide the UI; Express runs one modular backend; Mongoose connects to MongoDB. Accounts, member profiles/search, follows, private requests, photo uploads and chronological feeds use the real backend. Photo bytes live in the existing MongoDB Atlas cluster.

## Account flow

The current flow is **create account → enter the homepage → edit your profile → log out → log in again**. Refresh restores a valid session from MongoDB.

Email verification is intentionally omitted at the product owner's request. Registration returns `201`, creates an active account and signs the member in immediately. Email addresses are used as login identities; the application does not claim they have been verified. Verification, email delivery and password recovery are not implemented.

- Signup accepts a display name, username, email and password. Emails and usernames are normalized and protected by unique indexes. Passwords require 15–128 Unicode characters, at most 512 UTF-8 bytes, and are never trimmed or silently truncated.
- Passwords use salted scrypt hashes. Password work is bounded to two concurrent operations; an overloaded backend returns a safe `503`.
- Sessions are opaque random tokens. Only token hashes are stored in MongoDB. The browser receives a `__Host-session` cookie with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` and no `Domain`. Session tokens never enter localStorage.
- Sessions expire absolutely after seven days. Each authenticated request rechecks expiry, revocation, the user's `authVersion` and account state. TTL indexes only clean up expired records.
- Signup creates the user, session and default Saved collection in one transaction. Profile editing updates only the authenticated member's display name, username, bio, visibility and profile photo. Logout revokes the presented session and clears its cookie.
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

## Photo posts

Create a post from Home or your profile, choose 1–10 JPEG, PNG or WebP photos, reorder them, add optional photo descriptions, a caption and hashtags, then publish. Each image is uploaded separately before the post is published atomically. Published photos appear in Recent and Your posts, survive refresh, and have a shareable `/p/:id` page that requires login. Owners can edit captions/hashtags and delete posts. A version check prevents an old editor from overwriting a newer save; stable request keys make upload/publish retries safe.

- Uploads and processed images are each capped at 5 MiB. Decoding is capped at 20 million pixels and 8,192 pixels per side. Animated files and unsupported or mismatched formats are rejected. Processing applies orientation, fits images within 2,048 × 2,048, strips source metadata and encodes WebP.
- Binary BSON data is stored in `media_images`; ownership, dimensions and lifecycle metadata live in `media_assets`. Post/feed queries never load photo bytes. No Base64 photos or external image-storage account is required.
- Each member may have 20 unattached uploads, 100 stored images and 50 MiB of processed photo bytes, shared across posts and profile photos. Two uploads can be read/processed concurrently per backend process. Unattached uploads expire after 24 hours; paired metadata/byte cleanup runs at startup, every minute in bounded batches and on that member's next upload. Cancelled known uploads are removed immediately; interrupted uploads with an unknown result expire through cleanup.
- Authenticated image delivery checks the current author status, visibility and accepted-follow relationship and sends private, non-cacheable responses. Recent contains active public authors; private posts are accessible to their owner and accepted followers. Deleting a post removes its photo bytes and metadata in the same transaction while retaining the publish-key tombstone.

All post/photo mutations require the session, CSRF protections and captured `X-Account-Id`. Upload and publication also require a UUID `Idempotency-Key`.

| Method and path under `/api/v1` | Result |
| --- | --- |
| `POST /media/uploads` | Raw JPEG/PNG/WebP body; returns uploaded asset metadata |
| `DELETE /media/:id` | Removes an owned unattached upload |
| `GET /media/:id/content` | Authorized image bytes |
| `POST /posts` | Publishes owned uploads; `201`, or `200` for a replay |
| `GET /posts/recent` | Cursor-paginated public Recent feed |
| `GET /me/posts` | Cursor-paginated own posts |
| `GET /posts/:id` | One visible post |
| `PATCH /posts/:id` | Owner edit with `expectedVersion` |
| `DELETE /posts/:id` | Removes an owned post and its photos |

Captions allow 2,200 Unicode characters, photo descriptions 500, and hashtags 20 unique values of up to 50 characters. The complete post JSON must also fit the API's 32 KiB limit; the composer checks its encoded size before uploading any photos and asks the member to shorten the text if needed. List requests accept `limit` (1–20) and `cursor`; continuation cursors expire after 24 hours and are tied to the viewer and feed.

## Post likes and comments

Members can like or unlike a visible post from any feed, member profile or the post detail page. Post responses include `likedByMe`, `likeCount` and `commentCount`. Each member can like a post once, and repeated like or unlike requests return the current state.

Post detail shows a paginated, flat comment list. Comments allow up to 1,000 Unicode characters after trimming and normalization. Comment authors can edit or delete their own comments. An edit includes the version loaded by the author so a concurrent edit returns `409 VERSION_CONFLICT`. If the post has commenting disabled, members who can view it can still read its existing comments and manage their own.

Every engagement request uses the post's existing visibility rules. Private posts and their engagement are accessible to the post author and accepted followers. Pending and revoked followers receive `404`. Mutations use the same session, CSRF and `X-Account-Id` checks as post writes. Comment creation also requires a UUID `Idempotency-Key` for safe retries.

| Method and path | Behavior |
| --- | --- |
| `PUT /posts/:id/like` | Likes a visible post and returns the current like state and count |
| `DELETE /posts/:id/like` | Unlikes a visible post and returns the current like state and count |
| `GET /posts/:id/comments` | Lists comments with `limit` and `cursor` |
| `POST /posts/:id/comments` | Adds a comment with `{ "text": "…" }`; `201` for creation or `200` for a replay |
| `PATCH /posts/:id/comments/:commentId` | Edits an owned comment with `text` and `expectedVersion` |
| `DELETE /posts/:id/comments/:commentId` | Removes an owned comment and returns the current comment count |

## Saved posts

Use the bookmark button on a post to add or remove it from your Saved list. The `/saved` page is visible only to the signed-in member and lists posts newest saved first. Bookmarks store a reference to the post, and each member can save a post once. Post responses include the viewer's `savedByMe` state.

Saved checks current post visibility on every page request. Load more rechecks the earlier pages before displaying the expanded list. If a private author removes your access, their post is hidden from Saved and can reappear if access is restored. Deleting a post removes its bookmarks along with its other related data.

| Method and path | Behavior |
| --- | --- |
| `GET /me/saved-posts` | Lists visible saved posts with `limit` and `cursor`. Requires `X-Account-Id` to match the signed-in account |
| `PUT /posts/:id/save` | Saves a visible post and returns `savedByMe` |
| `DELETE /posts/:id/save` | Unsaves a visible post and returns `savedByMe` |

## Members and follows

Open a post author's profile or search for a member by username or display name. Member profiles show their photo and relationship state. Public profiles, own profiles and accepted private followers can access the biography, post count, follower/following counts and posts. Other viewers see only minimal identity and a private-account gate; private counts and biography are omitted from the API response.

- Following a public member is accepted immediately; following a private member creates a pending request. The owner can approve or reject incoming requests. Members can cancel requests, unfollow, inspect eligible follower/following lists and remove their own accepted followers.
- Follow pairs are unique and self-follow is rejected. Repeated follow/approve operations replay current state; rejection removes pending requests only and never revokes an already accepted relationship. Rejecting an already approved request returns `409 REQUEST_ALREADY_APPROVED`; the inbox refreshes and explains that follower removal is needed to revoke private-content access. Repeated rejection of an absent request remains `204`. Follow, follower removal and privacy changes use MongoDB transactions and shared user guards, so concurrent changes recheck current policy.
- Changing public to private preserves accepted followers. Changing private to public keeps pending requests pending until approved or cancelled. Revoking a private follow removes access on subsequent profile/post/image requests, including existing links and feed cursors. Bytes already downloaded cannot be recalled.
- Following contains the signed-in member and current accepted follows, newest first. Recent remains public. Member search uses escaped, indexed normalized prefixes, with a 2–60-character query and a username/display-name selector. Lists use signed 24-hour cursors bound to the viewer, route, target and search filter.
- Profile photos use the same bounded MongoDB binary upload pipeline with `X-Media-Purpose: avatar`; normal post uploads default to `post`. Avatar and post assets cannot be claimed for the other purpose. Profile saves atomically attach an owned ready avatar and delete the replaced photo's bytes/metadata. Profile photos are minimal identity, so active signed-in members can see them even when the profile's posts are private.

All relationship mutations require the existing session, CSRF protections and captured `X-Account-Id`, and accept no body fields.

| Method and path under `/api/v1` | Result |
| --- | --- |
| `GET /users/:id` | Member profile with relationship and content-access state |
| `GET /users/:id/posts` | Authorized member posts |
| `GET /users/:id/followers` / `following` | Authorized accepted-relationship lists |
| `GET /search/users?q=…&match=username` | Member prefix search; `match=displayName` also supported |
| `PUT /me/following/:id` | Follow or request; returns pending/accepted |
| `DELETE /me/following/:id` | Cancel request or unfollow |
| `GET /me/follow-requests` | Own incoming pending requests |
| `PUT /me/follow-requests/:requesterId` | Approve request |
| `DELETE /me/follow-requests/:requesterId` | Reject pending request |
| `DELETE /me/followers/:id` | Remove accepted follower |
| `GET /posts/following` | Chronological Following feed |

Following-feed author IDs are resolved from current accepted follows, then queried through the posts' author/time index. This V1 query materializes the eligible author IDs for one request; it is not a claim of fixed memory usage at arbitrary follow counts.

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

Migration `001-auth` creates collection validators, unique identity/session/default-collection indexes and the session TTL index. Migration `002-posts` adds post/media validators and lifecycle/feed indexes. Migration `003-network` adds follow validators, unique ordered pairs, relationship/search indexes and profile-photo/policy fields. Migration `004-engagement` adds the like and comment collections and indexes. Migration `005-saved-posts` adds the bookmark collection and indexes. Migrations record completion in `schema_migrations` and are safe to rerun. They do not delete or repair existing data; duplicate identities or conflicting indexes must be resolved deliberately. The backend requires all five migrations before serving HTTP. Automatic Mongoose collection/index creation remains disabled.

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

Tests cover safe HTTP errors, compressed JSON, configuration, normalized Unicode names, signup validation, password hashing, concurrent-tab CSRF/origin checks, account-bound writes, session/profile behavior, image decoding/limits and authenticated photo/post routes. `npm.cmd test` skips live database checks unless `TEST_MONGODB_URI` is present in the test process.

To exercise real MongoDB transactions and session behavior using local backend configuration:

```powershell
npm.cmd run test:integration
```

This runner loads `backend/.env` and uses `TEST_MONGODB_URI` when already set, otherwise `MONGODB_URI`. The connection user must be allowed to create and drop randomly named `gather_auth_test_<random>`, `gather_posts_test_<random>` and `gather_network_test_<random>` databases. Tests migrate those isolated databases, exercise account transactions, binary storage, publication races/retries, ownership, privacy, quotas, pagination, requests, search, Following feeds, profile photos and cleanup, then drop only their own databases. They do not write to the application database named in the URI. The separate readiness test only connects, pings and closes. A failed cleanup can leave an isolated test database for manual inspection.

| Endpoint | Result |
| --- | --- |
| `GET /health/live` | `200 {"status":"ok"}` while HTTP is serving |
| `GET /health/ready` | `200 {"status":"ready"}` after a bounded MongoDB ping; otherwise `503 {"status":"unavailable"}` |

Startup waits for MongoDB and checks migration readiness before exposing HTTP. Later database unavailability leaves liveness independent and makes readiness return `503`.

JSON bodies are limited to exactly 32 KiB. The dedicated raw image upload route has its separate 5 MiB limit. API successes use `{data,meta:{requestId}}`; lists also include `nextCursor` and `hasMore` in `meta`. Errors use `{error:{code,message,fields?},meta:{requestId}}`. Every response receives a generated `X-Request-Id`. Caller-supplied IDs are ignored, and raw database errors, password hashes and session tokens are never returned. Image bytes, health and empty `204` responses are documented exceptions.

The production frontend is written to `frontend/dist`. `npm.cmd run preview` serves that build but does not provide a production `/api` reverse proxy; use the same-origin hosting arrangement when testing the complete account flow.

## Homepage and implementation structure

The Gather UI uses forest green and sage, an off-white canvas, Inter typography and responsive photo cards. Desktop has three columns, tablet a compact navigation rail and mobile top/bottom navigation. Shared visual tokens live in `frontend/src/styles/global.css`.

The homepage uses real Recent, Following and Your posts feeds, image carousels, author profile links, owner post actions and empty/loading/error states. Member search queries the backend; the separate loaded-post filter is labelled accordingly. Own-profile editing includes visibility and profile photos. Member pages show authorized posts and relationship lists, and the Requests page supports approval/rejection. Saved opens the signed-in member's bookmarks. Notifications and other future destinations still show informational dialogs.

Inter loads from Google Fonts. Uploaded post photos use the authenticated MongoDB media route. The old design-preview feed components remain isolated in `features/feed/` and are no longer rendered by Home.

- `frontend/src/App.jsx`: session restoration and account/navigation state.
- `frontend/src/features/auth/`: signup, login and own-profile forms.
- `frontend/src/features/posts/`: composer, feeds, real post cards, detail view and post API helpers.
- `frontend/src/features/network/`: member search, profiles, relationship lists and follow requests.
- `frontend/src/pages/HomePage.jsx`: homepage with the signed-in account.
- `frontend/src/features/feed/`: reusable post cards and isolated preview data.
- `frontend/src/services/api.js`: credentialed requests, CSRF and safe API errors.
- `backend/src/modules/auth/`: routes, services, repositories, models, validation and password helpers.
- `backend/src/modules/posts/`: publication, access rules, pagination, editing and cleanup.
- `backend/src/modules/network/`: member discovery, profile access and transactional relationships.
- `backend/src/modules/media/process-image.js`: bounded decoding and WebP processing.
- `backend/src/migrations/001-auth.js`: explicit auth database schema/index migration.
- `backend/src/migrations/002-posts.js`: explicit posts/media schema and index migration.
- `backend/src/migrations/003-network.js`: relationship/search indexes and profile-photo/policy schema.
- `backend/src/migrations/004-engagement.js`: post like and comment schema and indexes.
- `backend/src/migrations/005-saved-posts.js`: bookmark schema and indexes.
- `backend/src/middleware/`: transport, request IDs, CSRF/rate limits and safe errors.
- `backend/src/config/`: environment validation and reusable MongoDB connection.
- `backend/test/`: isolated HTTP/unit tests and optional real-database integration tests.

## Design sources and next milestone

Original documents in `docs/` remain read-only:

- `Social_Media_App_PRD.docx`: product scope and acceptance criteria.
- `Social_Media_System_Design.docx`: architecture and feature flows.
- `Social_Media_MongoDB_Design.docx`: collection and lifecycle design.
- `Social_Media_API_Design.docs`: API contracts; this file currently contains a ZIP-based Word document despite its `.docs` extension.

The database/API documents govern V1 technical scope where older proposals differ. Explicit product-owner decisions override their email-verification and external-object-storage proposals: signup skips verification, and uploaded product photos will be stored in MongoDB Atlas. The source documents themselves have not been changed. This slice combines their Origin/custom-header requirements with signed session-bound CSRF tokens.

Implemented: account creation, login, seven-day sessions, own-profile editing and photos, public/private member profiles, member search, follow/unfollow, private requests with approval/rejection, follower removal, MongoDB photo uploads, post publication, Recent/Following/own feeds, permalinks, caption/hashtag edits, post deletion, likes/unlikes, flat comments with author editing/deletion, Saved posts, transport security, health checks and schema/index migrations.

Product-owner media decisions are implemented above: MongoDB binary storage and 5 MiB limits replace the original external-storage proposal. Image bytes count toward Atlas storage usage. Profiles, follows and the Following feed now form the application's core networking flow.

Password recovery must also be completed before inviting external testers. Custom Saved collections, hashtag search, notifications, blocking/muting, moderation and text-based AI captions remain future work. Chat, calls, video/reels and stories are later phases. Retention, moderation ownership and launch eligibility remain product decisions.
