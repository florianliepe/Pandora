# KG010 isolated nonproduction deployment package

This package prepares, but does not deploy, a disposable Azure environment for
Pandora issue `da380680-c1e3-414d-a4b9-0aa3fdf58912`. It exists to prove
user/twin isolation across the Me.IDs API, Azure AI Search, Blob Storage and the
PostgreSQL-backed graph projection. It must never target the current production
or shared UAT data plane.

## Reviewed boundary

The machine-readable plan is `environment.plan.json`. It pins Me.IDs source
commit `26ab2f8c26744267c98804f7e7d0e5ff4584fea1`, all migrations `001` through
`015`, and these dedicated resources in `rg-meids-kg010-np`:

| Boundary | Dedicated target |
| --- | --- |
| Backend | `meids-kg010-backend-1853a19b` with its own managed identity |
| PostgreSQL | `psql-meids-kg010-1853a19b` / `meids_kg010` |
| Blob | `stmeidskg0101853a19b` and six lifecycle containers |
| Search | `srch-meids-kg010-1853a19b`, working and approved KG010 indexes |
| Graph | `/api/okf/graph`, persisted/projected from the isolated PostgreSQL database |
| Network | `10.43.0.0/16`, distinct from production `10.42.0.0/16` |
| Secrets | Dedicated Key Vault name; this package creates no secret or secret value |

Graph is not a separate database in the current Me.IDs architecture. Graph nodes,
edges and access scope are derived from the PostgreSQL knowledge model; Search is
a rebuildable retrieval projection, not an authorization source.

## What can be reused

The following control-plane elements may be reused without sharing application data:

- the pinned Me.IDs source and migration files;
- the existing `Me.IDs Production PostgreSQL Administrators` Entra group as the
  database administrator (it grants administration but does not copy production data);
- the Azure subscription, tenant and West Europe region.

Do not reuse either production or UAT backend, PostgreSQL, Blob, Search, indexes,
twins, users, signing keys, or application data. The validator rejects their known
resource names. The two probe principals are bound at runtime through independent,
short-lived delegated tokens; no Entra object ID or credential value is committed.

Authentication uses a dedicated single-tenant `Me.IDs KG010 Nonproduction` app
registration and audience `api://meids-kg010`. Its client ID and secret are supplied
only as operator/runtime bindings after approval. The two delegated user tokens must
be issued separately for this audience. Reusing a production application registration,
token or audience is prohibited.

All n8n endpoints are empty and disabled in the generated foundation parameters.
The existing shared workflows are not safe to reuse merely because a run marker is
present: they may still contain production persistence bindings. Enable n8n only
after separate workflow clones have been reviewed and every backend, database,
Blob, Search and credential binding points to the KG010 environment.

## Cost and lifetime decision

The plan uses a dedicated B1 Linux App Service plan, Basic Search, Standard_LRS
Storage and a `Standard_B1ms` 32 GB PostgreSQL server without HA or geo backup.
It is intentionally less resilient than production because all content is synthetic
and the whole resource group is disposable. The resource group must be deleted no
later than 168 hours after creation.

No budget or price is approved in this package. Azure prices vary by agreement and
region. Generate an estimate in the Azure Pricing Calculator immediately before
deployment and obtain explicit operator approval. PostgreSQL, Basic Search, App
Service, private endpoints, logs, storage and data transfer must all be included.

## Review and preflight

Run locally before any Azure write:

```powershell
node deploy/kg010/validate-config.mjs
node deploy/kg010/render-parameters.mjs --write
npm test
```

Use a clean checkout of the pinned Me.IDs commit. Verify global names and inspect both
deployments with `what-if`; do not substitute a production name when availability fails:

```powershell
$SourceCheckout = 'C:\path\to\clean\meids-app'
git -C $SourceCheckout checkout 26ab2f8c26744267c98804f7e7d0e5ff4584fea1
git -C $SourceCheckout status --porcelain # must return nothing

az deployment group what-if `
  --subscription 25c9ce59-90a1-4e8a-a2d4-1853a19bce22 `
  --resource-group rg-meids-kg010-np `
  --template-file "$SourceCheckout\infra\azure\main.bicep" `
  --parameters '@deploy/kg010/foundation.parameters.json'

az deployment group what-if `
  --subscription 25c9ce59-90a1-4e8a-a2d4-1853a19bce22 `
  --resource-group rg-meids-kg010-np `
  --template-file "$SourceCheckout\infra\azure\production-data-plane.bicep" `
  --parameters '@deploy/kg010/data-plane.parameters.json'
```

The resource group must be created and tagged with an absolute `delete-after` UTC
timestamp before these `what-if` commands can run. Creating it and approving the two
what-if plans are explicit human gates; this package does neither.

## Deployment order after approval

1. Create `rg-meids-kg010-np` and replace `delete-after` with a UTC timestamp no more
   than seven days ahead.
2. Confirm all global names are available. Change only the suffix consistently in
   `environment.plan.json`, rerun the validator and regenerate parameters if needed.
3. Deploy the foundation template, then the private data-plane template. Keep the
   initial browser allow-origin at the inert `https://kg010.invalid` value. The
   foundation disables public Search and Storage access before backend code is
   deployed; private endpoints and VNet integration are completed in phase two.
4. Create the dedicated app registration and store its runtime client binding in the
   dedicated vault. Apply `backend-auth.policy.json` to the backend Auth Settings V2.
   Before any application/data seed, prove that no token, a wrong-audience token and
   a forged `x-ms-client-principal` header each receive HTTP 401.
5. Deploy the backend package from the pinned commit. Apply `backend.settings.json`.
6. Grant the new backend managed identity its generated PostgreSQL runtime role plus
   Search Index Data Contributor and Storage Blob Data Contributor on only the new
   resources. The database role must be `NOSUPERUSER NOBYPASSRLS` and cannot run
   migrations. No production role assignment is permitted.
7. Acquire an Entra token as the reviewed PostgreSQL administrator and run
   `scripts/run-postgres-migrations.cjs` against `meids_kg010`. Confirm migration
   records `001` through `015`; never set `DATABASE_URL` to production.
8. Create the two dedicated Search indexes with
   `scripts/setup-azure-search-indexes.cjs` using the generated KG010 names. Search
   indexes are data-plane objects and are therefore intentionally outside Bicep.
9. Create the dedicated signing-key secret in the new vault through the approved
   operator process. This repository stores only binding names, never a client ID,
   client secret, token or signing-key value.
10. Read the newly generated Static Web App hostname, replace the inert allow-origin,
   and deploy the pinned frontend only after backend startup, Search and database
   probes pass.
11. Bind two independently authenticated delegated users at runtime. Create only
    `{runMarker}-principal_a` and `{runMarker}-principal_b` twins in the isolated
    database. Do not change Entra group membership or copy existing twins.

## Synthetic fixture and cleanup contract

Every created row, Blob key, index document and graph node must carry one exact
`pandora-kg010-<UUID>` run marker. The probe records exact created IDs and keys in a
private run inventory. Cleanup deletes only those recorded objects and the two
run-created twin assignments, waits for the outbox to drain, exports digest-only
evidence, and finally deletes `rg-meids-kg010-np`.

Blob fixture keys use `kg010/{runId}/{principal_a|principal_b}/fixture.txt`, where
`runId` is the UUID portion of the marker. Database, graph node and edge IDs are
deterministic UUIDs; `pandora-kg010-{runId}` is metadata/content, not an ID prefix.

Wildcard cleanup, deletion of Entra users/groups, mutation of existing memberships,
or use of a real twin is prohibited. A failed cleanup leaves the environment blocked
and requires operator inspection before resource-group deletion. The teardown command
must compare its target to the literal `rg-meids-kg010-np`; it may never enumerate or
delete the shared UAT resource group.

## Human inputs still required

- approve the seven-day cost window and final Azure `what-if` output;
- confirm that the PostgreSQL administrator group remains appropriate for nonproduction;
- nominate two independent delegated identities and arrange short-lived credentials in
  the runner secret store using the committed secret names;
- approve creation and later deletion of the isolated resource group;
- approve isolated n8n workflow clones and their fixed KG010 resource bindings if
  agent interaction is added after the initial direct isolation probes.

Until all five inputs are recorded, KG010 remains `needs_input` and no acceptance
evidence may be produced.

## Pinned-template caveat

The pinned data-plane template currently gives its two private endpoint ARM objects
the display names `pe-meids-search-prod` and `pe-meids-blob-prod`. They are created
inside the dedicated `rg-meids-kg010-np` group and target only the dedicated Search
and Storage resource IDs, so they cannot attach to production. The names are still
misleading. Parameterize them in Me.IDs before promoting this disposable package to
a reusable long-lived test environment; do not interpret their `prod` suffix as a
permission to reuse production targets.

The two pinned Bicep templates compiled locally with Azure CLI Bicep `0.47.16`, and
all generated parameter names matched declared template parameters. Azure `what-if`
was not run because the isolated resource group has not been created; this package
does not claim deployment validation or resource-name availability.
