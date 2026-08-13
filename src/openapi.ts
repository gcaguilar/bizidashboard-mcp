import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { operations } from './operations.js'

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

  for (const operation of operations) {
    paths[`/actions/${operation.restPath}`] = {
      get: {
        operationId: operation.name,
        summary: operation.description,
        parameters: Object.entries(operation.schema).map(([name, field]) => toParameter(name, field)),
        responses: {
          '200': {
            description: 'Successful response.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '400': { description: 'Invalid parameters.' },
          '401': { description: 'Missing or invalid OAuth bearer token.' },
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
    security: [{ oauth2: ['read'] }],
    components: {
      securitySchemes: {
        oauth2: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: `https://${process.env.AUTH0_DOMAIN || 'example.auth0.com'}/authorize`,
              tokenUrl: `https://${process.env.AUTH0_DOMAIN || 'example.auth0.com'}/oauth/token`,
              scopes: {
                read: 'Read access to protected resources',
              },
            },
          },
        },
      },
    },
    paths,
  }
}
