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
| `BIZI_PUBLIC_API_KEY` | _(none)_ | `X-Public-Api-Key` sent on every request. Only required for elevated calls (CSV exports on `get_alerts_history`/`get_rebalancing_report`, or wide `days`/`limit` windows on those two tools). Everything else works anonymously. |

### HTTP Server & OAuth (inbound, remote clients only)

**The HTTP server requires OAuth-based authentication via Auth0.** Before running it, you must:

1. Register an application in your Auth0 tenant:
   - Go to **Applications** → **Create Application** → **Regular Web Application** (or **Single Page Application**).
   - Note its **Client ID** (public, stored as `AUTH0_CLIENT_ID`).
   - Set up an **API** in Auth0 with an identifier (e.g., `https://mcp.yourdomain.com`); this becomes `AUTH0_AUDIENCE`.

2. Configure these environment variables:

| Variable | Purpose |
| --- | --- |
| `AUTH0_DOMAIN` | **Required.** Your Auth0 tenant domain, e.g., `example.auth0.com`. |
| `AUTH0_AUDIENCE` | **Required.** The Auth0 API identifier (resource server), e.g., `https://mcp.yourdomain.com`. |
| `AUTH0_CLIENT_ID` | **Required for OAuth client applications** (e.g., a frontend or CLI that initiates the flow). The public application ID from your Auth0 app. |
| `BASE_URL` | _(optional)_ The public URL of this server (e.g., `https://mcp.yourdomain.com`). Used to construct OAuth metadata URLs. Defaults to `http://localhost:8787`. |
| `PORT` | _(optional)_ HTTP port. Default `8787`. |

### Stdio Server (Claude Desktop, no auth needed)

All `BIZI_*` variables above are optional; if omitted, they default to the public BiziDashboard.
The stdio server (`bizidashboard-mcp`) needs no authentication.

## Tools

| Tool | Description |
| --- | --- |
| `get_stations` | Latest availability snapshot for every station. |
| `get_rankings` | Rank stations by turnover or availability. |
| `get_alerts` | Currently active low-bikes/low-anchors alerts. |
| `get_alerts_history` | Filterable/paginated alert history. `format=csv` or `limit>500` needs `BIZI_PUBLIC_API_KEY`. |
| `get_patterns` | Weekday/weekend hourly occupancy pattern for one station. |
| `get_heatmap` | Occupancy heatmap cells for one station. |
| `get_mobility` | Hourly/daily mobility signals and transit impact. |
| `get_history` | Full historical daily demand data since first record. |
| `get_rebalancing_report` | Station diagnostics (A–F classification), risk predictions, and transfer recommendations. `format=csv` or `days>30` needs `BIZI_PUBLIC_API_KEY`. |

Every tool returns the API's JSON response as-is (or CSV text when `format: "csv"` is
requested); nothing is summarized or transformed. Errors from the underlying API
(bad params, rate limits, missing key) surface as MCP tool errors with the original
status and message.

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

### Run it on your own server

**With Docker** (image published to GHCR on every push to `main`/tag by
[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)):

```bash
docker run -d \
  --name bizidashboard-mcp \
  -p 8787:8787 \
  -e AUTH0_DOMAIN=<your-auth0-domain> \
  -e AUTH0_AUDIENCE=<your-api-identifier> \
  -e AUTH0_CLIENT_ID=<your-app-client-id> \
  -e BASE_URL=https://mcp.yourdomain.com \
  ghcr.io/gcaguilar/bizidashboard-mcp:latest
```

**From source:**

```bash
npm install
npm run build
AUTH0_DOMAIN=<your-auth0-domain> \
  AUTH0_AUDIENCE=<your-api-identifier> \
  AUTH0_CLIENT_ID=<your-app-client-id> \
  npm run start:http
```

Either way, put it behind a reverse proxy (Caddy, nginx, Traefik, …) on your
VPS to terminate TLS on a real domain — `https://mcp.yourdomain.com` — since
none of the three clients below will call a plain-HTTP or self-signed endpoint.

### Register it

- **Claude (claude.ai → Settings → Connectors → Add custom connector)**: URL
  `https://mcp.yourdomain.com/mcp`. Authentication is OAuth 2.0 Authorization Code;
  Claude will discover the flow automatically via `/.well-known/oauth-protected-resource`.
- **ChatGPT (GPT builder → Configure → Actions → Import from URL)**: import
  `https://mcp.yourdomain.com/openapi.json`, then set authentication to "OAuth 2.0"
  with the authorization URL `https://your-auth0-domain/authorize` and token URL
  `https://your-auth0-domain/oauth/token`.
- **Gemini (Gem/Extension → Actions → Import OpenAPI schema)**: same
  `https://mcp.yourdomain.com/openapi.json`, OAuth 2.0 authentication with your
  Auth0 endpoints.

## Development

```bash
npm run build       # compile TypeScript to dist/ (both the stdio and HTTP entrypoints)
npm run typecheck   # type-check without emitting
npm test            # build, then run integration tests against the live public API
  npm run start:http  # run the HTTP connector/Actions server locally (needs AUTH0_DOMAIN and AUTH0_AUDIENCE)
```

To build the Docker image locally: `docker build -t bizidashboard-mcp .`

Tests hit `https://datosbizi.com` for real — there are no mocks. A couple of tests are
skipped automatically if `BIZI_PUBLIC_API_KEY` is not set, since they'd otherwise
require a real elevated-access key to assert success.
