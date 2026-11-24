#!/usr/bin/env node
/**
 * Independent web/ preview: start | stop | status | serve
 * Default ports (distinct from historical workspace 4184/4185/40949):
 *   front 4284 · vite 4285 · fixture 41949
 * Never stops or binds the historical workspace ports.
 */
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, unlink, open, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createCshellWebFixture } from './cshell-web-fixture.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const webDir = path.join(root, 'web')
const dir = path.join(root, 'artifacts/cshell-web')
await mkdir(dir, { recursive: true })
const statePath = path.join(dir, 'preview-state.json')

const action = process.argv[2] || 'start'
const frontPort = Number(process.env.CSHELL_WEB_PORT || process.env.WORKSPACE_PORT || 4284)
const fixturePort = Number(
  process.env.CSHELL_WEB_FIXTURE_PORT || process.env.WORKSPACE_FIXTURE_PORT || 41949,
)
const internalPort = Number(
  process.env.CSHELL_WEB_VITE_PORT || process.env.WORKSPACE_VITE_PORT || 4285,
)

// Refuse accidental collision with historical workspace preview ports.
for (const [name, port] of [
  ['front', frontPort],
  ['vite', internalPort],
  ['fixture', fixturePort],
]) {
  if ([4184, 4185, 40949].includes(port)) {
    console.error(`Refusing to use historical workspace port ${port} for ${name}`)
    process.exit(1)
  }
}

const staticMode = process.env.CSHELL_WEB_STATIC === '1'
const staticDir = path.join(webDir, 'dist-preview')
const token = process.env.CSHELL_WEB_OWNER_TOKEN || `cshell-web-preview-${process.pid}`
const stateRead = async () => JSON.parse(await readFile(statePath, 'utf8'))

const BADGE =
  'LOCAL MOCK DATA · independent web · no real payments'

if (action === 'stop') {
  try {
    const s = await stateRead()
    const r = await fetch(`${s.url}/__cshell_web/stop`, {
      method: 'POST',
      headers: { 'x-cshell-web-owner': s.token },
    })
    if (!r.ok) throw new Error('Stop ownership check failed')
    let stopped = false
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(`${s.url}/__cshell_web/health`, { signal: AbortSignal.timeout(300) })
      } catch {
        stopped = true
        break
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    if (!stopped) throw new Error('Owned preview did not stop within 10 seconds')
    console.log('Stopped owned cshell-web preview')
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
} else if (action === 'status') {
  try {
    const s = await stateRead()
    const r = await fetch(`${s.url}/__cshell_web/health`, { signal: AbortSignal.timeout(2000) })
    const health = await r.json()
    if (!r.ok || health.token !== s.token || !health.mock) {
      throw new Error('Preview ownership/health mismatch')
    }
    console.log(JSON.stringify({ ...s, token: undefined, healthy: true }, null, 2))
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
} else if (action === 'start') {
  try {
    const s = await stateRead()
    const r = await fetch(`${s.url}/__cshell_web/health`, { signal: AbortSignal.timeout(1000) })
    if (r.ok) {
      const health = await r.json()
      if (health.token !== s.token || !health.mock) throw new Error('Preview ownership mismatch')
      throw new Error(`Owned preview already running at ${s.url}`)
    }
  } catch (e) {
    if (e.message.startsWith('Owned preview') || e.message === 'Preview ownership mismatch') throw e
  }
  const log = await open(path.join(dir, 'preview.log'), 'a')
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log.fd, log.fd],
    env: { ...process.env, CSHELL_WEB_OWNER_TOKEN: token },
  })
  child.unref()
  await log.close()
  let ready = false
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${frontPort}/__cshell_web/health`)
      const j = await r.json()
      if (j.token === token) {
        ready = true
        break
      }
    } catch {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  if (!ready) {
    try {
      process.kill(child.pid, 'SIGTERM')
    } catch {
      /* ignore */
    }
    console.error('Preview failed readiness; inspect artifacts/cshell-web/preview.log')
    process.exitCode = 1
  } else {
    console.log(`LOCAL MOCK DATA preview: http://127.0.0.1:${frontPort}/dashboard`)
  }
} else if (action === 'serve') {
  const fixture = createCshellWebFixture()
  await new Promise((resolve, reject) => {
    fixture.once('error', reject)
    fixture.listen(fixturePort, '127.0.0.1', resolve)
  })

  const viteBin = path.join(webDir, 'node_modules/vite/bin/vite.js')

  if (staticMode) {
    const build = spawn(
      process.execPath,
      [
        viteBin,
        'build',
        '--config',
        path.join(root, 'scripts/cshell-web-vite.config.mjs'),
        '--outDir',
        'dist-preview',
        '--emptyOutDir',
      ],
      {
        cwd: webDir,
        stdio: 'inherit',
        env: { ...process.env, VITE_BASE: '/' },
      },
    )
    const built = await new Promise((resolve) => build.on('exit', (code) => resolve(code)))
    if (built !== 0) {
      fixture.closeAllConnections()
      await new Promise(resolve => fixture.close(resolve))
      throw new Error('Preview build failed')
    }

    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
      '.ico': 'image/x-icon',
    }

    let closing = false
    let server
    const close = async () => {
      if (closing) return
      closing = true
      fixture.closeAllConnections()
      fixture.close()
      server?.close()
      server?.closeAllConnections?.()
      await unlink(statePath).catch(() => {})
      process.exit(0)
    }
    process.on('SIGTERM', close)
    process.on('SIGINT', close)

    const serveFile = async (res, file, status = 200) => {
      const body = await readFile(file)
      res.writeHead(status, {
        'content-type': mime[path.extname(file)] || 'application/octet-stream',
        'cache-control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=60',
      })
      res.end(body)
    }
    const inject = (html) =>
      html.replace(
        '</body>',
        `<div id="cshell-web-mock-label" role="note" style="position:fixed;bottom:8px;right:8px;z-index:2147483647;padding:6px 10px;background:#713f12;color:#fff;font:12px/1.4 system-ui;max-width:calc(100vw - 16px);box-sizing:border-box;pointer-events:none">${BADGE}</div></body>`,
      )

    server = createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (url.pathname === '/__cshell_web/health') {
        res.setHeader('content-type', 'application/json')
        const fixtureHealth = await fetch(`http://127.0.0.1:${fixturePort}/api/v1/__cshell_web/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null)
        const built = await stat(path.join(staticDir, 'index.html')).then(s => s.isFile()).catch(() => false)
        res.statusCode = fixtureHealth?.ok && built ? 200 : 503
        res.end(JSON.stringify({ mock: true, token, fixturePort, internalPort, static: true, healthy: res.statusCode === 200 }))
        return
      }
      if (url.pathname === '/__cshell_web/stop') {
        if (req.method !== 'POST' || req.headers['x-cshell-web-owner'] !== token) {
          res.writeHead(403)
          res.end()
          return
        }
        res.end('Stopping')
        setTimeout(close, 25)
        return
      }
      if (url.pathname === '/__cshell_web/reset' && req.method === 'POST') {
        const upstream = await fetch(`http://127.0.0.1:${fixturePort}/api/v1/__cshell_web/reset`, {
          method: 'POST',
        })
        res.writeHead(upstream.status, { 'content-type': 'application/json' })
        res.end(Buffer.from(await upstream.arrayBuffer()))
        return
      }
      if (url.pathname === '/__cshell_web/report') {
        const upstream = await fetch(`http://127.0.0.1:${fixturePort}/api/v1/__cshell_web/report`)
        res.writeHead(upstream.status, { 'content-type': 'application/json' })
        res.end(Buffer.from(await upstream.arrayBuffer()))
        return
      }
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(
          `<!doctype html><html><head><title>LOCAL MOCK admin</title></head><body data-cshell-web-admin-stub="1"><p>LOCAL MOCK · upstream admin gate (not the user workspace)</p><div id="cshell-web-mock-label" role="note">${BADGE}</div></body></html>`,
        )
        return
      }

      const isApi = /^\/(api|v1|setup)(\/|$)/.test(url.pathname)
      if (isApi) {
        const target = `http://127.0.0.1:${fixturePort}` + (req.url || '/')
        try {
          const chunks = []
          for await (const c of req) chunks.push(c)
          const body = Buffer.concat(chunks)
          const headers = { ...req.headers }
          delete headers.host
          delete headers.connection
          const upstream = await fetch(target, {
            method: req.method,
            headers,
            body: body.length ? body : undefined,
            redirect: 'manual',
          })
          const outHeaders = Object.fromEntries(upstream.headers)
          res.writeHead(upstream.status, outHeaders)
          res.end(Buffer.from(await upstream.arrayBuffer()))
        } catch (e) {
          console.error(e)
          res.writeHead(502)
          res.end('Preview proxy failed')
        }
        return
      }

      const cleaned = path
        .normalize(decodeURIComponent(url.pathname))
        .replace(/^(\.\.(\/|\\|$))+/, '')
        .replace(/^[/\\]+/, '')
      const candidate = path.join(staticDir, cleaned)
      try {
        const info = await stat(candidate)
        if (info.isFile()) {
          if (path.extname(candidate) === '.html') {
            const html = await readFile(candidate, 'utf8')
            res.writeHead(200, { 'content-type': mime['.html'], 'cache-control': 'no-cache' })
            res.end(inject(html))
            return
          }
          return serveFile(res, candidate, 200)
        }
      } catch {
        /* fall through to SPA */
      }
      if (url.pathname.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(url.pathname)) {
        res.writeHead(404)
        res.end('Static resource not found')
        return
      }
      const index = path.join(staticDir, 'index.html')
      const html = await readFile(index, 'utf8')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
      res.end(inject(html))
    })

    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(frontPort, '127.0.0.1', resolve)
    })
  } else {
  const vite = spawn(
    process.execPath,
    [
      viteBin,
      '--config',
      path.join(root, 'scripts/cshell-web-vite.config.mjs'),
      '--host',
      '127.0.0.1',
      '--port',
      String(internalPort),
      '--strictPort',
    ],
    {
      cwd: webDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_DEV_PROXY_TARGET: `http://127.0.0.1:${fixturePort}`,
        VITE_DEV_PORT: String(internalPort),
        VITE_BASE: '/',
        VITE_BASE_PATH: '/',
      },
    },
  )

  let closing = false
  let server
  let viteExited = false
  vite.on('exit', () => {
    viteExited = true
  })

  const close = async () => {
    if (closing) return
    closing = true
    vite.kill('SIGTERM')
    fixture.close()
    server?.close()
    server?.closeAllConnections?.()
    for (let i = 0; i < 50 && !viteExited; i++) await new Promise((r) => setTimeout(r, 100))
    if (!viteExited) vite.kill('SIGKILL')
    await unlink(statePath).catch(() => {})
    process.exit(0)
  }

  process.on('SIGTERM', close)
  process.on('SIGINT', close)
  vite.on('exit', () => {
    if (!closing) close()
  })

  for (let i = 0; i < 120; i++) {
    if (viteExited) throw new Error('Vite exited before readiness')
    try {
      const r = await fetch(`http://127.0.0.1:${internalPort}/`)
      if (r.ok) break
    } catch {
      /* wait */
    }
    if (i === 119) throw new Error('Vite failed readiness')
    await new Promise((r) => setTimeout(r, 500))
  }

  server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')

    if (url.pathname === '/__cshell_web/health') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ mock: true, token, fixturePort, internalPort }))
      return
    }

    if (url.pathname === '/__cshell_web/stop') {
      if (req.method !== 'POST' || req.headers['x-cshell-web-owner'] !== token) {
        res.writeHead(403)
        res.end()
        return
      }
      res.end('Stopping')
      setTimeout(close, 25)
      return
    }

    if (url.pathname === '/__cshell_web/reset' && req.method === 'POST') {
      const upstream = await fetch(`http://127.0.0.1:${fixturePort}/api/v1/__cshell_web/reset`, {
        method: 'POST',
      })
      res.writeHead(upstream.status, { 'content-type': 'application/json' })
      res.end(Buffer.from(await upstream.arrayBuffer()))
      return
    }

    if (url.pathname === '/__cshell_web/report') {
      const upstream = await fetch(`http://127.0.0.1:${fixturePort}/api/v1/__cshell_web/report`)
      res.writeHead(upstream.status, { 'content-type': 'application/json' })
      res.end(Buffer.from(await upstream.arrayBuffer()))
      return
    }

    // Admin SPA lives outside this app; return a stub so redirects do not 502.
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><html><head><title>LOCAL MOCK admin</title></head><body data-cshell-web-admin-stub="1"><p>LOCAL MOCK · upstream admin gate (not the user workspace)</p><div id="cshell-web-mock-label" role="note">${BADGE}</div></body></html>`,
      )
      return
    }

    try {
      const isApi = /^\/(api|v1|setup)(\/|$)/.test(url.pathname)
      const target =
        `http://127.0.0.1:${isApi ? fixturePort : internalPort}` + (req.url || '/')
      const chunks = []
      for await (const c of req) chunks.push(c)
      const body = Buffer.concat(chunks)
      const headers = { ...req.headers }
      delete headers.host
      delete headers.connection
      delete headers['accept-encoding']
      delete headers.upgrade

      let upstream
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          upstream = await fetch(target, {
            method: req.method,
            headers,
            body: body.length ? body : undefined,
            redirect: 'manual',
          })
          break
        } catch (error) {
          if (req.method !== 'GET' || error.cause?.code !== 'ECONNRESET' || attempt === 2) {
            throw error
          }
          console.warn('Retry local GET after Vite socket reset:', req.url)
        }
      }

      const outHeaders = Object.fromEntries(upstream.headers)
      delete outHeaders['content-encoding']
      delete outHeaders['content-length']
      delete outHeaders['transfer-encoding']

      res.writeHead(upstream.status, outHeaders)
      if ((upstream.headers.get('content-type') || '').includes('text/html')) {
        let text = await upstream.text()
        text = text.replace(
          '</body>',
          `<div id="cshell-web-mock-label" role="note" style="position:fixed;bottom:8px;right:8px;z-index:2147483647;padding:6px 10px;background:#713f12;color:#fff;font:12px/1.4 system-ui;max-width:calc(100vw - 16px);box-sizing:border-box;pointer-events:none">${BADGE}</div></body>`,
        )
        res.end(text)
      } else {
        res.end(Buffer.from(await upstream.arrayBuffer()))
      }
    } catch (e) {
      console.error(e)
      res.writeHead(502)
      res.end('Preview proxy failed')
    }
  })

  server.on('upgrade', (req, socket, head) => {
    const upstream = connect(internalPort, '127.0.0.1', () => {
      upstream.write(
        `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
          Object.entries(req.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\r\n') +
          '\r\n\r\n',
      )
      if (head.length) upstream.write(head)
      socket.pipe(upstream)
      upstream.pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    socket.on('close', () => upstream.destroy())
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(frontPort, '127.0.0.1', resolve)
  })
  }

  await writeFile(
    statePath,
    JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        pid: process.pid,
        url: `http://127.0.0.1:${frontPort}`,
        fixturePort,
        internalPort,
        token,
        scope: staticMode ? 'independent web/ static build' : 'independent web/ dev server',
        static: staticMode,
      },
      null,
      2,
    ),
  )
  console.log('Owned loopback-only cshell-web mock preview ready')
} else {
  throw new Error('Usage: node scripts/cshell-web-preview.mjs start|stop|status|serve')
}
