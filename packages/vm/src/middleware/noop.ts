import type { Middleware } from './types.js'

const fn: Middleware = (ctx, next) => next()
const noopMiddleware: Middleware & { readonly name: string } =
  Object.defineProperty(fn, 'name', { value: 'noop' }) as never

export { noopMiddleware }
