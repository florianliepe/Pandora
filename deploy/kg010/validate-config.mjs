import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = new URL("./", import.meta.url);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const resourceName = /^[a-z0-9][a-z0-9._-]{1,62}$/;
const secretName = /^[A-Z][A-Z0-9_]{2,127}$/;
const requiredMigrations = Array.from({ length: 15 }, (_, index) => String(index + 1).padStart(3, "0"));

function fail(message) {
  throw new Error(`KG010 deployment config: ${message}`);
}

function requireText(value, label, pattern = null) {
  if (typeof value !== "string" || !value.trim() || (pattern && !pattern.test(value))) fail(`${label} is invalid`);
  return value;
}

function walk(value, path = "config") {
  if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (/^(password|secretValue|accessToken|apiKey|clientSecret)$/i.test(key)) fail(`${path}.${key} must never be committed`);
    walk(item, `${path}.${key}`);
  }
}

function assertDistinct(values, label) {
  if (new Set(values.map((item) => String(item).toLowerCase())).size !== values.length) fail(`${label} must be distinct`);
}

export function validateKg010DeploymentConfig(config) {
  walk(config);
  if (config?.schemaVersion !== 1 || config.classification !== "nonproduction" || config.purpose !== "kg010-isolation-probe") fail("identity is invalid");
  if (config.source?.repository !== "florianliepe/meids-app" || !/^[a-f0-9]{40}$/.test(config.source?.commit || "")) fail("source must pin the Me.IDs repository to a commit");
  if (config.source.foundationTemplate !== "infra/azure/main.bicep" || config.source.dataPlaneTemplate !== "infra/azure/production-data-plane.bicep") fail("approved templates changed");
  const migrations = config.source?.requiredMigrations || [];
  if (migrations.length !== 15 || !requiredMigrations.every((prefix, index) => migrations[index]?.startsWith(`${prefix}_`) && migrations[index].endsWith(".sql"))) fail("all ordered migrations 001 through 015 are required");

  if (!uuid.test(config.azure?.subscriptionId || "") || !uuid.test(config.azure?.tenantId || "")) fail("Azure subscription or tenant is invalid");
  if (config.azure.location !== "westeurope" || config.azure.resourceGroup !== "rg-meids-kg010-np") fail("the reviewed isolated resource boundary changed");
  if (!Number.isSafeInteger(config.azure.expiresAfterHours) || config.azure.expiresAfterHours < 1 || config.azure.expiresAfterHours > 168) fail("expiry must be within seven days");
  if (config.azure.tags?.["data-classification"] !== "synthetic-only" || config.azure.tags?.environment !== "kg010-nonproduction") fail("synthetic-only tags are required");

  const names = Object.entries(config.resources || {}).filter(([key]) => !["database", "privateDnsPostgres"].includes(key));
  for (const [key, value] of names) requireText(value, `resources.${key}`, resourceName);
  assertDistinct(names.map(([, value]) => value), "resource names");
  for (const forbidden of config.forbiddenResources || []) {
    if (JSON.stringify(config.resources).toLowerCase().includes(String(forbidden).toLowerCase())) fail(`production/UAT resource ${forbidden} is referenced`);
  }
  if (!Object.values(config.resources).every((value) => !String(value).includes("prod"))) fail("resource names must not contain prod");

  if (config.network?.vnetAddressPrefix !== "10.43.0.0/16" || Object.values(config.network).includes("10.42.0.0/16") || config.network.publicDataPlaneAccess !== false) fail("private isolated 10.43.0.0/16 networking is required");
  if (config.database?.sku !== "Standard_B1ms" || config.database.storageSizeGb !== 32 || config.database.backupRetentionDays !== 7) fail("reviewed disposable PostgreSQL sizing changed");
  if (config.database.geoRedundantBackup || config.database.sameZoneHa || config.database.zoneRedundantHa || config.database.authentication !== "entra-only") fail("disposable PostgreSQL must remain Entra-only without HA/geo backup");
  if (!uuid.test(config.database.entraAdmin?.objectId || "") || config.database.entraAdmin?.principalType !== "Group") fail("reviewed PostgreSQL Entra administrator group is required");
  const runtime = config.database.runtimePrincipal;
  if (runtime?.type !== "backend-system-assigned-managed-identity" || runtime.name !== config.resources.backend || runtime.databaseRole !== "meids_app_runtime" || runtime.superuser !== false || runtime.bypassRls !== false || runtime.canRunMigrations !== false) fail("backend database principal must be a distinct NOSUPERUSER NOBYPASSRLS runtime identity");

  const containers = config.storage?.containers || [];
  const requiredContainers = ["source", "working", "approved", "learning", "quarantine", "export"];
  if (containers.length !== requiredContainers.length || !requiredContainers.every((name) => containers.includes(name)) || config.storage.sharedKeyAccess !== false) fail("isolated Blob containers and RBAC-only access are required");
  if (config.storage.syntheticBlobKeyTemplate !== "kg010/{runId}/{principal}/fixture.txt") fail("Blob writes must use the exact run/principal-scoped key");
  if (config.search?.sku !== "basic" || config.search.localAuthDisabled !== true || !config.search.approvedIndex.includes("kg010") || !config.search.workingIndex.includes("kg010") || config.search.vectorDimensions !== 1536) fail("isolated Search configuration is invalid");
  if (config.graph?.storage !== "postgres-projection" || config.graph.apiPath !== "/api/okf/graph" || config.graph.syntheticMarkerPrefix !== "pandora-kg010-") fail("graph boundary changed");

  if (!config.backend?.databaseSchemaManaged || !config.backend.databaseAuthorizationEnabled || !config.backend.knowledgeAuthorizationEnforced || !config.backend.outboxProjectorEnabled || config.backend.searchAuthMode !== "managed_identity") fail("backend isolation controls are incomplete");
  if (config.backend.bootstrapDenyOrigin !== "https://kg010.invalid") fail("backend must deny browser origins until the new frontend hostname is known");
  const controlPlane = config.sharedControlPlane;
  if (controlPlane?.mode !== "disabled" || controlPlane.n8nOrigin !== "" || controlPlane.actorTwinWebhookPath !== "" || controlPlane.knowledgeFabricWebhookPath !== "" || controlPlane.agenticButlerWebhookPath !== "" || controlPlane.reuseRequires !== "isolated-workflow-clones-with-reviewed-kg010-resource-bindings") fail("n8n must remain disabled until isolated workflow clones are reviewed");

  const principals = config.identity?.principals || [];
  if (config.identity.mode !== "two-independent-delegated-users" || principals.length !== 2 || config.identity.committedObjectIds !== false || config.identity.mutateEntraMembership !== false) fail("two runtime-bound delegated identities are required");
  const app = config.identity.application;
  if (app?.registration !== "dedicated-kg010" || app.displayName !== "Me.IDs KG010 Nonproduction" || app.audience !== "api://meids-kg010" || app.tenantIdSource !== "azure.tenantId" || app.assignmentRequired !== true || app.clientIdSource !== "operator-runtime-binding" || app.clientSecretSource !== "dedicated-key-vault-runtime-binding") fail("a dedicated KG010 app registration and audience are required");
  const easyAuth = app.backendEasyAuth;
  if (easyAuth?.enabled !== true || easyAuth.requireAuthentication !== true || easyAuth.unauthenticatedClientAction !== "Return401" || easyAuth.allowedAudience !== app.audience || easyAuth.clientIdSettingName !== "KG010_ENTRA_CLIENT_ID" || easyAuth.clientSecretSettingName !== "KG010_ENTRA_CLIENT_SECRET") fail("backend Easy Auth must reject unauthenticated or wrong-audience requests");
  for (const [index, principal] of principals.entries()) {
    if (principal.label !== `principal_${index === 0 ? "a" : "b"}` || !secretName.test(principal.credentialSecretName || "") || principal.expectedTwinIdTemplate !== `{runMarker}-${principal.label}`) fail(`principal ${index + 1} binding is invalid`);
  }
  assertDistinct(principals.map((item) => item.credentialSecretName), "principal credential names");
  if (config.cleanup?.mode !== "exact-run-inventory" || config.cleanup.wildcardsAllowed || config.cleanup.deleteEntraUsersOrGroups || !config.cleanup.deleteRunCreatedTwinAssignments || !config.cleanup.requireOutboxDrained || !config.cleanup.destroyResourceGroupAfterEvidenceExport || config.cleanup.resourceGroupMustEqual !== config.azure.resourceGroup) fail("cleanup boundary is unsafe");
  if (config.costControl?.estimateStatus !== "operator-required" || config.costControl.approvedBudget !== null) fail("cost estimate and budget approval must remain operator inputs");
  return structuredClone(config);
}

export async function loadKg010DeploymentConfig(path = new URL("environment.plan.json", here)) {
  return validateKg010DeploymentConfig(JSON.parse(await readFile(path, "utf8")));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = await loadKg010DeploymentConfig(process.argv[2]);
  process.stdout.write(`${JSON.stringify({ valid: true, resourceGroup: config.azure.resourceGroup, sourceCommit: config.source.commit })}\n`);
}
