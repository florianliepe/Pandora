const ISSUE_ID = "da380680-c1e3-414d-a4b9-0aa3fdf58912";
const CASES = Object.freeze({
  "ISO-01": Object.freeze({ caseId: "4935383c-519d-4940-a8d0-c758d1832c3e", version: 1 }),
  "ISO-02": Object.freeze({ caseId: "dae0d6e0-b7a2-4776-a13e-005bc7da1ed9", version: 1 }),
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const azureName = /^[A-Za-z0-9][A-Za-z0-9._-]{1,126}$/;
const secretName = /^[A-Z_][A-Z0-9_]{2,127}$/;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function keys(value, expected, label) {
  if (!object(value) || Object.keys(value).some((key) => !expected.includes(key))) {
    throw new Error(`${label} has unknown or invalid fields`);
  }
  for (const key of expected) if (!(key in value)) throw new Error(`${label}.${key} is required`);
  return value;
}

function text(value, label, pattern = null) {
  if (typeof value !== "string" || !value.trim() || value.length > 300 || (pattern && !pattern.test(value))) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function httpsOrigin(value, label, suffix = "") {
  const url = new URL(text(value, label));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`${label} must be a bare HTTPS origin`);
  }
  if (suffix && !url.hostname.endsWith(suffix)) throw new Error(`${label} is outside the approved Azure service domain`);
  return url.origin;
}

function principal(value, index) {
  const label = `principals[${index}]`;
  keys(value, ["label", "tenantId", "objectId", "credentialSecretName", "expectedOrganizationId", "expectedUserId", "expectedTwinId"], label);
  text(value.label, `${label}.label`, /^(principal_a|principal_b)$/);
  text(value.tenantId, `${label}.tenantId`, uuid);
  text(value.objectId, `${label}.objectId`, uuid);
  text(value.credentialSecretName, `${label}.credentialSecretName`, secretName);
  text(value.expectedOrganizationId, `${label}.expectedOrganizationId`, azureName);
  text(value.expectedUserId, `${label}.expectedUserId`, azureName);
  text(value.expectedTwinId, `${label}.expectedTwinId`, azureName);
  return { ...value };
}

export function validateKg010Manifest(value) {
  keys(value, ["schemaVersion", "issueId", "cases", "environment", "principals", "safety"], "KG-010 manifest");
  if (value.schemaVersion !== 1 || value.issueId !== ISSUE_ID) throw new Error("KG-010 manifest identity is invalid");
  if (!Array.isArray(value.cases) || value.cases.length !== 2) throw new Error("KG-010 requires the two pinned ISO cases");
  for (const [code, expected] of Object.entries(CASES)) {
    const item = value.cases.find((candidate) => candidate?.code === code);
    keys(item, ["code", "caseId", "version"], `cases.${code}`);
    if (item.caseId !== expected.caseId || item.version !== expected.version) throw new Error(`${code} case identity changed`);
  }
  keys(value.environment, ["classification", "backendOrigin", "resourceGroup", "postgresServer", "database", "blobAccount", "blobContainer", "searchEndpoint", "approvedIndex", "workingIndex", "graphApiPath"], "environment");
  if (value.environment.classification !== "nonproduction") throw new Error("KG-010 cannot run against a production environment");
  httpsOrigin(value.environment.backendOrigin, "environment.backendOrigin", ".azurewebsites.net");
  httpsOrigin(value.environment.searchEndpoint, "environment.searchEndpoint", ".search.windows.net");
  for (const field of ["resourceGroup", "postgresServer", "database", "blobAccount", "blobContainer", "approvedIndex", "workingIndex"]) {
    text(value.environment[field], `environment.${field}`, azureName);
  }
  if (value.environment.graphApiPath !== "/api/okf/graph") throw new Error("KG-010 graph API path is not approved");
  if (!Array.isArray(value.principals) || value.principals.length !== 2) throw new Error("KG-010 requires two principals");
  const principals = value.principals.map(principal);
  for (const field of ["label", "objectId", "credentialSecretName", "expectedUserId", "expectedTwinId"]) {
    if (new Set(principals.map((item) => item[field].toLowerCase())).size !== 2) throw new Error(`KG-010 principals must have distinct ${field}`);
  }
  if (new Set(principals.map((item) => item.tenantId.toLowerCase())).size !== 1) throw new Error("KG-010 principals must authenticate in the same reviewed tenant");
  if (new Set(principals.map((item) => item.expectedOrganizationId.toLowerCase())).size !== 1) throw new Error("KG-010 principals must share the reviewed organization boundary");
  keys(value.safety, ["productionDataPresent", "syntheticWritesOnly", "cleanupRequired", "readOnlyObservability", "maxRuntimeMinutes", "expiresAt"], "safety");
  if (value.safety.productionDataPresent !== false || value.safety.syntheticWritesOnly !== true || value.safety.cleanupRequired !== true || value.safety.readOnlyObservability !== true) {
    throw new Error("KG-010 safety controls are incomplete");
  }
  if (!Number.isSafeInteger(value.safety.maxRuntimeMinutes) || value.safety.maxRuntimeMinutes < 1 || value.safety.maxRuntimeMinutes > 60) throw new Error("KG-010 runtime bound is invalid");
  const expires = Date.parse(value.safety.expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 7 * 86400000) throw new Error("KG-010 manifest expiry must be within seven days");
  return structuredClone(value);
}

const surfaces = ["api_direct_id", "search_filter", "blob_path", "graph_traversal"];

function matrixRow(row, index, manifest) {
  keys(row, ["principal", "surface", "ownMarkerVisible", "foreignMarkerVisible", "status", "evidenceDigest"], `matrix[${index}]`);
  if (!manifest.principals.some((item) => item.label === row.principal)) throw new Error("KG-010 matrix principal is unknown");
  if (!surfaces.includes(row.surface)) throw new Error("KG-010 matrix surface is unknown");
  if (row.ownMarkerVisible !== true || row.foreignMarkerVisible !== false || row.status !== "passed") throw new Error("KG-010 isolation matrix contains a failed observation");
  text(row.evidenceDigest, `matrix[${index}].evidenceDigest`, /^[a-f0-9]{64}$/);
  return row;
}

export function validateKg010ProbeResult(value, rawManifest) {
  const manifest = validateKg010Manifest(rawManifest);
  keys(value, ["schemaVersion", "issueId", "runId", "runMarker", "startedAt", "completedAt", "authenticatedObjects", "matrix", "revocation", "cleanup"], "KG-010 probe result");
  if (value.schemaVersion !== 1 || value.issueId !== ISSUE_ID || !uuid.test(value.runId)) throw new Error("KG-010 probe identity is invalid");
  text(value.runMarker, "runMarker", /^pandora-kg010-[0-9a-f-]{36}$/i);
  if(value.runMarker!==`pandora-kg010-${value.runId}`)throw new Error("KG-010 marker does not match the probe run");
  const started = Date.parse(value.startedAt), completed = Date.parse(value.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started || completed - started > manifest.safety.maxRuntimeMinutes * 60000) throw new Error("KG-010 probe timing is invalid");
  if(completed>Date.now()+60000||Date.now()-completed>300000)throw new Error("KG-010 probe result must be current");
  if (!Array.isArray(value.authenticatedObjects) || value.authenticatedObjects.length !== 2) throw new Error("KG-010 requires two authenticated token subjects");
  const expectedObjects = new Set(manifest.principals.map((item) => item.objectId.toLowerCase()));
  if (new Set(value.authenticatedObjects.map((item) => String(item).toLowerCase())).size !== 2 || value.authenticatedObjects.some((item) => !expectedObjects.has(String(item).toLowerCase()))) {
    throw new Error("KG-010 authenticated objects do not match the reviewed principals");
  }
  if (!Array.isArray(value.matrix) || value.matrix.length !== surfaces.length * 2) throw new Error("KG-010 isolation matrix is incomplete");
  value.matrix.forEach((row, index) => matrixRow(row, index, manifest));
  for (const principal of manifest.principals) for (const surface of surfaces) {
    if (value.matrix.filter((row) => row.principal === principal.label && row.surface === surface).length !== 1) throw new Error("KG-010 isolation matrix coverage is ambiguous");
  }
  keys(value.revocation, ["principal", "apiDenied", "searchEmpty", "blobDenied", "graphEmpty", "evidenceDigest"], "revocation");
  if (!manifest.principals.some((item) => item.label === value.revocation.principal) || ![value.revocation.apiDenied, value.revocation.searchEmpty, value.revocation.blobDenied, value.revocation.graphEmpty].every((item) => item === true)) throw new Error("KG-010 revocation evidence is incomplete");
  text(value.revocation.evidenceDigest, "revocation.evidenceDigest", /^[a-f0-9]{64}$/);
  keys(value.cleanup, ["markersRemoved", "outboxDrained", "evidenceDigest"], "cleanup");
  if (value.cleanup.markersRemoved !== true || value.cleanup.outboxDrained !== true) throw new Error("KG-010 synthetic data cleanup is incomplete");
  text(value.cleanup.evidenceDigest, "cleanup.evidenceDigest", /^[a-f0-9]{64}$/);
  return structuredClone(value);
}

export const KG010 = Object.freeze({ issueId: ISSUE_ID, cases: CASES, surfaces: Object.freeze([...surfaces]) });
