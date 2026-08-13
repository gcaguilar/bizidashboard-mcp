import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage<string | undefined>()
export function withRequestToken<T>(token: string | undefined, callback: () => T): T { return storage.run(token, callback) }
export function requestToken(): string | undefined { return storage.getStore() }
