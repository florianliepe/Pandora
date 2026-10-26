# Deployment handoff

No Azure resources have been provisioned. The user requested configuration first.

## Azure

1. Review `infra/main.bicep` in a **dedicated** resource group. It creates a B1
   Linux App Service plan, PostgreSQL Flexible Server B1ms, storage, private
   networking and Key Vault. Obtain regional pricing before deployment.
2. Compile with `az bicep build --file infra/main.bicep`. Compilation does not
   validate subscription quota, regional availability, or runtime connectivity.
3. Provide the PostgreSQL administrator password through a secure deployment
   parameter or approved secret store. Do not commit a parameter file containing it.
4. After approval, run Azure `what-if`, review the change set, then deploy. This
   must create separate Pandora resources, not repurpose Me.IDs production assets.
5. From a host on the VNet, create a database role `pandora_app`, grant CONNECT
   on the dedicated `pandora` database and USAGE/CREATE on its public schema.
   The application role must not be the PostgreSQL administrator. Its table
   initialization is idempotent. Restrict schema CREATE after initial migration.
6. Store a URL-encoded PostgreSQL connection string with `sslmode=verify-full`
   under `pandora-database-url` in the created Key Vault. Use the app role.
   If the organization uses a private CA, configure the trusted CA; never disable TLS validation.
7. Configure the mail and optional chat secrets below. Missing Key Vault secrets
   deliberately prevent a usable production startup. `DEV_MAILBOX` stays off.
8. Configure GitHub OIDC federation restricted to this repository's `production`
   environment. Grant the deployment identity access only to the Pandora app.
   Set repository variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID`, `AZURE_WEBAPP_NAME`. Configure required environment
   reviewers in GitHub; a workflow environment name alone does not enforce approval.
9. Trigger `Deploy backend (manual)`. The application uses managed identity for
   Blob access; no storage account keys or public screenshot URLs are needed.
10. Verify `/api/health`, real email login, isolation between two projects,
    screenshot upload/download, logout, persistence after restart, and restoration
    from backup. Runtime Azure verification has not been performed.

## n8n email delivery

`workflows/mail.json` is an inactive draft:

`Header-authenticated webhook → validate exact domain/code → send email → acknowledge`

Bind an approved SMTP credential and sender address (or replace the send node
with an approved Microsoft Outlook sender). No mail-sending node was found in
the accessible workflow inventory during discovery. An n8n workflow still needs
a real mail-provider credential; the AI gateway credential cannot send mail.

Configure Header Auth with name `Authorization` and value `Bearer <random secret>`.
Put the production webhook URL in Key Vault `pandora-mail-url` and the raw secret
in `pandora-mail-token`. Never configure this secret in the browser.
Execution payload saving is disabled for successful, failed and manual runs to
avoid retaining login codes. Publish only after credential binding and a test to
an explicitly selected recipient. No real email was sent during development.

## n8n assistant

`workflows/chat.json` uses Chat Trigger → AI Agent → Eraneos gateway, with a
**Call n8n Workflow Tool** connected to the scoped context sub-workflow.
The fixed tool input comes from the authenticated backend request, not from
model-selected project identifiers. The backend checks project access first.

Bind the gateway credential and an HTTP Basic Auth credential. Set Key Vault
`pandora-chat-url` to the production Chat Trigger URL and `pandora-chat-auth` to
`username:password`. Publish the context workflow, then the chat workflow and
enable its public webhook with Basic Auth. Only the backend holds the credential.
The public GitHub Pages bundle must never call this endpoint directly.

The initial agent is advisory only. It receives at most 100 scoped issue summaries
and cannot change records, run shell commands, merge PRs or deploy. Screenshot
analysis and writes require the phase-two job contracts. Validate model access
against the selected gateway credential before publication.

## GitHub Pages

Enable Pages with source `GitHub Actions`. Set `PANDORA_API_URL` to the deployed
HTTPS API origin, then run `Publish frontend`. The API's `PUBLIC_ORIGIN` is
`https://florianliepe.github.io` (origins contain no repository path).

Before the API is configured, Pages publishes a clearly labelled preview with
login disabled. It contains no project records or credentials. GitHub Pages
serves the frontend shell publicly; email login protects application data through
the API. If the HTML itself must be restricted, use an authenticated hosting layer.

## Before organization-wide use

- Validate PostgreSQL and Blob restore procedures and establish retention/purge policy.
- Add production monitoring, distributed abuse controls and mail delivery alerts.
- Load-test expected issue, event and attachment volume; normalize the aggregate
  schema before its size or write-lock contention becomes significant.
- Run Azure connectivity, managed-identity and email smoke tests in the deployed environment.
- Record approved sender ownership and operational support responsibilities.
