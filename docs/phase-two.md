# Phase two: repository and Codex integration contract

This is a design contract, not an implemented autonomous repair service.

## End-to-end path

1. A member reports an issue with reproduction steps, expected behavior and screenshots.
2. An owner/developer requests analysis for an allowlisted repository and base SHA.
3. An authenticated worker retrieves only the selected project's issue/evidence.
4. The worker starts an isolated checkout, treats all issue content as untrusted,
   reproduces the failure and adds a regression test before proposing a fix.
5. Unit, integration, functional/browser and relevant cross-fix regression suites
   execute against the resulting commit. Reports retain repository, commit, run
   ID, environment, test case version, timestamps and evidence references.
6. A PR links the issue, reproduction, changes, tests and remaining uncertainty.
7. A human reviews and approves merge. Deployment and post-deployment testing
   report back to Pandora; verification/reopening remains an explicit workflow action.

## Job envelope

`jobId`, `projectId`, `issueIds`, `repositoryInstallationId`, `repository`,
`baseSha`, `requestedBy`, `approvalMode`, `allowedCommands`, `testPlan`,
`idempotencyKey`, `expiresAt` and a short-lived project/repository-scoped capability.

Do not trust a client-provided role, repository URL or project ID without server
authorization. Prefer GitHub App installation tokens to a broad personal token.
Use signed webhooks, delivery-ID deduplication and retry-safe state transitions.
Reject stale results whose commit does not match the current candidate revision.
Do not run privileged workflows from untrusted fork content.

## Call n8n Workflow Tool candidates

- `read_issue_context`: current phase-one advisory snapshot.
- `propose_regression_tests`: propose test cases for human review.
- `request_fix_analysis`: create a scoped worker job after authorization.
- `read_pipeline_evidence`: read status, logs and artifacts for an exact commit.
- `request_verification`: route a tested candidate to the tester role.

Mutation tools must enforce permissions in the API independently of model output.

## Optional agentic merge

The UI currently shows the switch disabled. Future enablement must be owner-only,
per repository, default-off and recorded in the audit log. Enforce protected branch
rules, required checks, commit freshness, allowed change paths, rollback readiness
and an emergency disable. No workflow may infer permission from an issue's text.
Human approval remains the default. A separate automation identity should never
be a general project owner.

## DORA events

Store immutable deployment and incident records with environment, commit range,
start/end timestamps, success/failure, recovery linkage and planned/unplanned
classification. Compute metrics per service and time window. Test runs are not
deployments, and bug counts are not change fail rates.
