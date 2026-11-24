# Security Policy

## Reporting a Vulnerability

Please report security issues privately by email to security@leadflow.local (replace with your contact) or via GitHub Security Advisories.

We will acknowledge receipt within 48 hours and provide a timeline for remediation. Do not open public issues for security reports.

## Supported Versions

We support the latest release and the `main` branch. Fixes may be backported case-by-case.

## Best Practices in This Repo

- Principle of least privilege in CI (scoped `permissions` and environments with approvals).
- Secrets are never committed. Production secrets are provisioned out-of-band on hosts.
- Docker images are built as non-root, with read-only root FS and dropped capabilities in Compose.
- MFA required for Admin access, JWT RS256, refresh rotation, CSRF enforced for mutations.
- Backups with XtraBackup + PITR (binlogs) and routine restore testing.
