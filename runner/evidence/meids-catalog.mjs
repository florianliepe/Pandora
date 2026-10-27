import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRepository = "florianliepe/meids-app";
const sourceBranch = "main";

const blockedIssues = Object.freeze({
  "da380680-c1e3-414d-a4b9-0aa3fdf58912": "KG-010 requires two real principals and isolated API, Search, Blob and graph evidence (ISO-01/02)",
  "dbec6edb-89c7-4f73-bac6-d23edc19017b": "KG-009 requires disposable PostgreSQL, Blob and Search fault injection (TX-01, OUT-01/02/03)",
  "83ef87ab-3a4a-4fc3-ab41-8f8115535917": "KG-008 requires scheduled reconciliation, orphan reporting and controlled repair evidence (REC-01)",
  "4172881f-ca69-499a-a215-ca51a5a002a7": "KG-013 requires isolated live n8n callback, cancellation, timeout and approval-boundary evidence (AGT-02)",
  "dd9513e8-aa28-4b63-88df-d0d049fcea5e": "KG-012 requires deployed workflow-ID and callable/public-wrapper topology evidence (AGT-01)",
  "ed78a4fb-6dfb-4532-b774-ea35364ce54f": "KG-014 requires an empty nonproduction Search rebuild, concurrent writes, cutover and rollback (REC-02)",
  "fc07636a-fb87-46fd-8883-fe29212db162": "KG-011 requires a versioned multilingual corpus and controlled model migration/rollback results (SEM-02)",
});

const supported = Object.freeze({
  "MEIDS-GRAPH-RELATION-CONTRACT-V1": Object.freeze({
    regression: Object.freeze({ file: "runner/evidence/meids-graph-regression.test.mjs", testName: "MEIDS graph relation contract" }),
    integration: Object.freeze({ file: "runner/evidence/meids-graph-integration.test.mjs", testName: "MEIDS graph relation integration" }),
    browser: Object.freeze({ file: "runner/evidence/meids-graph-browser.test.mjs", testName: "MEIDS graph relation browser interaction" }),
  }),
});

const marker = /^\[AUTO:([A-Z0-9-]+-V[1-9][0-9]*)\](?:\s|$)/;

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value;
}

export function supportedAutomationCodes() {
  return Object.keys(supported);
}

export function resolveMeidsEvidencePlan(handoff, { phase, kind, environment, targetId } = {}) {
  requireObject(handoff, "Handoff");
  if (handoff.repository !== sourceRepository || handoff.baseBranch !== sourceBranch) {
    throw new Error("The Me.IDs evidence catalog only supports florianliepe/meids-app main");
  }
  if (!['reproduction', 'candidate', 'post_deployment'].includes(phase)) throw new Error("Evidence phase is invalid");
  if (!['regression', 'integration', 'browser'].includes(kind)) throw new Error("Evidence kind is invalid");
  if (typeof environment !== "string" || !environment.trim()) throw new Error("Evidence environment is required");
  if (phase === "post_deployment") {
    throw new Error("Hosted post-deployment evidence is unsupported until a reviewed authenticated browser harness and disposable test identity exist");
  }
  if (phase === "reproduction" && kind !== "regression") {
    throw new Error("Baseline reproduction is restricted to the reviewed regression harness");
  }
  const issueId = handoff.issueId || handoff.snapshot?.report?.id;
  if (blockedIssues[issueId]) throw new Error(`Live acceptance gap preserved: ${blockedIssues[issueId]}`);
  const tests = handoff.snapshot?.tests;
  if (!Array.isArray(tests) || !tests.length) throw new Error("Handoff has no pinned acceptance cases");
  const files = new Set();
  const mappings = tests.map((item) => {
    requireObject(item, "Pinned acceptance case");
    if (item.reviewStatus !== "approved") throw new Error(`Pinned case ${item.id || "unknown"} is not approved`);
    const match = String(item.title || "").match(marker);
    if (!match) throw new Error(`Pinned case ${item.id || "unknown"} has no reviewed automation marker`);
    const entry = supported[match[1]]?.[kind];
    if (!entry) throw new Error(`Pinned case ${item.id || "unknown"} uses unsupported automation code ${match[1]} for ${kind}`);
    if (typeof item.id !== "string" || !item.id || !Number.isSafeInteger(item.version) || item.version < 1) {
      throw new Error("Pinned case identity is invalid");
    }
    files.add(entry.file);
    return { caseId: item.id, caseVersion: item.version, testName: entry.testName };
  });
  return {
    phase,
    kind,
    environment: environment.trim(),
    ...(targetId ? { targetId } : {}),
    files: [...files],
    mappings,
    timeoutMs: kind === "browser" ? 240000 : 120000,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const get = (name) => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
    return args[index + 1];
  };
  const handoff = JSON.parse(await readFile(resolve(get("--handoff")), "utf8"));
  const output = resolve(get("--output"));
  const plan = resolveMeidsEvidencePlan(handoff, {
    phase: get("--phase"),
    kind: get("--kind"),
    environment: get("--environment"),
    ...(args.includes("--target") ? { targetId: get("--target") } : {}),
  });
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
