import test from "node:test";
import assert from "node:assert/strict";
import { resolveMeidsEvidencePlan, supportedAutomationCodes } from "../runner/evidence/meids-catalog.mjs";

function handoff(overrides = {}) {
  return {
    repository: "florianliepe/meids-app",
    baseBranch: "main",
    issueId: "11111111-1111-4111-8111-111111111111",
    snapshot: {
      report: { id: "11111111-1111-4111-8111-111111111111" },
      tests: [{
        id: "case-graph",
        version: 3,
        title: "[AUTO:MEIDS-GRAPH-RELATION-CONTRACT-V1] Graph relation projection remains reviewable",
        reviewStatus: "approved",
      }],
    },
    ...overrides,
  };
}

test("catalog exposes only reviewed fixed Me.IDs automation classes", () => {
  assert.deepEqual(supportedAutomationCodes(), ["MEIDS-GRAPH-RELATION-CONTRACT-V1"]);
});

test("catalog maps the pinned case identity to fixed regression, integration and browser tests", () => {
  const regression = resolveMeidsEvidencePlan(handoff(), { phase: "reproduction", kind: "regression", environment: "isolated" });
  assert.deepEqual(regression.files, ["runner/evidence/meids-graph-regression.test.mjs"]);
  assert.deepEqual(regression.mappings, [{ caseId: "case-graph", caseVersion: 3, testName: "MEIDS graph relation contract" }]);
  const integration = resolveMeidsEvidencePlan(handoff(), { phase: "candidate", kind: "integration", environment: "isolated" });
  assert.equal(integration.mappings[0].testName, "MEIDS graph relation integration");
  const browser = resolveMeidsEvidencePlan(handoff(), { phase: "candidate", kind: "browser", environment: "isolated" });
  assert.equal(browser.mappings[0].testName, "MEIDS graph relation browser interaction");
  assert.equal(browser.timeoutMs, 240000);
});

test("catalog fails closed for unreviewed, unmarked, unknown and mixed pinned cases", () => {
  const base = handoff();
  assert.throws(() => resolveMeidsEvidencePlan(handoff({ snapshot: { ...base.snapshot, tests: [{ ...base.snapshot.tests[0], reviewStatus: "draft" }] } }), { phase: "candidate", kind: "regression", environment: "isolated" }), /not approved/);
  assert.throws(() => resolveMeidsEvidencePlan(handoff({ snapshot: { ...base.snapshot, tests: [{ ...base.snapshot.tests[0], title: "Graph relation projection" }] } }), { phase: "candidate", kind: "regression", environment: "isolated" }), /no reviewed automation marker/);
  assert.throws(() => resolveMeidsEvidencePlan(handoff({ snapshot: { ...base.snapshot, tests: [{ ...base.snapshot.tests[0], title: "[AUTO:UNKNOWN-CONTRACT-V1] Unknown" }] } }), { phase: "candidate", kind: "regression", environment: "isolated" }), /unsupported automation code/);
  assert.throws(() => resolveMeidsEvidencePlan(handoff({ snapshot: { ...base.snapshot, tests: [{ ...base.snapshot.tests[0], title: "[AUTO:MEIDS-AGENT-ROUTING-CONTRACT-V1] Agent routing" }] } }), { phase: "candidate", kind: "browser", environment: "isolated" }), /unsupported automation code/);
  assert.throws(() => resolveMeidsEvidencePlan(handoff({ snapshot: { ...base.snapshot, tests: [...base.snapshot.tests, { id: "manual", version: 1, title: "Manual only", reviewStatus: "approved" }] } }), { phase: "candidate", kind: "regression", environment: "isolated" }), /no reviewed automation marker/);
});

test("KG-008 through KG-014 and hosted verification remain explicit unsupported gaps", () => {
  for (const issueId of [
    "da380680-c1e3-414d-a4b9-0aa3fdf58912",
    "dbec6edb-89c7-4f73-bac6-d23edc19017b",
    "83ef87ab-3a4a-4fc3-ab41-8f8115535917",
    "4172881f-ca69-499a-a215-ca51a5a002a7",
    "dd9513e8-aa28-4b63-88df-d0d049fcea5e",
    "ed78a4fb-6dfb-4532-b774-ea35364ce54f",
    "fc07636a-fb87-46fd-8883-fe29212db162",
  ]) {
    assert.throws(() => resolveMeidsEvidencePlan(handoff({ issueId }), { phase: "candidate", kind: "regression", environment: "isolated" }), /Live acceptance gap preserved/);
  }
  assert.throws(() => resolveMeidsEvidencePlan(handoff(), { phase: "post_deployment", kind: "browser", environment: "Azure", targetId: "production_frontend" }), /Hosted post-deployment evidence is unsupported/);
});

test("baseline reproduction cannot be relabelled as integration or browser evidence", () => {
  assert.throws(() => resolveMeidsEvidencePlan(handoff(), { phase: "reproduction", kind: "browser", environment: "isolated" }), /restricted to the reviewed regression harness/);
});
