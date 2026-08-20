# DatosBizi MCP integration checklist

This repository provides both transports:

- Remote MCP: `https://mcp.datosbizi.com/mcp`
- Local stdio MCP: `npx bizidashboard-mcp`

## Auth0 values

Use the existing DatosBizi Auth0 tenant. The MCP must be configured with the
exact issuer tenant and the exact `aud` value emitted by the DatosBizi web
login. Do not guess or broaden the audience.

Production variables:

```text
AUTH0_DOMAIN=<DatosBizi Auth0 tenant>
AUTH0_AUDIENCE=https://api.datosbizi.com
AUTH0_AUDIENCES=<exact token audience>
AUTH0_ACCESS_TOKEN_ALLOWED_CLIENT_IDS=<comma-separated azp values used by approved clients>
BASE_URL=https://mcp.datosbizi.com
# Required for ChatGPT Actions; this hostname must route to this same MCP service.
OAUTH_PROXY_ORIGIN=https://auth.datosbizi.com
PORT=80
BIZI_ALLOWED_API_HOSTS=datosbizi.com
```

The remote server validates the JWT signature against Auth0 JWKS, issuer,
audience, expiry, allowed client (`azp`, when configured), and `read:dashboard`
scope. The validated original token is forwarded only to the allowlisted DatosBizi API
host. `read:exports` is additionally required for remote CSV exports of alert history
and rebalancing reports, alert-history requests above 500 rows, and rebalancing windows
above 30 days.

`AUTH0_AUDIENCE` is required when advertising an Authorization Code flow. It is
appended to the authorization endpoint so Auth0 returns an RS256 JWT for the
DatosBizi API rather than an opaque tenant token. `AUTH0_CLIENT_IDS` remains a
backwards-compatible alias for `AUTH0_ACCESS_TOKEN_ALLOWED_CLIENT_IDS`.

`BIZI_PUBLIC_API_KEY` is a local stdio backward-compatibility option only. Incoming
HTTP requests to `/mcp` and `/actions/*` never send it upstream, even if it is present
in the deployment environment. Those requests act solely as the bearer-token user.

## Remote clients

The web page at `datosbizi.com/developers` should link users to the official
custom-connector flow for each AI client and show the remote URL above. The
web page must not receive or store the AI client's OAuth tokens. The AI client
performs OAuth with Auth0 and sends its bearer token to the MCP.

### ChatGPT

Use a dedicated Regular Web Application for ChatGPT, not the web-login
application. Configure the API Resource Server for RS256 and authorize
`read:dashboard` for that application. Add exactly the callback URL displayed
by ChatGPT to **Allowed Callback URLs**:

```text
<ChatGPT OAuth callback URL>
```

Configure ChatGPT OAuth with that application's Client ID and Client Secret:

```text
Authorization URL: https://<auth0-domain>/authorize?audience=https%3A%2F%2F<api-identifier>
Token URL: https://<auth0-domain>/oauth/token
Scope: openid profile email read:dashboard
```

Keep all tools available in the remote client. If a user requests an elevated variant
without `read:exports`, the MCP returns a clear 403/error explaining that they must
reconnect and grant `read:exports`; it does not silently substitute a shared API key.

## Local clients

Enable Auth0 Device Authorization for the dedicated public CLI client, then:

```bash
AUTH0_DOMAIN=<tenant> \
AUTH0_CLIENT_ID=<public CLI client id> \
AUTH0_AUDIENCE=<exact audience> \
npx bizidashboard-mcp-login

npx bizidashboard-mcp
```

Tokens are stored with `0600` permissions under
`~/.config/bizidashboard-mcp/tokens.json` (override with `BIZI_TOKEN_FILE`).
No client secret belongs in the CLI or in the web application.

## Deployment verification

After redeploying, verify:

```bash
curl -fsS https://mcp.datosbizi.com/healthz
curl -fsS https://mcp.datosbizi.com/.well-known/oauth-protected-resource
curl -fsS https://mcp.datosbizi.com/openapi.json
```

Then use an actual DatosBizi access token to run `initialize`, `tools/list`, and
one `tools/call`. Verify a `read:dashboard` token succeeds for a basic tool and gets a
clear authorization error for an elevated request, then verify `read:exports` succeeds
for that request. Never paste the complete token into logs or issue trackers.
