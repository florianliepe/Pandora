import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { KG010, validateKg010Manifest, validateKg010ProbeResult } from "../runner/evidence/kg010-contract.mjs";

function manifest() {
  return {
    schemaVersion: 1,
    issueId: KG010.issueId,
    cases: Object.entries(KG010.cases).map(([code, item]) => ({ code, ...item })),
    environment: {
      classification: "nonproduction",
      backendOrigin: "https://meids-isolation-uat.azurewebsites.net/",
      resourceGroup: "rg-meids-isolation-uat",
      postgresServer: "psql-meids-isolation-uat",
      database: "meids_isolation_uat",
      blobAccount: "stmeidsisolationuat",
      blobContainer: "kg010",
      searchEndpoint: "https://srch-meids-isolation-uat.search.windows.net/",
      approvedIndex: "meids-approved-kg010",
      workingIndex: "meids-working-kg010",
      graphApiPath: "/api/okf/graph",
    },
    principals: ["a", "b"].map((suffix, index) => ({
      label: index ? "principal_b" : "principal_a",
      tenantId: "11111111-1111-4111-8111-111111111111",
      objectId: index ? "22222222-2222-4222-8222-222222222222" : "33333333-3333-4333-8333-333333333333",
      credentialSecretName: `PANDORA_KG010_PRINCIPAL_${suffix.toUpperCase()}_TOKEN`,
      expectedOrganizationId: "eraneos-uat",
      expectedUserId: `kg010-user-${suffix}`,
      expectedTwinId: `kg010-twin-${suffix}`,
    })),
    safety: {
      productionDataPresent: false,
      syntheticWritesOnly: true,
      cleanupRequired: true,
      readOnlyObservability: true,
      maxRuntimeMinutes: 30,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
  };
}

test("KG-010 manifest requires two independent principals and nonproduction safety controls", () => {
  const value = manifest();
  assert.equal(validateKg010Manifest(value).principals.length, 2);
  assert.throws(() => validateKg010Manifest({ ...value, environment: { ...value.environment, classification: "production" } }), /cannot run against a production/);
  assert.throws(() => validateKg010Manifest({ ...value, principals: [value.principals[0], { ...value.principals[1], objectId: value.principals[0].objectId }] }), /distinct objectId/);
  assert.throws(() => validateKg010Manifest({ ...value, safety: { ...value.safety, productionDataPresent: true } }), /safety controls/);
});

test("KG-010 result rejects same-subject auth, cross-scope visibility and incomplete cleanup", () => {
  const prerequisites = manifest();
  const now = Date.now();
  const matrix = prerequisites.principals.flatMap((principal) => KG010.surfaces.map((surface) => ({
    principal: principal.label,
    surface,
    ownMarkerVisible: true,
    foreignMarkerVisible: false,
    status: "passed",
    evidenceDigest: "a".repeat(64),
  })));
  const result = {
    schemaVersion: 1,
    issueId: KG010.issueId,
    runId: randomUUID(),
    runMarker: `pandora-kg010-${randomUUID()}`,
    startedAt: new Date(now - 1000).toISOString(),
    completedAt: new Date(now).toISOString(),
    authenticatedObjects: prerequisites.principals.map((item) => item.objectId),
    matrix,
    revocation: { principal: "principal_b", apiDenied: true, searchEmpty: true, blobDenied: true, graphEmpty: true, evidenceDigest: "b".repeat(64) },
    cleanup: { markersRemoved: true, outboxDrained: true, evidenceDigest: "c".repeat(64) },
  };
  result.runMarker=`pandora-kg010-${result.runId}`;
  assert.equal(validateKg010ProbeResult(result, prerequisites).matrix.length, 8);
  assert.throws(()=>validateKg010ProbeResult({...result,runMarker:`pandora-kg010-${randomUUID()}`},prerequisites),/marker does not match/);
  assert.throws(()=>validateKg010ProbeResult({...result,startedAt:new Date(now-601000).toISOString(),completedAt:new Date(now-600000).toISOString()},prerequisites),/must be current/);
  assert.throws(()=>validateKg010ProbeResult({...result,startedAt:new Date(now+120000).toISOString(),completedAt:new Date(now+121000).toISOString()},prerequisites),/must be current/);
  assert.throws(() => validateKg010ProbeResult({ ...result, authenticatedObjects: [prerequisites.principals[0].objectId, prerequisites.principals[0].objectId] }, prerequisites), /authenticated objects do not match/);
  assert.throws(() => validateKg010ProbeResult({ ...result, matrix: matrix.map((item, index) => index ? item : { ...item, foreignMarkerVisible: true }) }, prerequisites), /failed observation/);
  assert.throws(() => validateKg010ProbeResult({ ...result, cleanup: { ...result.cleanup, markersRemoved: false } }, prerequisites), /cleanup is incomplete/);
});
