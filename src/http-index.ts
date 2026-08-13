#!/usr/bin/env node
import { createHttpServer } from './http-server.js'

const port = Number(process.env.PORT ?? 8787)

const app = createHttpServer()
app.listen(port, () => {
  console.log(`bizidashboard-mcp HTTP server listening on port ${port}`)
})
