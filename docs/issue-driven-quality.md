# Issue-driven quality workflow

## Reporting and evidence

An issue is the primary workspace. Screenshots can be selected in a batch,
dropped, or pasted during creation or editing. Local previews show pending files;
Save persists the issue and uploads the images sequentially. If an upload fails,
the saved issue ID and remaining files are retained for retry, avoiding duplicate
reports. Existing evidence is retrieved through the project-authorized API.
PNG, JPEG and WebP remain limited to 5 MB each and ten images per issue.

The issue workspace shows mitigation fields, derived test status, generated
cases and execution history. Test management retains project-level CRUD and an
All my projects view restricted to the signed-in user's memberships.

## Automatic test drafts

Issue creation, changes to reproduction evidence, and screenshot additions or
removals queue a new evidence revision. The worker waits at least 30 seconds so
multi-file uploads can finish, then claims one job per minute. Existing active
issues without a generation record are queued automatically; closed issues are
not backfilled. It loads private
image blobs, describes each image through the Eraneos gateway, and generates a
bounded JSON test plan from the report and image observations. Image observations
are model interpretations, not confirmed reproduction evidence.

- Worker: `HWQbLEwHTPVGtYRN` (Pandora | derive tests and iterations)
- Internal state workflow: `KblOJCQpInwzyg1a` (Pandora | internal quality store)
- Gateway credential: `jGlNDqeYEbc5DwVT`, model `claude-sonnet-5`

The internal state workflow has no public webhook. Its trigger is restricted to
workflows owned by the same n8n owner. The browser cannot set internal-worker
configuration or invoke claim/completion operations. Both workflows disable
execution-payload retention, and the worker has no repository-code execution,
merge, deployment or notification tools.

The worker releases the database lease before model calls. Completion acquires a
new lease and applies results only when request ID, claim ID and evidence revision
still match. Duplicate and stale responses are ignored. Invalid output or model
errors retry up to three attempts; expired claims are recoverable. Failure remains
visible in the issue workspace, with explicit retry and manual CRUD available.

Unedited AI drafts without execution history can be superseded. Manually edited,
renamed, manually archived, or executed cases are preserved; execution snapshots
are never rewritten by regeneration. New AI cases remain visibly draft. Saving a
case manually marks it reviewed. Regeneration never creates execution results.

## Derived verification

Test status is read-only on the issue form and derived by the API. Passing status
requires a current passing run for every active linked case, with matching case
version and issue evidence revision. Runs predating the latest ready-for-test
transition do not qualify. New evidence or case edits invalidate previous passing
coverage. Failed and blocked current results take precedence over incomplete
coverage. The normal owner/tester verification permissions still apply.

## Iterations and metrics

Owners configure an anchor date, a 7–42-day cadence and 1–6 upcoming iterations.
The initial window is created on configuration; the worker maintains it thereafter.
Creation uses stable project/date keys, preserving manually edited and archived
iterations. Backlog issues receive due-date-based or next-iteration suggestions.
An owner/developer explicitly accepts assignments after considering capacity.
Existing manual iteration CRUD remains available.

Flow metrics derive from issue transition history: WIP, throughput, cycle time,
lead time and open-issue age. Burndown remains history-based. DORA metrics are not
editable counters and are not inferred from issue counts: deployment and incident
event integration is still needed before they can display real values.

## Build and deploy

1. Run `node scripts/build-n8n.mjs`.
2. Run `node scripts/api-workflow.mjs --worker --deploy` and
   `node scripts/api-workflow.mjs --deploy` using the existing local workflow-ID
   files and n8n environment credentials.
3. Run `node scripts/quality-workflow.mjs --deploy --activate`.
4. Review and merge the frontend/application PR; the main-branch Pages workflow
   publishes the UI. No Azure application deployment is needed.

On a fresh checkout, restore `.local/api-workflow-id`, `.local/quality-store-id`
and `.local/quality-worker-id` with the existing IDs before deployment. Do not
accidentally create duplicate scheduled workers. Git state retains the pilot
700 KB aggregate limit, so archive/retention and scaling needs still apply.

Validation includes unit/API/browser regression tests and a live synthetic n8n
acceptance run. The live run read an uploaded error screenshot, generated five
regression drafts, created three cadence iterations and retained not-run status.
The synthetic project was archived and temporary probe endpoints/credentials
were removed after validation.
