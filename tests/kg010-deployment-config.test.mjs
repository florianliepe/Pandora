import test from "node:test";
import assert from "node:assert/strict";
import { loadKg010DeploymentConfig, validateKg010DeploymentConfig } from "../deploy/kg010/validate-config.mjs";
import { renderKg010Parameters } from "../deploy/kg010/render-parameters.mjs";

test("KG010 deployment plan is isolated, synthetic-only and source-pinned", async () => {
  const config = await loadKg010DeploymentConfig();
  assert.equal(config.azure.resourceGroup, "rg-meids-kg010-np");
  assert.equal(config.resources.database, "meids_kg010");
  assert.equal(config.identity.principals.length, 2);
  assert.equal(config.cleanup.wildcardsAllowed, false);
  assert.equal(config.database.runtimePrincipal.bypassRls, false);
  assert.equal(config.identity.application.audience, "api://meids-kg010");
  assert.equal(config.sharedControlPlane.mode, "disabled");
  assert.equal(config.costControl.approvedBudget, null);
  assert.equal(config.storage.syntheticBlobKeyTemplate, "kg010/{runId}/{principal}/fixture.txt");
  assert.equal(config.graph.syntheticMarkerPrefix, "pandora-kg010-");
});

test("KG010 deployment plan rejects production reuse and unsafe cleanup", async () => {
  const config = await loadKg010DeploymentConfig();
  assert.throws(() => validateKg010DeploymentConfig({ ...config, resources: { ...config.resources, postgresServer: "psql-meids-prod-1853a19b" } }), /production\/UAT resource|must not contain prod/);
  assert.throws(() => validateKg010DeploymentConfig({ ...config, cleanup: { ...config.cleanup, wildcardsAllowed: true } }), /cleanup boundary/);
  assert.throws(() => validateKg010DeploymentConfig({ ...config, database: { ...config.database, runtimePrincipal: { ...config.database.runtimePrincipal, bypassRls: true } } }), /NOSUPERUSER NOBYPASSRLS/);
  assert.throws(() => validateKg010DeploymentConfig({ ...config, sharedControlPlane: { ...config.sharedControlPlane, n8nOrigin: "https://eraneos-agentic-platform.azurewebsites.net" } }), /n8n must remain disabled/);
  assert.throws(() => validateKg010DeploymentConfig({ ...config, identity: { ...config.identity, principals: [config.identity.principals[0], config.identity.principals[0]] } }), /principal 2 binding|must be distinct/);
});

test("KG010 renders complete secret-free parameters for the existing Me.IDs Bicep templates", async () => {
  const { foundation, dataPlane, backendSettings, backendAuthPolicy } = await renderKg010Parameters();
  assert.equal(foundation.parameters.backendName.value, "meids-kg010-backend-1853a19b");
  assert.equal(foundation.parameters.allowedFrontendOrigins.value, "https://kg010.invalid");
  assert.equal(foundation.parameters.privateDataPlaneEnabled.value, true);
  assert.equal(dataPlane.parameters.databaseName.value, "meids_kg010");
  assert.equal(dataPlane.parameters.postgresSkuName.value, "Standard_B1ms");
  assert.equal(dataPlane.parameters.enableZoneRedundantHa.value, false);
  assert.equal(backendSettings.DATABASE_NAME, "meids_kg010");
  assert.equal(backendSettings.POSTGRES_AUTH_MODE, "managed_identity");
  assert.equal(backendSettings.AZURE_SEARCH_STARTUP_PROBE, "true");
  assert.equal(foundation.parameters.actorTwinWebhookUrl.value, "");
  assert.equal(foundation.parameters.knowledgeFabricWebhookUrl.value, "");
  assert.equal(backendAuthPolicy.properties.globalValidation.unauthenticatedClientAction, "Return401");
  assert.deepEqual(backendAuthPolicy.properties.identityProviders.azureActiveDirectory.validation.allowedAudiences, ["api://meids-kg010"]);
  const serialized = JSON.stringify({ foundation, dataPlane, backendSettings, backendAuthPolicy });
  assert.doesNotMatch(serialized, /password|accessToken|secretValue|apiKey/i);
  assert.doesNotMatch(serialized, /psql-meids-prod|stmeidsprod|srch-meids-prod|meids_prod/);
});
