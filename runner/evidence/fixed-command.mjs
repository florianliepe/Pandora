import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const evidenceDir = dirname(fileURLToPath(import.meta.url));
const harnessRoot = resolve(evidenceDir, "../..");

const commands = Object.freeze({
  graphNodeDetail: "scripts/validate-graph-node-detail-contract.cjs",
  graphPromotions: "scripts/validate-graph-promotions.cjs",
  graphPostgresSchema: "scripts/validate-postgres-graph-schema.cjs",
  azureSearchContracts: "scripts/validate-azure-search-contracts.cjs",
  actorTwinRouting: "scripts/validate-actor-twin-routing.cjs",
  agentRuntimeHandoffs: "scripts/validate-agent-runtime-handoffs.cjs",
  n8nAgentWorkflows: "scripts/validate-n8n-ai-agent-workflows.cjs",
  graphBrowser: "scripts/browser-dark-mode-qa.cjs",
  agentBrowser: "scripts/browser-chat-local-url-setup-qa.cjs",
});

function inheritedEnvironment(extra = {}) {
  const allowed = ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"];
  return {
    ...Object.fromEntries(allowed.filter((key) => process.env[key]).map((key) => [key, process.env[key]])),
    ...extra,
  };
}

export async function targetRoot() {
  const value = process.env.PANDORA_TARGET_ROOT;
  if (!value || !isAbsolute(value)) throw new Error("PANDORA_TARGET_ROOT must be an absolute checkout path");
  return realpath(value);
}

export async function runFixedCommand(name, { args = [], env = {}, timeout = 120000 } = {}) {
  const relative = commands[name];
  if (!relative) throw new Error(`Unknown fixed evidence command: ${name}`);
  const root = await targetRoot();
  const script = resolve(root, relative);
  const expectedPrefix = `${root}${process.platform === "win32" ? "\\" : "/"}`;
  if (!script.startsWith(expectedPrefix)) throw new Error("Fixed evidence command escaped the target checkout");
  try {
    return await execFileAsync(process.execPath, [script, ...args], {
      cwd: root,
      env: inheritedEnvironment(env),
      timeout,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    const stdout = String(error.stdout || "").slice(-4000);
    const stderr = String(error.stderr || "").slice(-4000);
    throw new Error(`Fixed command ${name} failed\n${stdout}\n${stderr}`.trim(), { cause: error });
  }
}

export async function withPrivateTempDirectory(prefix, operation) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await operation(root);
  } finally {
    if (resolve(dirname(root)) !== resolve(tmpdir()) || !root.startsWith(join(tmpdir(), prefix))) {
      throw new Error("Unexpected evidence cleanup target");
    }
    await rm(root, { recursive: true, force: true });
  }
}

export function playwrightEnvironment(portName, port) {
  return {
    NODE_PATH: resolve(harnessRoot, "node_modules"),
    [portName]: String(port),
  };
}
