# OpenAI plugin submission

This repository packages BiziDashboard as an MCP-only plugin for ChatGPT and
Codex. It has no custom UI and no write actions.

## Server to submit

- MCP server URL: `https://mcp.datosbizi.com/mcp`
- Transport: Streamable HTTP
- Authentication: OAuth 2.1 through Auth0 Dynamic Client Registration
- Authorization: the server exchanges the connector token On-Behalf-Of the
  signed-in user before querying the DatosBizi API.

## Listing copy

- Name: BiziDashboard
- Short description: Analyze Zaragoza Bizi stations and historical demand.
- Category: Productivity
- Capabilities: Read
- Website: https://datosbizi.com

## Starter prompts

1. Which Bizi Zaragoza stations have the most bikes available?
2. Show occupancy patterns for a Bizi station.
3. Summarize the current Bizi Zaragoza alerts.

## Reviewer test cases

Positive:

1. List the Bizi Zaragoza stations with the highest availability.
2. Show active Bizi Zaragoza alerts.
3. Find the weekday and weekend occupancy pattern for station `1`.
4. Summarize the Zaragoza Bizi mobility signals for the last 14 days.
5. Generate the Bizi Zaragoza rebalancing report for the default window.

Negative:

1. Request a station pattern without a station ID; the tool input must be rejected.
2. Request rankings with a metric other than `turnover` or `availability`; the tool input must be rejected.
3. Request a CSV export without the `read:exports` OAuth scope; the server must return an actionable authorization error.

## Required portal inputs

Before submission, provide the verified developer/business identity, support
contact, privacy-policy URL, terms-of-service URL, countries where the service
is available, and reviewer credentials that can complete OAuth without MFA.
