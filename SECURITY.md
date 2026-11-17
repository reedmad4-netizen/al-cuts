# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.5.x   | ✅ (current) |
| 1.4.x and earlier | ❌ — contains a forgeable session secret, missing stream authorization and known-vulnerable framework versions |

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report privately via
GitHub's [Security Advisories](https://github.com/reedmad4-netizen/al-cuts/security/advisories/new)
and include:

- affected version / commit,
- reproduction steps (a `curl` sequence is perfect),
- impact and any suggested fix.

You can expect an acknowledgement within a few days. Please give a reasonable
window for a fix before public disclosure.

## Deployment checklist

This app is a prototype that is safe to run **locally** out of the box, but it
needs the following before it faces the internet:

- [ ] Set `CLIPX_AUTH_SECRET` to ≥32 random characters (`openssl rand -base64 48`).
      Without it a per-install key is generated in `data/auth-secret`, which is
      fine for one process but not for multiple instances or ephemeral disks.
- [ ] Serve over HTTPS (directly or behind a proxy that sets `X-Forwarded-Proto`)
      so session cookies get the `Secure` flag.
- [ ] Set `CLIPX_DISABLE_DEMO_ACCOUNT=true` — the demo account is shared.
- [ ] Treat `data/clipx.db` as a secret: platform API tokens entered in Settings
      are stored there unencrypted.
- [ ] Keep FFmpeg/FFprobe current and treat uploaded media as untrusted input.
      Uploads are size-capped, extension-checked and probed with FFprobe, but
      they are still parsed by native code.
- [ ] Put a reverse proxy in front of the app for TLS, request-size limits and
      connection limits. Rate limiting is in-process and per-IP.
- [ ] Run `npm run smoke` after every deploy; it asserts the authorization and
      session-forgery regressions stay fixed.

## Security measures in 1.5.0

- No default/hardcoded JWT secret; tokens are HS256 with an env-provided or
  locally generated key (≥32 chars, `data/auth-secret`, mode 0600).
- Every mutating API route requires authentication **and** ownership:
  streams (connect / configure / stop / delete / capture), uploads, settings,
  clip editing, export and audio scans.
- In-process rate limits on login, registration, demo login, uploads, stream
  connection, captures and the discovery proxy.
- Path-traversal guard on `/api/media/[...path]`; media paths are never exposed
  to clients (`stripInternalClipPaths`).
- Security headers: `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, HSTS in production; no wildcard CORS grant.
- Parameterised SQL exclusively; FFmpeg invoked with argument arrays (no shell).

## Known limitations (tracked in ANALYSIS.md)

- The WebSocket feed (`/api/ws`) broadcasts buffer/chat events to all connected
  clients without per-user filtering.
- The audio "copyright" check is a signal-level heuristic, not a fingerprint
  match, and now says so in its output.
- `sql.js` rewrites the whole database file on each write and keeps all state in
  one process (no horizontal scaling, no durable in-flight buffers).
- The demo account password is public by design.
