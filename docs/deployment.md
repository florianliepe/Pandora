# GitHub Pages and n8n deployment

Pandora uses GitHub Pages for static assets, the existing Eraneos n8n service for
its API, and the private `florianliepe/Pandora-data` repository for application
records and screenshot files. No dedicated Azure application resources are used.

## Deployed components

- Frontend: https://florianliepe.github.io/Pandora/
- API: POST https://eraneos-agentic-platform.azurewebsites.net/webhook/pandora-api-v1
- API workflow: `zBVoVh2q6lDlRB6B`
- Internal mail workflow: `OvGwJlAsbVMG4kQl`
- Outlook credential: `Eraneos Outlook` (`RwBmsnNR6Poq2bIE`)
- GitHub credential in n8n: `GitHub account` (`3V46mglu7fpoPISX`)
- Authentication Data Table: `t2laKfcbbngX0zz1`

These IDs are references, not credentials. OAuth tokens and GitHub tokens remain
in n8n credential storage. The frontend contains only the public API URL.

## Publish

1. Run `npm ci`, `npm test`, and the browser regression suite.
2. Run `node scripts/build-n8n.mjs` then `node scripts/api-workflow.mjs` to rebuild
   the checked-in API workflow definition.
3. Set `N8N_API_BASE_URL` and `N8N_API_KEY` in the deployment shell, never Git.
   `node scripts/api-workflow.mjs --deploy` updates the workflow identified by
   `.local/api-workflow-id`. On a new checkout put `zBVoVh2q6lDlRB6B` in that file
   first to update the existing workflow rather than create another one.
4. Publish the mail subworkflow before the API. It uses an internal workflow
   trigger restricted to workflows owned by the same n8n owner; no public email
   webhook exists. Preserve its Outlook credential binding when updating.
5. Set repository variable `PANDORA_API_URL` to the API URL above. Dispatch
   `Publish frontend` for the reviewed branch. This publishes assets without
   merging a pull request. An empty API URL produces a disabled login preview.

The browser sends a text/plain JSON envelope `{path, method, body, token}` and
receives `{status, body}`. This avoids cross-origin preflight; authorization still
runs on every protected request. CORS permits only the GitHub Pages origin.

## Authentication and persistence

Only exact `eraneos.com` email addresses are accepted. Codes expire after ten
minutes, allow five attempts, and can be used once. Requests are limited to five
per account per hour, at least one minute apart. Session lifetime is eight hours.
The UI stores its bearer token in sessionStorage; logout revokes the stored hash.

Hashed codes, hashed sessions, and the request budget are stored in n8n's Data
Table, never Git. The n8n Crypto node generates fresh entropy; the bundled runtime
uses SHA-256 with a counter to derive random values. n8n execution payload saving
is disabled on both API and mail workflows; Outlook sent-item copies are disabled
for login messages. Inbox delivery remains subject to the mailbox's retention.

A conditional Data Table update acquires a 120-second request lease. A losing
request receives 409 and should retry. GitHub file SHA checks independently reject
stale state writes. The workflow times out after 110 seconds; an abandoned lease
expires automatically. Authentication updates are saved before a session token is
returned. Project data must commit successfully before authentication changes
from that operation are accepted.

GitHub `state.json` is capped at 700 KB of UTF-8 JSON for this pilot. Screenshot
files are stored separately, limited to 5 MB each and ten per issue. A failed
state write following an evidence upload can leave an unreferenced evidence file;
clean these up only after checking current state and retention needs. Archived
records and old screenshot versions remain in Git history. Repository access
must remain private; do not enable Pages on the data repository.

The global API budget is 6,000 accepted requests per hour. This serialized,
Git-backed design is a small-team pilot. Use a transactional database if usage,
retention, or reporting requirements exceed these limits. Back up the n8n Data
Table as well as the Git repository; restoring Git alone does not restore sessions.

The old Azure infrastructure files are superseded reference material, not the
current deployment path. Advisory AI chat and repository fix/merge automation are
not enabled by this API. Human approval remains mandatory for future fixes.
