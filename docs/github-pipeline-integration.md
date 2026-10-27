# Intellectual Twin repository integration

The project owner connects the reviewed Intellectual Twin preset under **Repositories & CI**.
Members can read observations; only owners can connect or disconnect polling. Connection
changes use optimistic revision checks. Repository names and workflow IDs are allowlisted
on the server, not taken from browser URLs.

Sources on `main`:

- `florianliepe/meids-app`: workflow IDs 354029928 (production frontend), 390689734
  (production backend), and 328868831 (Pages sandbox).
- `florianliepe/meids-agent-configs`: current source revision only; no CI configured.
- `meids-knowledge-fabric` is deliberately outside this connection.

`scripts/pipeline-workflow.mjs` generates the internal n8n collector. Every five minutes it
reads enabled project connections through the existing storage lease, releases the lease,
fetches GitHub metadata using the existing encrypted GitHub credential, and saves normalized
observations through the same storage boundary. All source-repository requests are GETs.
No source workflows, deployments, issues or branches are changed. Credentials never reach
the browser, Git state, or saved execution payloads.

The collector keeps the latest three runs per workflow, including the current run attempt,
commit, event, environment label, job results and up to 40 steps per job / 12 jobs per run.
Full details remain linked on GitHub. Polling is a recent snapshot, not a complete event log;
short-lived intermediate transitions can be missed. It is not suitable as a DORA event source.
Repeated observations replace the bounded snapshot instead of growing the audit history.
Out-of-order observations and observations from disconnected/reconfigured projects are
ignored. Failed workflow fetches retain previous runs marked stale; an observation older
than 15 minutes is visibly stale. Read errors are shown, not converted to passing results.

The UAT JSON at `docs/uat/agent-interaction-uat-results.json` is fetched at the exact observed
source commit. It is displayed as **historical versioned evidence**, retaining its recorded
timestamp, file blob SHA, source commit, case IDs and status. A source commit is not proof
of the revision actually tested. The four existing cases include historical failures that
may predate later fixes. No historical result automatically changes issue or test status.
Only the first 40 cases and bounded findings are displayed; the original file is linked.

Workflow success is also not functional verification: advisory/continue-on-error checks can
fail within successful workflows. Pandora displays step conclusions separately and keeps
its existing version-bound functional verification rules. Structured test-report publishing,
case/issue correlation, full deployment events, incident linkage and DORA calculations are
future work and require development-pipeline changes.

## Deployment and verification

1. `node scripts/build-n8n.mjs`
2. `node scripts/api-workflow.mjs --deploy`
3. `node scripts/api-workflow.mjs --worker --deploy`
4. `node scripts/pipeline-workflow.mjs --deploy --activate`

Keep `.local/api-workflow-id`, `.local/quality-store-id` and `.local/pipeline-reader-id`
for updating existing workflows. API credentials stay in environment variables and n8n.
The collector uses GitHub Contents and Actions read access (and metadata); its existing
credential may have broader permissions for Pandora storage, but the collector only reads
the fixed source allowlist. A dedicated read-only GitHub App is a future hardening step.

Run `npm test`, `npm run check`, `npm run build`, and `npm run test:e2e` before publishing.
Tests cover ownership, public ingestion rejection, source/commit filtering, rerun attempts,
stale evidence, idempotency, configuration races, and browser connect/disconnect behavior.
Verify live polling against GitHub and check the rendered view after Pages deployment.

Reference: [GitHub workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs)
and [workflow jobs API](https://docs.github.com/en/rest/actions/workflow-jobs).
