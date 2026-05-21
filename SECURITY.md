# Security Policy

## Credential Management

This tool connects to cloud logging services (Alibaba Cloud SLS, Tencent Cloud CLS, Volcengine TLS) and optionally MongoDB. **All credentials must be stored in `.env`**, which is excluded from version control via `.gitignore`.

### Best Practices

- **Never commit** `.env` or `config/projects.json` to version control
- Use **read-only API keys** with minimum required permissions (e.g. `logs:GetLogs` only)
- For MongoDB, use a **dedicated read-only account** with IP whitelist — never use admin credentials
- Restrict CLS/SLS API keys to **specific log topics/projects** when your cloud provider supports it
- Consider using a secrets manager (Vault, AWS Secrets Manager, etc.) instead of `.env` files in production environments

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it by opening a GitHub Issue with the label `security`. Do not publicly disclose vulnerabilities before they have been addressed.

## What to Do If Credentials Are Leaked

1. **Immediately rotate** all exposed API keys, tokens, and passwords
2. Check cloud provider access logs for unauthorized usage during the exposure window
3. Review git history and use `git filter-branch` or [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) to remove sensitive data from history
4. Enable branch protection rules to prevent future `.env` commits
