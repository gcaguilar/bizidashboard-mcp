import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { DASHBOARD_SCOPE, EXPORTS_SCOPE, operations } from './operations.js'
import { getOAuthEndpoints } from './oauth-proxy.js'

export type OpenApiDocument = Record<string, unknown>

function toParameter(name: string, field: z.ZodTypeAny) {
  const { $schema, ...schema } = zodToJsonSchema(field, { target: 'openApi3' }) as Record<string, unknown>
  return {
    name,
    in: 'query',
    required: !field.isOptional(),
    schema,
  }
}

/**
 * Built from the same zod schemas the MCP tools use, so REST Actions and MCP tools can never drift apart.
 */
export function buildOpenApiDocument(serverUrl: string): OpenApiDocument {
  const paths: Record<string, unknown> = {}
  const oauthEndpoints = getOAuthEndpoints()
  const responseSchema = {
    type: 'object',
    properties: {},
    additionalProperties: true,
  }

  for (const operation of operations) {
    const summary = operation.description.slice(0, 300)
    const description = (operation.requiredScopes
      ? `${operation.description} Expensive variants require the ${EXPORTS_SCOPE} scope; basic requests require ${DASHBOARD_SCOPE}.`
      : `${operation.description} Requires the ${DASHBOARD_SCOPE} scope.`).slice(0, 300)
    paths[`/actions/${operation.restPath}`] = {
      get: {
        operationId: operation.name,
        summary,
        description,
        parameters: Object.entries(operation.schema).map(([name, field]) => toParameter(name, field)),
        responses: {
          '200': {
            description: 'Successful response.',
            content: { 'application/json': { schema: responseSchema } },
          },
          '400': { description: 'Invalid parameters.' },
          '401': { description: 'Missing or invalid OAuth bearer token.' },
          '403': { description: `Missing ${DASHBOARD_SCOPE} or ${EXPORTS_SCOPE} for this request variant.` },
          '502': { description: 'Upstream BiziDashboard API error.' },
        },
      },
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'BiziDashboard Actions',
      description:
        "Historical and analytical data for the Zaragoza Bizi bike-share system, served by BiziDashboard (https://datosbizi.com).",
      version: '0.1.0',
    },
    servers: [{ url: serverUrl }],
    security: [{ oauth2: [DASHBOARD_SCOPE] }],
    components: {
      schemas: {},
      securitySchemes: {
        oauth2: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: oauthEndpoints.authorizationUrl,
              tokenUrl: oauthEndpoints.tokenUrl,
              scopes: {
                [DASHBOARD_SCOPE]: 'Read standard BiziDashboard data and analytics.',
                [EXPORTS_SCOPE]: 'Read CSV exports and expensive historical/rebalancing queries.',
              },
            },
          },
        },
      },
    },
    paths,
  }
}
