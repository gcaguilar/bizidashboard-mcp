# Local verification probes

Manual diagnostics for the HTTP server. They sign their own RS256 tokens and
run against `dist/`, so build first:

```bash
npm run build
```

Then run the probe you need:

- `npm run verify:protocol` (port 8797): JSON-RPC parse errors, notifications,
  `ping`, unknown methods, and missing tool arguments.
- `npm run verify:headers` (port 8798): `Accept` negotiation, `Mcp-Session-Id`,
  authorization-server and protected-resource metadata, and `DELETE /mcp`.
- `npm run verify:local` (port 8799): missing token, scope enforcement,
  `tools/list`, a public tool call, and an elevated tool call through OBO.
  The elevated call needs the production API and OBO client environment
  variables; without them it only prints the upstream error.

These scripts are not part of `npm test`; the automated coverage lives in
`test/`.
