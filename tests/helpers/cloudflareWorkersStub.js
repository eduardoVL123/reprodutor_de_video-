/**
 * Stub de cloudflare:workers para ambiente de testes (Vitest / Node.js).
 * No runtime do Cloudflare Workers (workerd), o módulo nativo é utilizado.
 */
export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx
    this.env = env
  }
}
