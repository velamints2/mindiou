import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, request as upstreamRequest } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('./public/', import.meta.url)))
const port = Number(process.env.PORT || 8080)
const apiOrigin = new URL(process.env.MINDIOU_API_ORIGIN || 'http://127.0.0.1:8793')

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

function proxyPath(pathname) {
  if (pathname === '/health' || pathname.startsWith('/api/')) return pathname
  if (pathname === '/mindiou-api' || pathname === '/mindiou-api/') return '/'
  if (pathname.startsWith('/mindiou-api/')) return pathname.slice('/mindiou-api'.length)
  return null
}

function proxy(req, res, targetPath) {
  const headers = { ...req.headers, host: apiOrigin.host }
  const upstream = upstreamRequest({
    protocol: apiOrigin.protocol,
    hostname: apiOrigin.hostname,
    port: apiOrigin.port || (apiOrigin.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: targetPath,
    headers
  }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
    upstreamRes.pipe(res)
  })

  upstream.on('error', error => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    }
    res.end(JSON.stringify({
      ok: false,
      error: `MindIOU 后端不可达：${error.message}`
    }))
  })
  req.pipe(upstream)
}

function staticPath(pathname) {
  const decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
  const candidate = normalize(join(root, decoded))
  return candidate.startsWith(root) ? candidate : null
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const targetPath = proxyPath(url.pathname)
  if (targetPath !== null) {
    proxy(req, res, `${targetPath}${url.search}`)
    return
  }

  const candidate = staticPath(url.pathname)
  const file = candidate && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : join(root, 'index.html')
  const type = mimeTypes[extname(file)] || 'application/octet-stream'
  res.writeHead(200, {
    'content-type': type,
    'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
  })
  createReadStream(file).pipe(res)
})

server.listen(port, '0.0.0.0', () => {
  console.log(`MindIOU Web: http://localhost:${port}`)
  console.log(`MindIOU API: ${apiOrigin.origin}`)
})
