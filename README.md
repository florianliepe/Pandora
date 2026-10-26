# Pandora

An Eraneos-style project quality workspace: report an issue, plan a mitigation,
record test evidence, and verify the fix. Phase one includes the application and
its automated acceptance suite. Phase two connects development repositories and
the Codex fix/test/review loop.

## Release status

- Implemented: email-code authentication, project CRUD (archive for deletion),
  membership and four roles, defect backlog, evidence uploads, iterations,
  test cases and versioned execution snapshots, in-app notifications, audit log,
  priority heatmap, history-based burndown, flow metrics, advisory chat adapter.
- Frontend is deployable to GitHub Pages. Until a backend URL is configured the
  published page explicitly shows a frontend preview and disables login.
- Backend runs locally with SQLite; production requires PostgreSQL and private
  Azure Blob storage. Local development mail is never exposed through the API.
- Azure configuration is prepared, **not provisioned**, at the owner's request.
- n8n workflow definitions are drafts. Mail requires an approved sender and
  authenticated webhook; chat requires backend-only authentication and publication.
- SSO, repository write access, automatic fix execution, pipeline ingestion and
  operational DORA measurements are phase-two work. Agentic merge is unavailable.

## Run locally

Requires Node.js 24 or later.

```sh
npm ci
cp .env.example .env
npm start
```

Set `DEV_MAILBOX=true` and `HOST=127.0.0.1` in `.env` for local acceptance testing.
Request a code through the UI, then read `.local/mailbox.json`. The local mailbox
is ignored by Git and is disabled when `NODE_ENV=production` or a non-loopback
host is used. There is no password-based or shared-account bypass.

```sh
npm test
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

`dist` contains only static frontend assets. `PANDORA_API_URL` sets the HTTPS
backend origin during the build. Backend secrets never enter the frontend.

## Workflow

`reported → triaged → planned → in_progress → ready_for_test → verified → closed`

Triaged issues may move directly into progress; verified or closed issues can be
reopened. The server enforces transitions. Verification requires the latest
linked run to pass after the issue was ready for test. Developers can prepare a
fix but must use an owner or tester role for verification and an owner for closure.
Priority (urgency) and severity (impact) are distinct fields.

| Role | Scope |
|---|---|
| Owner | Project settings, membership, delivery planning, archive and verification |
| Developer/editor | Issues, mitigation, iterations, test cases/runs and evidence |
| Tester/user | New reports, own report details, cases/runs, verification and reopening |
| Viewer | Read-only project access and personal notification preferences |

Every verified Eraneos user can create a project and becomes its owner. Existing
projects require explicit membership. Stable UUID user IDs are separate from
email addresses so a later SSO identity can be mapped without re-keying records.
All API requests, including evidence downloads, enforce membership server-side.

## Repository map

| Path | Purpose |
|---|---|
| `public/` | Responsive frontend, no framework runtime required |
| `server/` | Express API, authentication, authorization, persistence and evidence |
| `tests/` | API, persistence, managed-identity and browser regression tests |
| `infra/main.bicep` | Dedicated Azure network, App Service, PostgreSQL, Blob and Key Vault |
| `workflows/` | n8n login email, advisory chat and callable context workflows |
| `.github/workflows/` | CI, Pages and manually triggered backend deployment |
| `docs/` | Deployment steps, research decisions and phase-two integration contract |

## Operational limits

The initial persistence adapter keeps a versioned aggregate in one PostgreSQL
JSONB row, using a transaction and row lock to prevent lost updates across
instances. This is suited to a small-team pilot, not a high-volume multi-tenant
service. Split issues, events, sessions and runs into indexed tables before
large-scale rollout. Azure stores screenshot binaries separately; local SQLite
keeps them inline. Screenshots are limited to 5 MB each and 10 per issue.

Records are archived, not physically purged. Audit and attachment retention,
backup restoration and operational load tests must be agreed before a broad
production rollout. The current frontend uses an eight-hour bearer session in
sessionStorage; SSO and stronger session management are planned separately.

See [deployment](docs/deployment.md), [research](docs/research.md) and
[integration contract](docs/phase-two.md).
