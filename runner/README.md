# Pandora unattended issue runner

This package is a reviewable, disabled-by-default bridge from one committed Pandora issue
event to one private GitHub Actions run. It only permits source publication to
`florianliepe/meids-app`. It does not copy browser/Desktop authentication and it does not
accept issue text as shell authority.

## Installation target

Copy this package into the private `florianliepe/Pandora-data` repository:

- `runner/pandora-issue-runner.yml` -> `.github/workflows/pandora-issue-runner.yml`
- `runner/pandora-runner-preflight.yml` -> `.github/workflows/pandora-runner-preflight.yml`
- `runner/bridge.mjs`, `runner/protocol.mjs`, `runner/prepare-prompt.mjs`, and
  `runner/verify-source.mjs` -> `runner/`

The workflow name and run name are contractually fixed. The only dispatch input is
`event_id`, and it must be a UUID. Do not enable the workflow until every readiness item
below is satisfied.

## Repository secrets

Configure only these secret names in the private runner repository:

- `PANDORA_BRIDGE_URL`: production URL of the dedicated n8n receiver webhook.
- `PANDORA_WORKER_TOKEN`: value held by n8n Header Auth credential
  `Pandora unattended runner (Intellectual Twin)`.
- `OPENAI_API_KEY`: project-scoped key with a bounded budget and rotation owner.
- `MEIDS_APP_GITHUB_TOKEN`: short-lived GitHub App token is preferred. A fine-grained PAT is
  acceptable only during the pilot and must be restricted to `florianliepe/meids-app`.

Secrets are supplied to individual steps, never at job scope. The private handoff,
capability and model final message remain under `.runner/private` on the ephemeral runner.
They are not uploaded as artifacts or printed.

## Hosted receiver

Generate the sanitized n8n workflow with:

```text
node scripts/issue-runner-receiver-workflow.mjs
```

It binds the project-scoped Header Auth credential, rejects browser-origin calls, checks
schema/version/event/run bounds, forces the Intellectual Twin project and `codex-local`
worker identity, disables successful/error execution retention, and delegates authorization
to the canonical Pandora store. Deployment and activation are intentionally separate:

```text
node scripts/issue-runner-receiver-workflow.mjs --deploy
node scripts/issue-runner-receiver-workflow.mjs --deploy --activate
```

Do not run either command from this review branch.

## Required store operations

The existing store already implements `start`, `status`, `cancelled`, `renew`, `evidence`,
`report`, and `finish`. Three additional issue-runner operations are required before the
hard stop in the workflow may be removed:

### `POST /automation/issues/preflight`

This is a separate nondestructive readiness path. It accepts a synthetic fixed UUID, GitHub
run ID, random nonce, mode (`callback`, `provider`, or `cancellation`), phase and the literal
receiver workflow path. It never claims an issue, creates a delivery, changes source, or
updates issue status. The readiness collector independently reads the preflight run at its
exact commit and binds the observation to the Git blob SHA of
`runner/issue-runner-receiver.workflow.json`. Do not bind readiness to the mutable
`Pandora-data` branch HEAD or to fixture output.

### `POST /automation/issues/publish`

Input: event/run identity, active delivery capability, repository, base branch/SHA, head
branch/SHA, PR number/URL and the exact opaque `Pandora-Delivery: <job UUID>` marker.
Verify the active lease, current event, allowed repository, exact pinned base, branch name,
GitHub PR repository/base/head and marker. Persist the PR link through the existing
correlation model. Return `{accepted:true}` only after independent GitHub observation.

### `POST /automation/issues/merge-readiness`

Input: event/run identity, active capability, exact PR/head/base, fresh branch-protection
snapshot and successful required-check observations. Re-fetch GitHub state with the trusted
n8n credential. Require complete Pandora reproduction and candidate reports, current PR
correlation, non-draft/mergeable PR, exact head SHA, enabled protection and every required
check successful at that SHA. Return a short-lived, single-use merge authorization bound to
event, job, PR and head SHA. Never accept the model response as evidence.

### `POST /automation/issues/merged`

Input: event/run identity, capability, consumed merge authorization, PR, prior head SHA and
GitHub merge SHA. Re-fetch the PR and verify the exact authorized head was merged to `main`.
Persist only the attestation. Existing deployment collectors must then observe the merge SHA;
post-deployment regression/integration/browser reports and explicit owner/tester acceptance
remain mandatory.

All writes are idempotent by event/run/operation and reject stale events, expired leases,
changed issue evidence, changed repository connection, foreign repositories, reused
attestations with different content, and mismatched SHAs.

## Readiness and evidence gap

The checked-in workflow intentionally stops immediately after sanitized PR publication.
Remove that stop only after the three operations above and a trusted evidence harness exist.
The harness must execute a failing reproduction at the pinned base SHA and passing
regression, integration and real browser tests at the exact candidate SHA, mapping every
pinned Pandora case/version. It must submit structured reports through the existing delivery
worker API. A model-authored summary, test command, or check name is never proof.

After merge, existing deployment observations must show the merge SHA for every selected
target. Post-deployment reports must run against those observed targets. The tester's
explicit accept decision remains the final gate; the runner may not manufacture it.

Before production dispatch is enabled, run the separate preflight workflow in `callback`
and `provider` modes. For cancellation, start `cancellation`, wait until the sleep step is
active, cancel that exact run through the dispatcher/API, and require the authenticated
`cancelled` phase plus GitHub's independent cancelled conclusion. These probes use no real
issue event and perform no source writes.

## Current blockers

- `OPENAI_API_KEY` must be provisioned in `Pandora-data` before a run can start.
- The API Platform project/sign-in and budget owner must be confirmed.
- The three store operations above are not implemented in the current base.
- A reviewed issue-specific regression/integration/browser evidence harness is not yet
  available for unattended use.
- Automatic source writes stay restricted to `meids-app`; agent-config repository writes are
  disabled because its current private-repository plan cannot enforce the required branch
  protection.
