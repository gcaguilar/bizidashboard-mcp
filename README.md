# bizidashboard-mcp

MCP server exposing [BiziDashboard](https://datosbizi.com)'s historical and analytical
data for the Zaragoza Bizi bike-share system as tools for LLM clients.

Unlike the official GBFS feed (which only exposes the current state of the system),
BiziDashboard stores and analyzes history: rankings, occupancy patterns, mobility
signals, alert history, and a station rebalancing diagnostic report. This server makes
that analytical layer easy to query from Claude Desktop or any other MCP client.

## Installation

This package is not published to npm yet. Clone it and point your MCP client at the
built entrypoint:

```bash
git clone <this-repo> bizidashboard-mcp
cd bizidashboard-mcp
npm install
npm run build
```

Then add it to your MCP client config (e.g. `claude_desktop_config.json`):

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

Both variables are optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BIZI_API_BASE_URL` | `https://datosbizi.com` | Base URL of the BiziDashboard instance to query. Override to point at another city's deployment or a local dev server. |
| `BIZI_PUBLIC_API_KEY` | _(none)_ | `X-Public-Api-Key` sent on every request. Only required for elevated calls (CSV exports on `get_alerts_history`/`get_rebalancing_report`, or wide `days`/`limit` windows on those two tools). Everything else works anonymously. |

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

## Development

```bash
npm run build       # compile TypeScript to dist/
npm run typecheck   # type-check without emitting
npm test            # build, then run integration tests against the live public API
```

Tests hit `https://datosbizi.com` for real — there are no mocks. A couple of tests are
skipped automatically if `BIZI_PUBLIC_API_KEY` is not set, since they'd otherwise
require a real elevated-access key to assert success.
