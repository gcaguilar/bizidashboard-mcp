import { AsyncLocalStorage } from 'node:async_hooks'

export type RequestAuthorization = {
  /** The original bearer token supplied by the remote MCP/Actions client. */
  token?: string
  /** Scopes verified by the OAuth middleware. */
  scopes?: string[]
  /**
   * Remote requests must never inherit local credentials such as
   * BIZI_PUBLIC_API_KEY or a token stored by the stdio login flow.
   */
  remote: boolean
}

const storage = new AsyncLocalStorage<RequestAuthorization | undefined>()

export function withRequestAuthorization<T>(authorization: RequestAuthorization, callback: () => T): T {
  return storage.run(authorization, callback)
}

export function requestAuthorization(): RequestAuthorization | undefined {
  return storage.getStore()
}
