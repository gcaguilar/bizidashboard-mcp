import { z } from 'zod'
import { fetchCsv, fetchJson, type QueryParams } from './client.js'

export type OperationResult = { kind: 'json'; data: unknown } | { kind: 'csv'; text: string }

async function jsonOrCsv<T>(route: string, format: 'json' | 'csv' | undefined, params: QueryParams): Promise<OperationResult> {
  if (format === 'csv') {
    const text = await fetchCsv(route, { ...params, format: 'csv' })
    return { kind: 'csv', text }
  }
  const data = await fetchJson<T>(route, params)
  return { kind: 'json', data }
}

export type OperationDefinition = {
  name: string
  description: string
  schema: z.ZodRawShape
  /** REST path segment served under /actions, e.g. "stations". */
  restPath: string
  run: (args: Record<string, unknown>) => Promise<OperationResult>
}

export const operations: OperationDefinition[] = [
  {
    name: 'get_stations',
    description:
      'List every Bizi Zaragoza station with its latest known availability snapshot (bikes available, free anchors, capacity, location). Reflects the most recent GBFS collection, not necessarily real time to the second.',
    schema: {
      format: z.enum(['json', 'csv']).optional().describe('Response format. Defaults to json.'),
    },
    restPath: 'stations',
    run: (args) => jsonOrCsv('/api/stations', args.format as 'json' | 'csv' | undefined, {}),
  },
  {
    name: 'get_rankings',
    description:
      'Rank stations by turnover (bike rotation activity) or availability. Useful for finding the busiest or most reliably stocked stations over the observed history.',
    schema: {
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
    restPath: 'rankings',
    run: (args) =>
      jsonOrCsv('/api/rankings', args.format as 'json' | 'csv' | undefined, {
        type: args.type as string,
        limit: args.limit as number | undefined,
      }),
  },
  {
    name: 'get_alerts',
    description: 'List currently active alerts (stations running low on bikes or free anchors right now).',
    schema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe('Maximum number of alerts to return. Defaults to 50.'),
    },
    restPath: 'alerts',
    run: async (args) => ({
      kind: 'json',
      data: await fetchJson('/api/alerts', { limit: args.limit as number | undefined }),
    }),
  },
  {
    name: 'get_alerts_history',
    description:
      'Query historical alerts (resolved and active) with filters by station, alert type, severity, and time range. This is the tool for "how often has station X run out of bikes" style questions. Requesting format=csv or a limit above 500 rows requires BIZI_PUBLIC_API_KEY to be configured.',
    schema: {
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
    restPath: 'alerts-history',
    run: (args) =>
      jsonOrCsv('/api/alerts/history', args.format as 'json' | 'csv' | undefined, {
        state: args.state as string | undefined,
        stationId: args.stationId as string | undefined,
        alertType: args.alertType as string | undefined,
        severity: args.severity as number | undefined,
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        limit: args.limit as number | undefined,
        offset: args.offset as number | undefined,
      }),
  },
  {
    name: 'get_patterns',
    description: 'Get weekday vs. weekend hourly occupancy patterns for a single station, showing typical bike availability by hour.',
    schema: {
      stationId: z.string().describe('Station identifier.'),
    },
    restPath: 'patterns',
    run: async (args) => ({
      kind: 'json',
      data: await fetchJson('/api/patterns', { stationId: args.stationId as string }),
    }),
  },
  {
    name: 'get_heatmap',
    description: 'Get occupancy heatmap cells (day x hour) for a single station.',
    schema: {
      stationId: z.string().describe('Station identifier.'),
    },
    restPath: 'heatmap',
    run: async (args) => ({
      kind: 'json',
      data: await fetchJson('/api/heatmap', { stationId: args.stationId as string }),
    }),
  },
  {
    name: 'get_mobility',
    description:
      'Get mobility signals: hourly demand curve, station-to-station flow signals, and public transit impact analysis. Good for understanding usage rhythms rather than instantaneous state.',
    schema: {
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
    restPath: 'mobility',
    run: async (args) => ({
      kind: 'json',
      data: await fetchJson('/api/mobility', {
        mobilityDays: args.mobilityDays as number | undefined,
        demandDays: args.demandDays as number | undefined,
        month: args.month as string | undefined,
      }),
    }),
  },
  {
    name: 'get_history',
    description:
      'Get full historical daily demand/balance data since BiziDashboard started recording this city, plus coverage metadata. This is the long-range view the official GBFS feed cannot provide since it only exposes current state.',
    schema: {
      format: z.enum(['json', 'csv']).optional().describe('Response format. Defaults to json.'),
    },
    restPath: 'history',
    run: (args) => jsonOrCsv('/api/history', args.format as 'json' | 'csv' | undefined, {}),
  },
  {
    name: 'get_rebalancing_report',
    description:
      'Get the station rebalancing diagnostic report: per-station classification (overstock, deficit, peak saturation, peak emptying, balanced, data_review), 1h/3h empty/full risk predictions, and origin-destination bike transfer recommendations. Optionally filter by district/barrio. Requesting format=csv or a days window above 30 requires BIZI_PUBLIC_API_KEY to be configured.',
    schema: {
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
    restPath: 'rebalancing-report',
    run: (args) =>
      jsonOrCsv('/api/rebalancing-report', args.format as 'json' | 'csv' | undefined, {
        district: args.district as string | undefined,
        days: args.days as number | undefined,
      }),
  },
]
