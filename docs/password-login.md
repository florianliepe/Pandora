# Password login on GitHub Pages and n8n

Pandora uses the existing n8n service for email/password authentication. No new Azure resource or paid identity provider is required. GitHub Pages hosts the public frontend; project membership remains in the private data repository. Passwords and password hashes are never committed to Git.

## Account and project access

- Eraneos addresses can self-register after verifying their mailbox.
- An owner can invite an external address in Project settings and choose owner, developer, tester or viewer. Invitation emails point to Pandora. Initial external account activation requires a current invitation, current membership and an active project; the invitation expires after seven days. Re-invite to renew it.
- Registration alone grants no access to existing projects. Every request checks the current project membership. Removing membership immediately removes that project's access, including for existing sessions.
- Admitted users may create projects and become their owners. Removing one membership does not disable the account or remove other project memberships.
- Existing users select **Set password / register** once. Their user ID and project memberships are preserved. Subsequent sign-ins use email and password without an email code.
- **Forgot password?** sends a one-time mailbox verification code; it does not email a password. Resetting a password revokes all previous sessions.

## Authentication storage and limits

The existing private n8n authentication Data Table stores `passwordCredentials`, `passwordChallenges`, `passwordAttempts` and `accountInvitations` alongside hashed sessions. Credentials use a unique 32-byte random salt and scrypt (N=131072, r=8, p=1, 32-byte output). Passwords must contain 15–128 characters. Only password hashes are stored, never reversible passwords. The n8n adapter supplies a concrete SHA-256 HMAC instance for noble's clone operation because this n8n sandbox hides dynamically discovered prototypes; it does not alter the KDF. Tests compare the result to native Node scrypt.

Verification codes expire after ten minutes, allow five attempts and are single-use. Setup/reset requests have a generic eligibility response. Limits are three mail requests and ten password sign-in attempts per normalized email per fifteen minutes, with a shared ceiling of 120 attempts. Sessions expire after eight hours and are stored in browser session storage. Existing email-code endpoints remain for migration of internal accounts that have not set a password; they cannot authenticate accounts with a configured password.

API and mail workflows disable successful, failed, manual and in-progress execution retention. Administrators must keep that setting, restrict Data Table/workflow access and protect n8n storage/backups. A private Git repository is not a password vault: immutable history would retain old credentials. The serialized Data Table lease and memory-intensive KDF suit this small-team deployment; expanding usage requires load testing and capacity review.

## Deployment and verification

1. Run unit/integration tests, frontend checks/build and the browser suite.
2. Build the n8n bundle and generate the API and internal-store workflow definitions. Verify the KDF inside a temporary isolated n8n workflow with synthetic in-memory data, then remove it.
3. Back up the current API and mail workflow definitions privately. Update the existing mail workflow first, then the existing API. Preserve credential and Data Table IDs. Do not replace or clear the authentication table.
4. Publish the frontend after backend verification. Existing sessions and project records remain valid.
5. Verify live request routing, mail acceptance, unauthorized-access rejection and frontend controls. Users set their own passwords; operators must not ask them to share passwords or set passwords on their behalf.

Regression coverage includes identity preservation, reset/session revocation, single-use and expired codes, expired/revoked guest invitations, project isolation, guest project creation, attempt limits, mail recipient validation and exclusion of all private authentication fields from Git snapshots.
