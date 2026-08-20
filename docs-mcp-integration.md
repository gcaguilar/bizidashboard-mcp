# DatosBizi MCP integration checklist

This repository provides both transports:

- Remote MCP: `https://mcp.datosbizi.com/mcp`
- Local stdio MCP: `npx bizidashboard-mcp`

## Auth0 values

Use the existing DatosBizi Auth0 tenant. This is a two-audience setup: connectors
receive a token for the MCP resource, then the MCP exchanges it On-Behalf-Of the
same user for a DatosBizi API token.

Production variables:

```text
AUTH0_DOMAIN=<DatosBizi Auth0 tenant>
# Token received from Claude/ChatGPT; exact Auth0 API identifier for the MCP.
MCP_AUTH0_AUDIENCE=https://mcp.datosbizi.com/mcp
# Token used only by the MCP after OBO exchange.
API_AUTH0_AUDIENCE=https://api.datosbizi.com
MCP_AUTH0_CLIENT_ID=<resource-server-obo-client-id>
MCP_AUTH0_CLIENT_SECRET=<resource-server-obo-client-secret>
BASE_URL=https://mcp.datosbizi.com
PORT=80
BIZI_ALLOWED_API_HOSTS=datosbizi.com
```

The remote server validates the JWT signature against Auth0 JWKS, issuer,
MCP audience, expiry, allowed client (`azp`, only if a static allowlist is deliberately
configured), and `read:dashboard` scope. It exchanges that token at Auth0 for a token
whose audience is the allowlisted DatosBizi API host. `read:exports` is additionally required for remote CSV exports of alert history
and rebalancing reports, alert-history requests above 500 rows, and rebalancing windows
above 30 days.

In Auth0, enable Resource Parameter Compatibility Profile, Include Issuer in
Authorization Responses, and Dynamic Client Registration. Create the MCP API with
identifier `https://mcp.datosbizi.com/mcp` (RS256 and the two scopes). The OBO client
is a resource-server client with `on_behalf_of_token_exchange`, not a normal M2M app.
For public connectors leave `AUTH0_ACCESS_TOKEN_ALLOWED_CLIENT_IDS` unset: DCR creates
a different client for each connector installation. Do not configure the old OAuth
proxy (`OAUTH_PROXY_ORIGIN`) or static audience lists on this deployment.

`BIZI_PUBLIC_API_KEY` is a local stdio backward-compatibility option only. Incoming
HTTP requests to `/mcp` and `/actions/*` never send it upstream, even if it is present
in the deployment environment. Those requests act solely as the signed-in bearer-token
user through an audience-specific OBO token.

## Remote clients

The web page at `datosbizi.com/developers` should link users to the official
custom-connector flow for each AI client and show the remote URL above. The
web page must not receive or store the AI client's OAuth tokens. The AI client
performs OAuth with Auth0 and sends its bearer token to the MCP.

### ChatGPT

For remote MCP, use `https://mcp.datosbizi.com/mcp` and leave any OAuth client
secret blank. Auth0 Dynamic Client Registration lets Claude/ChatGPT register a public
PKCE client and sends users to the normal DatosBizi login.

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
