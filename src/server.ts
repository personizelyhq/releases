import { serve, type ServerType } from '@hono/node-server'
import type { ResolvedConfig } from './config/schema.js'
import { createApp, type AppOptions, type ReleasesApp } from './app.js'

export interface RunningServer extends ReleasesApp {
  server: ServerType
  stop: () => Promise<void>
}

/** Create the app and listen on cfg.host:cfg.port. */
export async function startServer (cfg: ResolvedConfig, opts: AppOptions = {}): Promise<RunningServer> {
  const created = await createApp(cfg, opts)
  const server = await new Promise<ServerType>(resolve => {
    const s = serve({ fetch: created.app.fetch, port: cfg.port, hostname: cfg.host }, () => resolve(s))
  })
  const stop = () => new Promise<void>(resolve => {
    created.close()
    server.close(() => resolve())
  })
  return { ...created, server, stop }
}
