/**
 * Vite config wrapper for independent web/ preview.
 * Loads web/vite.config.ts, forces base `/`, and proxies /api to the fixture.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const webDir = path.join(root, 'web')
const require = createRequire(path.join(webDir, 'package.json'))

export default async function (environment) {
  const vitePkg = path.dirname(require.resolve('vite/package.json'))
  const vitePath = pathToFileURL(path.join(vitePkg, 'dist/node/index.js')).href
  const { loadConfigFromFile, mergeConfig } = await import(vitePath)
  const file = path.join(webDir, 'vite.config.ts')
  const loaded = await loadConfigFromFile(environment, file)
  if (!loaded) throw new Error('Could not load web/ Vite configuration')

  const fixtureTarget =
    process.env.VITE_DEV_PROXY_TARGET ||
    process.env.CSHELL_WEB_FIXTURE_URL ||
    'http://127.0.0.1:41949'

  return mergeConfig(loaded.config, {
    base: '/',
    server: {
      host: '127.0.0.1',
      port: Number(process.env.VITE_DEV_PORT || process.env.CSHELL_WEB_VITE_PORT || 4285),
      strictPort: true,
      proxy: {
        '/api': {
          target: fixtureTarget,
          changeOrigin: true,
        },
      },
    },
  })
}
