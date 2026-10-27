import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadKg010DeploymentConfig } from "./validate-config.mjs";

const here = new URL("./", import.meta.url);
const schema = "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#";
const roleNames = {
  search: "ffb2b5eb-a49f-406c-b420-027dc9855946",
  storage: "bf2b7024-9795-4855-b65a-bbde2c569fa5",
  vault: "5d3d732b-8029-48fa-b548-84030c212e26"
};

function document(parameters) {
  return { $schema: schema, contentVersion: "1.0.0.0", parameters: Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, { value }])) };
}

export function buildFoundationParameters(config) {
  const r = config.resources;
  return document({
    environment: "uat",
    location: config.azure.location,
    keyVaultLocation: config.azure.location,
    tags: config.azure.tags,
    appServicePlanName: r.appServicePlan,
    createAppServicePlan: true,
    backendName: r.backend,
    staticWebAppName: r.frontend,
    searchName: r.searchService,
    searchSku: config.search.sku,
    disableSearchLocalAuth: config.search.localAuthDisabled,
    privateDataPlaneEnabled: true,
    storageName: r.storageAccount,
    storageSku: config.storage.sku,
    keyVaultName: r.keyVault,
    logAnalyticsName: r.logAnalytics,
    appInsightsName: r.applicationInsights,
    approvedSearchIndex: config.search.approvedIndex,
    workingSearchIndex: config.search.workingIndex,
    azureOpenAiEmbeddingDimensions: config.search.vectorDimensions,
    allowedFrontendOrigins: config.backend.bootstrapDenyOrigin,
    actorTwinWebhookUrl: "",
    knowledgeFabricWebhookUrl: "",
    agenticButlerWebhookUrl: "",
    n8nApiBaseUrl: "",
    enableKeyVaultPurgeProtection: false,
    allowStorageSharedKeyAccess: config.storage.sharedKeyAccess,
    enableKnowledgeAuthorization: config.backend.knowledgeAuthorizationEnforced,
    knowledgeAuthorizationSigningSecretName: config.backend.signingSecretName,
    searchRoleAssignmentName: roleNames.search,
    storageRoleAssignmentName: roleNames.storage,
    vaultRoleAssignmentName: roleNames.vault,
    backendDiagnosticSettingName: "diag-meids-kg010-backend",
    searchDiagnosticSettingName: "diag-meids-kg010-search",
    storageDiagnosticSettingName: "diag-meids-kg010-blob",
    vaultDiagnosticSettingName: "diag-meids-kg010-vault"
  });
}

export function buildDataPlaneParameters(config) {
  const r = config.resources;
  return document({
    location: config.azure.location,
    backendName: r.backend,
    postgresServerName: r.postgresServer,
    entraAdminObjectId: config.database.entraAdmin.objectId,
    entraAdminPrincipalName: config.database.entraAdmin.displayName,
    entraAdminPrincipalType: config.database.entraAdmin.principalType,
    vnetName: r.vnet,
    vnetAddressPrefix: config.network.vnetAddressPrefix,
    appSubnetAddressPrefix: config.network.appSubnetAddressPrefix,
    databaseSubnetAddressPrefix: config.network.databaseSubnetAddressPrefix,
    privateEndpointSubnetAddressPrefix: config.network.privateEndpointSubnetAddressPrefix,
    privateDnsZoneName: r.privateDnsPostgres,
    searchServiceName: r.searchService,
    storageAccountName: r.storageAccount,
    databaseName: r.database,
    postgresSkuName: config.database.sku,
    postgresStorageSizeGb: config.database.storageSizeGb,
    backupRetentionDays: config.database.backupRetentionDays,
    enableGeoRedundantBackup: config.database.geoRedundantBackup,
    enableSameZoneHa: config.database.sameZoneHa,
    enableZoneRedundantHa: config.database.zoneRedundantHa,
    logAnalyticsName: r.logAnalytics,
    deployBackendAlerts: false,
    tags: config.azure.tags
  });
}

export function buildBackendSettings(config) {
  const r = config.resources;
  return {
    DATABASE_HOST: `${r.postgresServer}.postgres.database.azure.com`,
    DATABASE_PORT: "5432",
    DATABASE_NAME: r.database,
    DATABASE_USER: r.backend,
    DATABASE_SSL: "true",
    POSTGRES_AUTH_MODE: "managed_identity",
    MEIDS_STORAGE_MODE: config.backend.storageMode,
    MEIDS_DATABASE_SCHEMA_MANAGED: String(config.backend.databaseSchemaManaged),
    MEIDS_AUTHZ_DATABASE_ENABLED: String(config.backend.databaseAuthorizationEnabled),
    MEIDS_ENFORCE_KNOWLEDGE_AUTH: String(config.backend.knowledgeAuthorizationEnforced),
    MEIDS_STORAGE_ACCOUNT_NAME: r.storageAccount,
    MEIDS_OUTBOX_PROJECTOR_ENABLED: String(config.backend.outboxProjectorEnabled),
    MEIDS_OUTBOX_BATCH_SIZE: String(config.backend.outboxBatchSize),
    MEIDS_OUTBOX_INTERVAL_MS: String(config.backend.outboxIntervalMs),
    AZURE_SEARCH_AUTH_MODE: config.backend.searchAuthMode,
    AZURE_SEARCH_ENDPOINT: `https://${r.searchService}.search.windows.net`,
    AZURE_SEARCH_APPROVED_INDEX: config.search.approvedIndex,
    AZURE_SEARCH_WORKING_INDEX: config.search.workingIndex,
    AZURE_SEARCH_API_VERSION: config.search.apiVersion,
    AZURE_SEARCH_REQUEST_TIMEOUT_MS: "10000",
    AZURE_SEARCH_STARTUP_PROBE: "true"
  };
}

export function buildBackendAuthPolicy(config) {
  const app = config.identity.application;
  const auth = app.backendEasyAuth;
  return {
    properties: {
      platform: { enabled: auth.enabled, runtimeVersion: "~1" },
      globalValidation: {
        requireAuthentication: auth.requireAuthentication,
        unauthenticatedClientAction: auth.unauthenticatedClientAction,
        redirectToProvider: "azureactivedirectory"
      },
      identityProviders: {
        azureActiveDirectory: {
          enabled: true,
          registration: {
            openIdIssuer: `https://login.microsoftonline.com/${config.azure.tenantId}/v2.0`,
            clientIdSettingName: auth.clientIdSettingName,
            clientSecretSettingName: auth.clientSecretSettingName
          },
          validation: { allowedAudiences: [auth.allowedAudience] }
        }
      }
    }
  };
}

export async function renderKg010Parameters(configPath = new URL("environment.plan.json", here)) {
  const config = await loadKg010DeploymentConfig(configPath);
  return { foundation: buildFoundationParameters(config), dataPlane: buildDataPlaneParameters(config), backendSettings: buildBackendSettings(config), backendAuthPolicy: buildBackendAuthPolicy(config) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes("--write");
  const rendered = await renderKg010Parameters(process.argv.find((arg) => arg.endsWith(".json")));
  if (!write) {
    process.stdout.write(`${JSON.stringify(rendered, null, 2)}\n`);
  } else {
    await writeFile(new URL("foundation.parameters.json", here), `${JSON.stringify(rendered.foundation, null, 2)}\n`);
    await writeFile(new URL("data-plane.parameters.json", here), `${JSON.stringify(rendered.dataPlane, null, 2)}\n`);
    await writeFile(new URL("backend.settings.json", here), `${JSON.stringify(rendered.backendSettings, null, 2)}\n`);
    await writeFile(new URL("backend-auth.policy.json", here), `${JSON.stringify(rendered.backendAuthPolicy, null, 2)}\n`);
  }
}
