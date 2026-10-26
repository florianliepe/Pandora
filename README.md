# Pandora

[Open Pandora](https://florianliepe.github.io/Pandora/) and sign in using an
@eraneos.com email address. Outlook delivers an eight-digit, one-time code.

This branch publishes the frontend to GitHub Pages. The API runs in the existing
Eraneos n8n service, with project records and evidence in a separate private
GitHub repository. User sessions and login-code hashes stay in n8n, outside Git.

The complete application source, automated tests, n8n workflow definitions and
operational documentation are in [pull request #1](https://github.com/florianliepe/Pandora/pull/1),
which remains open for review. The published frontend was tested against the live
API before release. No dedicated Azure application resources are required.

The repository variable `PANDORA_API_URL` supplies the public n8n webhook URL at
build time; it contains no secret. Clearing that variable disables login on the
next deployment. Only `main` can deploy to the protected Pages environment.
