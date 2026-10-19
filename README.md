# bizidashboard-mcp

Model Context Protocol server for [BiziDashboard](https://datosbizi.com)'s Zaragoza
bike-share analytics: stations, history, occupancy, alerts, mobility, and rebalancing.

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
| `BIZI_PUBLIC_API_KEY` | _(none)_ | **Local stdio only.** Optional legacy `X-Public-Api-Key` for elevated local calls. It is never sent by the remote HTTP MCP server. |
| `BIZI_ACCESS_TOKEN` | _(none)_ | Optional local stdio Auth0 access token forwarded to DatosBizi. `BIZI_INSTALLATION_ID` is forwarded when set. |

### HTTP Server & OAuth (inbound, remote clients only)

**The HTTP server requires OAuth-based authentication via Auth0.** Before running it, you must:

1. Create an Auth0 API for the MCP resource, with exact identifier
   `https://mcp.datosbizi.com/mcp`, RS256, and scopes `read:dashboard` and
   `read:exports`. Enable Dynamic Client Registration and Resource Parameter
   Compatibility Profile in the tenant. Claude and ChatGPT then register their
   own public clients; users do not receive an OAuth secret.

   **The API must also accept third-party (DCR) clients.** In **Applications →
   APIs → the MCP API → Settings → Default Permissions for Third Party Apps**,
   enable **User-Delegated Access** and select `read:dashboard` and
   `read:exports`. Without this, every connector fails at `/authorize` with
   `Client "<id>" is not authorized to access resource server`. Keep the tenant
   below its Applications limit (10 on the Free plan): DCR then returns
   `too_many_entities` and no client registration succeeds.

2. In **Applications → APIs → the MCP API**, select **Add Application** to
   create its **Custom API Client**. Grant that client user-delegated access to
   `https://api.datosbizi.com` and enable **On-Behalf-Of Token Exchange**. It
   is not the ordinary Machine-to-Machine application. Keep its client secret
   only in the MCP deployment.

3. Configure these environment variables:

| Variable | Purpose |
| --- | --- |
| `AUTH0_DOMAIN` | **Required.** Your Auth0 tenant domain, e.g., `example.auth0.com`. |
| `MCP_AUTH0_AUDIENCE` | **Required in production.** Exact MCP Auth0 API identifier: `https://mcp.datosbizi.com/mcp`. It is the audience verified for tokens received from connectors. |
| `API_AUTH0_AUDIENCE` | **Required in production.** Existing DatosBizi API identifier, e.g. `https://api.datosbizi.com`. OBO tokens are issued for this audience before the MCP calls the API. |
| `MCP_AUTH0_CLIENT_ID` | **Required in production.** Client ID of the special Auth0 resource-server OBO client. |
| `MCP_AUTH0_CLIENT_SECRET` | **Required in production.** Secret of that OBO client. Store only as a Coolify secret. |
| `MCP_CORS_ORIGINS` | Optional comma-separated browser origins allowed to call the HTTP MCP, e.g. `https://datosbizi.com`. When unset, browser requests are answered with `Access-Control-Allow-Origin: *` (the server uses bearer tokens, never cookies, so no credentials are exposed); discovery documents are always public. |
| `MCP_CIMD_ENABLED` | Set to `true` only after enabling **Client ID Metadata Document (CIMD) Registration** in Auth0 and importing the client documents. Adds `client_id_metadata_document_supported: true` to the authorization-server metadata. |
| `AUTH0_ISSUER_IN_AUTHORIZATION_RESPONSE` | Set to `true` only when Auth0 returns `iss` in authorization responses (tenant setting **Include Issuer in Authorization Responses**). Adds `authorization_response_iss_parameter_supported: true`, which gives ChatGPT a stable redirect URI. |
| `BASE_URL` | _(optional)_ The public URL of this server (e.g., `https://mcp.yourdomain.com`). Used to construct OAuth metadata URLs. Defaults to `http://localhost:8787`. |
| `PORT` | _(optional)_ HTTP port. Default `8787`. |

Do not set `AUTH0_AUDIENCES`, `AUTH0_ACCESS_TOKEN_ALLOWED_CLIENT_IDS`,
`AUTH0_CLIENT_IDS`, or `OAUTH_PROXY_ORIGIN` on this public DCR deployment.
`BASE_URL` is required in production and must be the HTTPS MCP URL. Set
`BIZI_ALLOWED_API_HOSTS` to an explicit comma-separated allowlist (normally
`datosbizi.com`) so authenticated tokens are never forwarded to an unintended
origin.

### Running without DCR (shared client, any number of users)

DCR creates one Auth0 Application per connector *installation*, so a free
tenant (10 Applications) runs out after a handful of users. A pre-registered or
CIMD client is **one per AI product for all users**: each user still signs in
with their own account and gets their own token, but no Application is created.

**Option A — one shared public client (works today, no user-side registration).**

1. Auth0 → Applications → **Create Application** → **Single Page Application**.
   Do not use *Regular Web Application*: that type is confidential and would
   force a client secret into every user's connector form.
2. Set **Allowed Callback URLs**:
   `https://claude.ai/api/mcp/auth_callback`,
   `https://chatgpt.com/connector_platform_oauth_redirect`,
   `http://localhost/callback`, `http://127.0.0.1/callback`.
   If ChatGPT shows a `https://chatgpt.com/connector/oauth/<id>` redirect in the
   connector page instead, add that exact URI too (it is used when the
   authorization server does not advertise RFC 9207 `iss`).
3. **Grant types**: Authorization Code, Refresh Token. **Authentication
   Method**: `none` (public client with PKCE). Authorize the app for the MCP API
   with `read:dashboard` and `read:exports` (per-app client grant, or the API's
   Default Permissions). Enable the login connection at domain level.
4. Disable **Dynamic Client Registration** in the tenant.
5. Users connect with **Use your own OAuth client** (Claude) or the
   pre-defined OAuth client field (ChatGPT) and paste this `client_id`; leave
   the secret empty.

**Option B — CIMD (no fields for users to fill).**

1. Auth0 → Settings → Advanced → enable
   **Client ID Metadata Document (CIMD) Registration**.
2. Applications → **Create Application → Import from URL**, once per AI client:
   `https://chatgpt.com/oauth/client.json` and Claude's published document
   (Claude Code: `https://claude.ai/oauth/claude-code-client-metadata`).
3. Deploy with `MCP_CIMD_ENABLED=true`. Claude selects CIMD only when the
   metadata also advertises `none` in `token_endpoint_auth_methods_supported`,
   which this server does.
4. Disable Dynamic Client Registration.

CIMD clients are third-party applications: they need an API access policy
(client grant) for the MCP API and fail if the tenant has active Rules.
ChatGPT's CIMD prefers `private_key_jwt`, which Auth0 only allows on Enterprise
plans — verify the import works on a free tenant, otherwise use Option A for
ChatGPT.

For local authenticated use, enable Device Authorization for a local DatosBizi
Auth0 client and run `bizidashboard-mcp-login` with `AUTH0_DOMAIN`,
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

## Remote connector (Claude / ChatGPT)

`npx bizidashboard-mcp` (stdio) only works for local clients like Claude
Desktop. To use this data from **claude.ai remote connectors** or **ChatGPT**,
run the HTTP server instead and expose it publicly over HTTPS. It exposes the
same nine tools through one standard MCP endpoint:

| Endpoint | Protocol | Used by |
| --- | --- | --- |
| `POST /mcp` | MCP Streamable HTTP (stateless) | Claude and ChatGPT |

Every route except `/healthz` requires an OAuth bearer token
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
  npm run start:http
```

Either way, put it behind a reverse proxy (Caddy, nginx, Traefik, …) on your
VPS to terminate TLS on a real domain — `https://mcp.yourdomain.com` — since
neither client below will call a plain-HTTP or self-signed endpoint.

### Register it

- **Claude (claude.ai → Settings → Connectors → Add custom connector)**: URL
  `https://mcp.yourdomain.com/mcp`. Authentication is OAuth 2.0 Authorization Code;
  Claude will discover the flow automatically via `/.well-known/oauth-protected-resource`.
- **ChatGPT MCP / GPT builder**: use the MCP URL and let the client complete
  OAuth through Dynamic Client Registration. Do not embed the OBO client secret
  in ChatGPT or in a public page.

### OpenAI plugin submission

The MCP-only plugin package is in `plugins/bizidashboard-mcp`. It includes the
directory metadata and starter prompts for ChatGPT/Codex. Submission copy and
review cases are in [`docs/openai-plugin-submission.md`](docs/openai-plugin-submission.md).
The public submission still needs a verified OpenAI publisher identity, legal
URLs, regional availability, and OAuth reviewer credentials.

## Development

```bash
npm run build       # compile TypeScript to dist/ (both the stdio and HTTP entrypoints)
npm run typecheck   # type-check without emitting
npm test            # build, then run integration tests against the live public API
  npm run start:http  # run the HTTP MCP server locally (needs the Auth0 MCP/OBO variables above)
```

To build the Docker image locally: `docker build -t bizidashboard-mcp .`

The existing tool smoke tests hit `https://datosbizi.com` for real. Focused
authorization tests use no live credentials and verify that remote HTTP requests never
send `BIZI_PUBLIC_API_KEY`.
