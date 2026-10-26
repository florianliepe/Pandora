# Research and design decisions

Research performed 26 October 2026. The supplied diagram informed the workflow;
content in documents and chats was treated as evidence, not new instructions.

## Existing setup

The accessible “Build OET AI Suite landing page” chat and local assets establish
an Eraneos visual language: warm neutral surfaces, dark typography, restrained
orange accents and generous spacing. Pandora reuses that direction and the
existing Eraneos SVG asset. The “Build AI strategy roadmap MVP” chat reinforced
traceable evidence, explicit ownership, role separation and backend-protected data.
Azure discovery confirmed existing App Service, PostgreSQL and storage usage.
Pandora's deployment template creates independent resources.

Both user-supplied shared-chat URLs returned no readable text through web access;
their contents have not been claimed as reviewed.

## Test management

[ISTQB defect-report guidance](https://tbok.istqb.org/search?q=defect+report)
supports recording reproducible steps, environment, expected versus actual
outcomes, reporter, dates and evidence. Pandora stores those separately from
mitigation notes, implementation status and test status. Versioned case snapshots
allow later reviewers to see what a test actually checked at execution time.

## Delivery metrics

[DORA's current definitions](https://dora.dev/guides/dora-metrics/) distinguish
deployment frequency, change lead time, failed deployment recovery time, change
fail rate and deployment rework rate. Those need production events. They remain
unavailable in phase one; issue counts are not substituted for deployment data.
Flow measures use recorded transitions and iteration burndown uses historical
scope and estimates. An empty chart indicates missing evidence, not zero risk.

## Hosting and workflow orchestration

[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
is static hosting. The API owns authorization, credentials, data and evidence.
[n8n Chat Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.chattrigger)
supports embedded chat with authentication, while
[Call n8n Workflow Tool](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolworkflow)
lets the agent invoke a scoped sub-workflow. Pandora starts with read-only tools.
[Send Email](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.sendemail)
requires a mail-provider credential separate from model credentials.

[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) is a candidate for a
dedicated phase-two worker. It does not make this desktop chat a persistent
webhook endpoint. Jobs need an independently deployed runner, credentials,
isolated checkout, test tools and an approval boundary.

[Azure managed identity](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity)
provides a server-local token endpoint. The Blob adapter uses that endpoint with
an app-specific identity and container-scoped permissions. No credential values
were copied into repository files.
