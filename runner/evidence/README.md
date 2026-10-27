# Me.IDs trusted evidence harness

This harness is deliberately narrower than the Me.IDs acceptance backlog. It turns only an
approved case title beginning with this exact marker into reviewed commands:

- `[AUTO:MEIDS-GRAPH-RELATION-CONTRACT-V1]`

The resolver copies the pinned case ID and version from the private Pandora handoff. The
marker selects committed test files and exact top-level Node test names; issue text never
supplies a command, path, URL or expected result. `scripts/run-delivery-tests.mjs` remains the
evidence producer and rejects dirty/wrong-revision checkouts, ambiguous names, interrupted
runs and suite failures.

The graph class executes the existing Me.IDs graph-node, promotion, PostgreSQL projection,
Azure Search contract and local Playwright graph-interaction checks. These prove source
contracts only. They do not prove live n8n bindings, real Search/Blob/PostgreSQL state,
semantic quality or tenant isolation.

Generate a plan from a private handoff, then pass it to the existing producer:

```text
node runner/evidence/meids-catalog.mjs --handoff <handoff.json> --phase candidate --kind regression --environment isolated-meids --output <plan.json>
node scripts/run-delivery-tests.mjs --checkout <clean-meids-checkout> --harness <clean-pandora-checkout> --handoff <handoff.json> --plan <plan.json>
```

For a candidate, repeat with `integration` and `browser`. Reproduction is regression-only and
must actually fail on the pinned base revision. The harness does not manufacture an expected
failure. Playwright and its pinned Chromium build must be installed in the clean Pandora
harness checkout; Me.IDs application dependencies must be installed in each target checkout.

## Explicit unsupported prerequisites

- KG-010 / ISO-01/02: two dedicated principals in different scopes, isolated records, Blob
  paths, Search filters and graph projections, read-only observability and cleanup.
- KG-009: disposable PostgreSQL, Blob and Search resources with controlled failure injection.
- KG-008: scheduled reconciliation, orphan fixtures, repair SLA and idempotent rerun.
- KG-013: isolated live n8n callbacks, cancellation, retry/timeout and approval boundaries.
- KG-012: deployed workflow-ID registry plus callable/public-wrapper observations.
- KG-014: empty nonproduction Search rebuild with concurrent writes, cutover and rollback.
- KG-011: versioned multilingual corpus, model-specific thresholds and migration rollback.
- Hosted post-deployment browser evidence: a reviewed authenticated read-only flow, disposable
  identity/data and exact deployment URL. Local browser tests cannot substitute for it.
- Agent routing: the current fixed regression and integration commands pass, but the existing
  browser QA still expects removed local webhook-override controls. A reviewed Actor Twin
  browser interaction test is required before this class can enter the automation catalog.

The resolver rejects every KG-008 through KG-014 issue ID even if an automation marker is
added. Those gaps require their stated real-environment evidence and remain human-visible
`needs_input` work until the prerequisites exist.
