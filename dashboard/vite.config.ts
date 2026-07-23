import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { pathToFileURL } from 'url'

function safeJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return {} }
}

// Corre las funciones serverless de `../api/*.js` (estilo Vercel) bajo el dev
// server de Vite, para poder probar el panel admin en local. Solo en `serve`;
// en producción Vercel las ejecuta nativamente. Lee secretos de un .env local
// (SUPABASE_SERVICE_KEY, ADMIN_TOKEN, OPENROUTER_API_KEY) sin prefijo VITE_.
function apiDevServer(env: Record<string, string>): Plugin {
  for (const [k, v] of Object.entries(env)) {
    if (v && !(k in process.env)) process.env[k] = v
  }
  const apiDir = path.resolve(__dirname, '../api')
  return {
    name: 'api-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        if (!url.startsWith('/api/')) return next()
        const name = url.split('?')[0].slice('/api/'.length).replace(/\/+$/, '')
        if (!/^[a-z0-9_-]+$/i.test(name)) return next()

        let bodyStr = ''
        req.on('data', (c) => { bodyStr += c })
        req.on('end', async () => {
          ;(req as unknown as { body: unknown }).body = bodyStr ? safeJson(bodyStr) : {}
          const r = res as unknown as {
            status: (code: number) => typeof r
            json: (obj: unknown) => void
          }
          r.status = (code: number) => { res.statusCode = code; return r }
          r.json = (obj: unknown) => {
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(obj))
          }
          try {
            const file = path.join(apiDir, `${name}.js`)
            const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`)
            if (typeof mod.default !== 'function') return next()
            await mod.default(req, res)
          } catch (err) {
            res.statusCode = 500
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ error: String((err as Error)?.message || err) }))
          }
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname), '')
  return {
    plugins: [react(), apiDevServer(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
