import { z } from 'zod'
import { BiziApiError, fetchCsv, fetchJson, type QueryParams } from './client.js'

export type ToolTextResult = {
  content: [{ type: 'text'; text: string }]
  isError?: boolean
}

function jsonResult(data: unknown): ToolTextResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function textResult(text: string): ToolTextResult {
  return { content: [{ type: 'text', text }] }
}

function errorResult(error: unknown): ToolTextResult {
  const message = error instanceof BiziApiError ? error.message : `Unexpected error: ${String(error)}`
  return { content: [{ type: 'text', text: message }], isError: true }
}

async function getJsonOrCsv<T>(route: string, format: 'json' | 'csv' | undefined, params: QueryParams): Promise<ToolTextResult> {
  if (format === 'csv') {
    const csv = await fetchCsv(route, { ...params, format: 'csv' })
    return textResult(csv)
  }
  const data = await fetchJson<T>(route, params)
  return jsonResult(data)
}

export type ToolDefinition = {
  name: string
  description: string
  schema: z.ZodRawShape
  handler: (args: Record<string, unknown>) => Promise<ToolTextResult>
}

/**
 * Every tool handler is wrapped so it never throws: MCP clients and direct callers (tests)
 * see the same isError-flagged result shape regardless of how the tool is invoked.
 */
function defineTool(
  name: string,
  description: string,
  schema: z.ZodRawShape,
  run: (args: Record<string, unknown>) => Promise<ToolTextResult>
): ToolDefinition {
  return {
    name,
    description,
    schema,
    handler: async (args) => {
      try {
        return await run(args)
      } catch (error) {
        return errorResult(error)
      }
    },
  }
}

export const tools: ToolDefinition[] = [
  defineTool(
    'get_stations',
    'List every Bizi Zaragoza station with its latest known availability snapshot (bikes available, free anchors, capacity, location). Reflects the most recent GBFS collection, not necessarily real time to the second.',
    {
      format: z.enum(['json', 'csv']).optional().describe('Response format. Defaults to json.'),
    },
    async (args) => getJsonOrCsv('/api/stations', args.format as 'json' | 'csv' | undefined, {})
  ),
  defineTool(
    'get_rankings',
    'Rank stations by turnover (bike rotation activity) or availability. Useful for finding the busiest or most reliably stocked stations over the observed history.',
    {
      type: z.enum(['turnover', 'availability']).describe('Ranking metric to sort by.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Maximum number of stations to return. Defaults to 20.'),
      format: z.enum(['json', 'csv']).optional().describe('Response format. Defaults to json.'),
    },
    async (args) =>
      getJsonOrCsv('/api/rankings', args.format as 'json' | 'csv' | undefined, {
        type: args.type as string,
        limit: args.limit as number | undefined,
      })
  ),
  defineTool(
    'get_alerts',
    'List currently active alerts (stations running low on bikes or free anchors right now).',
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Maximum number of alerts to return. Defaults to 50.'),
    },
    async (args) => jsonResult(await fetchJson('/api/alerts', { limit: args.limit as number | undefined }))
  ),
  defineTool(
    'get_alerts_history',
    'Query historical alerts (resolved and active) with filters by station, alert type, severity, and time range. This is the tool for "how often has station X run out of bikes" style questions. Requesting format=csv or a limit above 500 rows requires BIZI_PUBLIC_API_KEY to be configured.',
    {
      state: z.enum(['all', 'active', 'resolved']).optional().describe('Filter by alert state. Defaults to all.'),
      stationId: z.string().optional().describe('Filter by a specific station id.'),
      alertType: z
        .enum(['all', 'LOW_BIKES', 'LOW_ANCHORS'])
        .optional()
        .describe('Filter by alert type. Defaults to all.'),
      severity: z.number().int().min(1).max(5).optional().describe('Filter by severity (1=media, 2=critica).'),
      from: z.string().optional().describe('Start datetime, ISO 8601.'),
      to: z.string().optional().describe('End datetime, ISO 8601.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .describe('Rows per page. Defaults to 200. Values above 500 require BIZI_PUBLIC_API_KEY.'),
      offset: z.number().int().min(0).max(20000).optional().describe('Pagination offset. Defaults to 0.'),
      format: z
        .enum(['json', 'csv'])
        .optional()
        .describe('Response format. csv requires BIZI_PUBLIC_API_KEY. Defaults to json.'),
    },
    async (args) =>
      getJsonOrCsv('/api/alerts/history', args.format as 'json' | 'csv' | undefined, {
        state: args.state as string | undefined,
        stationId: args.stationId as string | undefined,
        alertType: args.alertType as string | undefined,
        severity: args.severity as number | undefined,
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        limit: args.limit as number | undefined,
        offset: args.offset as number | undefined,
      })
  ),
  defineTool(
    'get_patterns',
    'Get weekday vs. weekend hourly occupancy patterns for a single station, showing typical bike availability by hour.',
    {
      stationId: z.string().describe('Station identifier.'),
    },
    async (args) => jsonResult(await fetchJson('/api/patterns', { stationId: args.stationId as string }))
  ),
  defineTool(
    'get_heatmap',
    'Get occupancy heatmap cells (day x hour) for a single station.',
    {
      stationId: z.string().describe('Station identifier.'),
    },
    async (args) => jsonResult(await fetchJson('/api/heatmap', { stationId: args.stationId as string }))
  ),
  defineTool(
    'get_mobility',
    'Get mobility signals: hourly demand curve, station-to-station flow signals, and public transit impact analysis. Good for understanding usage rhythms rather than instantaneous state.',
    {
      mobilityDays: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe('Lookback window in days for hourly mobility signals. Defaults to 14.'),
      demandDays: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe('Lookback window in days for the daily demand curve. Defaults to 30.'),
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional()
        .describe('Optional specific month to inspect, formatted YYYY-MM.'),
    },
    async (args) =>
      jsonResult(
        await fetchJson('/api/mobility', {
          mobilityDays: args.mobilityDays as number | undefined,
          demandDays: args.demandDays as number | undefined,
          month: args.month as string | undefined,
        })
      )
  ),
  defineTool(
    'get_history',
    'Get full historical daily demand/balance data since BiziDashboard started recording this city, plus coverage metadata. This is the long-range view the official GBFS feed cannot provide since it only exposes current state.',
    {
      format: z.enum(['json', 'csv']).optional().describe('Response format. Defaults to json.'),
    },
    async (args) => getJsonOrCsv('/api/history', args.format as 'json' | 'csv' | undefined, {})
  ),
  defineTool(
    'get_rebalancing_report',
    'Get the station rebalancing diagnostic report: per-station classification (overstock, deficit, peak saturation, peak emptying, balanced, data_review), 1h/3h empty/full risk predictions, and origin-destination bike transfer recommendations. Optionally filter by district/barrio. Requesting format=csv or a days window above 30 requires BIZI_PUBLIC_API_KEY to be configured.',
    {
      district: z.string().optional().describe('Filter by barrio/district name, e.g. "Centro" or "Delicias".'),
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe('Analysis window in days. Defaults to 15. Values above 30 require BIZI_PUBLIC_API_KEY.'),
      format: z
        .enum(['json', 'csv'])
        .optional()
        .describe('Response format. csv requires BIZI_PUBLIC_API_KEY. Defaults to json.'),
    },
    async (args) =>
      getJsonOrCsv('/api/rebalancing-report', args.format as 'json' | 'csv' | undefined, {
        district: args.district as string | undefined,
        days: args.days as number | undefined,
      })
  ),
]
