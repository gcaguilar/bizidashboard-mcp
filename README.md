# bizidashboard-mcp

MCP server exposing [BiziDashboard](https://datosbizi.com)'s historical and analytical
data for the Zaragoza Bizi bike-share system as tools for LLM clients.

Unlike the official GBFS feed (which only exposes the current state of the system),
BiziDashboard stores and analyzes history: rankings, occupancy patterns, mobility
signals, alert history, and a station rebalancing diagnostic report. This server makes
that analytical layer easy to query from Claude Desktop or any other MCP client.

## Installation

Published on npm — no cloning or compiling required. Add it to your MCP client config
(e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bizidashboard": {
      "command": "npx",
      "args": ["-y", "bizidashboard-mcp"]
    }
  }
}
```

### From source

```bash
git clone https://github.com/gcaguilar/bizidashboard-mcp.git
cd bizidashboard-mcp
npm install
npm run build
```

Then point your MCP client at the built entrypoint:

```json
{
  "mcpServers": {
    "bizidashboard": {
      "command": "node",
      "args": ["/absolute/path/to/bizidashboard-mcp/dist/index.js"]
    }
  }
}
```

## Configuration

### BiziDashboard API (outbound)

| Variable | Default | Purpose |
| --- | --- | --- |
| `BIZI_API_BASE_URL` | `https://datosbizi.com` | Base URL of the BiziDashboard instance to query. Override to point at another city's deployment or a local dev server. |
| `BIZI_PUBLIC_API_KEY` | _(none)_ | **Local stdio only.** Optional legacy `X-Public-Api-Key` for elevated local calls. It is never sent by the remote HTTP MCP/Actions server. |
| `BIZI_ACCESS_TOKEN` | _(none)_ | Optional local stdio Auth0 access token forwarded to DatosBizi. `BIZI_INSTALLATION_ID` is forwarded when set. |

### HTTP Server & OAuth (inbound, remote clients only)

**The HTTP server requires OAuth-based authentication via Auth0.** Before running it, you must:

1. Create an Auth0 API for the MCP resource, with exact identifier
   `https://mcp.datosbizi.com/mcp`, RS256, and scopes `read:dashboard` and
   `read:exports`. Enable Dynamic Client Registration and Resource Parameter
   Compatibility Profile in the tenant. Claude and ChatGPT then register their
   own public clients; users do not receive an OAuth secret.

2. Create Auth0's **resource-server OBO client** for that MCP API. This is not
   the ordinary Machine-to-Machine application screen: it is created through
   the Auth0 Management API/CLI with `app_type: resource_server` and the
   `on_behalf_of_token_exchange` profile. Keep its client secret only in the
   MCP deployment.

2. Configure these environment variables:

| Variable | Purpose |
| --- | --- |
| `AUTH0_DOMAIN` | **Required.** Your Auth0 tenant domain, e.g., `example.auth0.com`. |
| `MCP_AUTH0_AUDIENCE` | **Required in production.** Exact MCP Auth0 API identifier: `https://mcp.datosbizi.com/mcp`. It is the audience verified for tokens received from connectors. |
| `MCP_AUTH0_AUDIENCES` | Optional comma-separated accepted MCP audiences. Normally use the same single value as `MCP_AUTH0_AUDIENCE`. |
| `API_AUTH0_AUDIENCE` | **Required in production.** Existing DatosBizi API identifier, e.g. `https://api.datosbizi.com`. OBO tokens are issued for this audience before the MCP calls the API. |
| `MCP_AUTH0_CLIENT_ID` | **Required in production.** Client ID of the special Auth0 resource-server OBO client. |
| `MCP_AUTH0_CLIENT_SECRET` | **Required in production.** Secret of that OBO client. Store only as a Coolify secret. |
| `AUTH0_AUDIENCE` | Legacy/local stdio audience. It remains the fallback for older single-audience deployments, not the recommended remote MCP setting. |
| `AUTH0_AUDIENCES` | Backwards-compatible accepted-audience configuration. |
| `MCP_CORS_ORIGINS` | Optional comma-separated browser origins allowed to call the HTTP MCP, e.g. `https://datosbizi.com`. |
| `AUTH0_CLIENT_ID` | **Required for OAuth client applications** (e.g., a frontend or CLI that initiates the flow). The public application ID from your Auth0 app. |
| `AUTH0_ACCESS_TOKEN_ALLOWED_CLIENT_IDS` | _(optional)_ Static `azp` allowlist. **Leave unset for public DCR connectors**, otherwise newly registered Claude/ChatGPT clients are rejected. |
| `AUTH0_CLIENT_IDS` | Backwards-compatible alias for `AUTH0_ACCESS_TOKEN_ALLOWED_CLIENT_IDS`. |
| `BASE_URL` | _(optional)_ The public URL of this server (e.g., `https://mcp.yourdomain.com`). Used to construct OAuth metadata URLs. Defaults to `http://localhost:8787`. |
| `PORT` | _(optional)_ HTTP port. Default `8787`. |

In production, `BASE_URL` is required and must be the HTTPS MCP URL. Set
`BIZI_ALLOWED_API_HOSTS` to an explicit comma-separated allowlist (normally
`datosbizi.com`) so authenticated tokens are never forwarded to an unintended
origin.

For local authenticated use, enable Device Authorization for the DatosBizi Auth0
application and run `bizidashboard-mcp-login` with `AUTH0_DOMAIN`,
`AUTH0_CLIENT_ID` and `AUTH0_AUDIENCE`. It stores tokens in
`~/.config/bizidashboard-mcp/tokens.json`; the stdio server refreshes them when a
refresh token is available. Set `BIZI_TOKEN_FILE` to override that path.

### Stdio Server (Claude Desktop, no auth needed)

All `BIZI_*` variables above are optional; if omitted, they default to the public BiziDashboard.
The stdio server (`bizidashboard-mcp`) needs no authentication.

## Tools

| Tool | Description |
| --- | --- |
| `get_stations` | Latest availability snapshot for every station. |
| `get_rankings` | Rank stations by turnover or availability. |
| `get_alerts` | Currently active low-bikes/low-anchors alerts. |
| `get_alerts_history` | Filterable/paginated alert history. Remote `format=csv` or `limit>500` requires `read:exports`. |
| `get_patterns` | Weekday/weekend hourly occupancy pattern for one station. |
| `get_heatmap` | Occupancy heatmap cells for one station. |
| `get_mobility` | Hourly/daily mobility signals and transit impact. |
| `get_history` | Full historical daily demand data since first record. |
| `get_rebalancing_report` | Station diagnostics (A–F classification), risk predictions, and transfer recommendations. Remote `format=csv` or `days>30` requires `read:exports`. |

Every tool remains visible to every authenticated remote user. Every tool returns the
API's JSON response as-is (or CSV text when `format: "csv"` is requested); nothing is
summarized or transformed. An elevated request without `read:exports` returns an
actionable authorization error telling the user to reconnect with that scope. Other
upstream errors (bad params, rate limits) retain their original status and message.

## Remote connector & Custom Actions (Claude / ChatGPT / Gemini)

`npx bizidashboard-mcp` (stdio) only works for local clients like Claude
Desktop. To use this data from **claude.ai remote connectors**, **ChatGPT
Custom GPT Actions**, or **Gemini Gem/Extension Actions**, run the HTTP
server instead and expose it publicly over HTTPS. It serves the same 9
operations three ways:

| Endpoint | Protocol | Used by |
| --- | --- | --- |
| `POST /mcp` | MCP Streamable HTTP (stateless) | Claude remote connectors |
| `GET /actions/*` | Plain REST, one route per tool | ChatGPT Custom Actions, Gemini Actions |
| `GET /openapi.json` | OpenAPI 3.1 spec describing the routes above | GPT/Gem Action builders |

Every route except `/openapi.json` and `/healthz` requires an OAuth bearer token
(Authorization Code flow with Auth0), obtained after registering as described above.
The remote server validates issuer, MCP audience, signature, expiry, `azp` (when
configured), and `read:dashboard`. It then performs an Auth0 On-Behalf-Of exchange,
so BiziDashboard receives a token for `https://api.datosbizi.com`, preserving the
signed-in user and their scopes without accepting an MCP token at the downstream API.

### Run it on your own server

**With Docker** (image published to GHCR on every push to `main`/tag by
[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)):

```bash
docker run -d \
  --name bizidashboard-mcp \
  -p 8787:8787 \
  -e AUTH0_DOMAIN=<your-auth0-domain> \
  -e MCP_AUTH0_AUDIENCE=https://mcp.yourdomain.com/mcp \
  -e API_AUTH0_AUDIENCE=https://api.datosbizi.com \
  -e MCP_AUTH0_CLIENT_ID=<obo-client-id> \
  -e MCP_AUTH0_CLIENT_SECRET=<obo-client-secret> \
  -e AUTH0_AUDIENCE=https://api.datosbizi.com \
  -e BASE_URL=https://mcp.yourdomain.com \
  ghcr.io/gcaguilar/bizidashboard-mcp:latest
```

**From source:**

```bash
npm install
npm run build
AUTH0_DOMAIN=<your-auth0-domain> \
MCP_AUTH0_AUDIENCE=https://mcp.yourdomain.com/mcp \
API_AUTH0_AUDIENCE=https://api.datosbizi.com \
MCP_AUTH0_CLIENT_ID=<obo-client-id> \
MCP_AUTH0_CLIENT_SECRET=<obo-client-secret> \
AUTH0_AUDIENCE=https://api.datosbizi.com \
  npm run start:http
```

Either way, put it behind a reverse proxy (Caddy, nginx, Traefik, …) on your
VPS to terminate TLS on a real domain — `https://mcp.yourdomain.com` — since
none of the three clients below will call a plain-HTTP or self-signed endpoint.

### Register it

- **Claude (claude.ai → Settings → Connectors → Add custom connector)**: URL
  `https://mcp.yourdomain.com/mcp`. Authentication is OAuth 2.0 Authorization Code;
  Claude will discover the flow automatically via `/.well-known/oauth-protected-resource`.
- **ChatGPT MCP / GPT builder**: use the MCP URL and let the client complete
  OAuth through Dynamic Client Registration. Do not embed the OBO client secret
  in ChatGPT or in a public page.
- **Gemini (Gem/Extension → Actions → Import OpenAPI schema)**: same
  `https://mcp.yourdomain.com/openapi.json`, OAuth 2.0 authentication with your
  Auth0 endpoints.

## Development

```bash
npm run build       # compile TypeScript to dist/ (both the stdio and HTTP entrypoints)
npm run typecheck   # type-check without emitting
npm test            # build, then run integration tests against the live public API
  npm run start:http  # run the HTTP connector/Actions server locally (needs the Auth0 MCP/OBO variables above)
```

To build the Docker image locally: `docker build -t bizidashboard-mcp .`

The existing tool smoke tests hit `https://datosbizi.com` for real. Focused
authorization tests use no live credentials and verify that remote HTTP requests never
send `BIZI_PUBLIC_API_KEY`.
