import { createServer } from 'node:http'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve, sep, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { renderIsland } from '@ketvietlab/ketjs-view'
import { createFlowWorkspace, routes } from '@ketvietlab/flow-client/workspace.mjs'
import { createOrganizationSession } from './organization-store.mjs'
import { BLANK_OWNER, blankStages } from './blank-organization.mjs'
// Every entry point (including KetAtlas's renderer command) needs these browser bundles.
import './build-vendor.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const ui = dirname(fileURLToPath(import.meta.resolve('@ketvietlab/flow-ui')))
const vendor = fileURLToPath(new URL('./vendor/', import.meta.url))
const view = dirname(fileURLToPath(import.meta.resolve('@ketvietlab/ketjs-view')))
const tokens = fileURLToPath(import.meta.resolve('@ketvietlab/design-system/tokens.css'))
export function startAtlasServer({
  createSession = createOrganizationSession,
  extraImports = {},
  extraStyles = [],
  extraMounts = [],
  entry = '/atlas/entry.mjs',
  entryFile,
} = {}) {
  const args = process.argv.slice(2)
  const port = Number(args[args.indexOf('--port') + 1] || process.env.KETATLAS_HTML_PORT || 4192)
  const previewPort = port + 1
  const sessions = new Map()
  // In-memory upload store for the mock. Ids are random capability URLs; production must authorize every read.
  const uploads = new Map()
  const MAX_UPLOAD = 25 * 1024 * 1024,
    MAX_UPLOADS_TOTAL = 256 * 1024 * 1024
  const inlineTypes = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/avif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/ogg',
  ])
  const storeUpload = (upload) => {
    const id = randomUUID()
    uploads.set(id, upload)
    let total = 0
    for (const u of uploads.values()) total += u.bytes.length
    for (const [key, u] of uploads) {
      if (total <= MAX_UPLOADS_TOTAL) break
      uploads.delete(key)
      total -= u.bytes.length
    }
    return id
  }
  const serveUpload = (req, res, upload, download) => {
    const inline = !download && inlineTypes.has(upload.type)
    const headers = {
      'content-type': inline ? upload.type : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(upload.name)}`,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
      'accept-ranges': 'bytes',
    }
    const size = upload.bytes.length,
      range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start >= size || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${size}` })
        return res.end()
      }
      res.writeHead(206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': end - start + 1,
      })
      return res.end(req.method === 'HEAD' ? undefined : upload.bytes.subarray(start, end + 1))
    }
    res.writeHead(200, { ...headers, 'content-length': size })
    res.end(req.method === 'HEAD' ? undefined : upload.bytes)
  }
  const types = {
    '.mjs': 'text/javascript',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
  }
  const imports = {
    '@ketvietlab/ketsuite/livedoc': '/flow-live-doc.mjs',
    '@ketvietlab/ketjs-view/jsx-runtime': '/_ket/view/jsx-runtime.js',
    '@ketvietlab/ketjs': '/flow-ketjs-i18n.mjs',
    '@ketvietlab/ketjs-view': '/_ket/view/index.js',
    '@ketvietlab/flow-ui': '/flow-ui/index.mjs',
    '@ketvietlab/flow-ui/documents': '/flow-ui/documents.mjs',
    '@ketvietlab/flow-ui/workspace': '/flow-ui/workspace.mjs',
    '@ketvietlab/flow-ui/i18n': '/flow-ui/i18n.mjs',
    '@ketvietlab/flow-ui/runtime': '/flow-ui/runtime.mjs',
    '@ketvietlab/flow-client': '/flow-client/workspace.mjs',
    '@ketvietlab/flow-client/api': '/flow-client/api.mjs',
    '@ketvietlab/flow-client/': '/flow-client/',
    ...extraImports,
  }
  const json = (res, code, value) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }
  const serialize = (x) => JSON.stringify(x).replace(/</g, '\\u003c')
  const handler = async (req, res) => {
    try {
      if (process.env.FLOW_DEBUG) console.log(req.method, req.url)
      const url = new URL(req.url, 'http://127.0.0.1')
      const path = decodeURIComponent(url.pathname)
      if (path === '/flow-live-doc.mjs' || path === '/flow-ketjs-i18n.mjs') {
        const bytes = await readFile(
          resolve(vendor, path === '/flow-live-doc.mjs' ? 'live-doc.mjs' : 'ketjs-i18n.mjs'),
        )
        res.writeHead(200, { 'content-type': 'text/javascript' })
        return res.end(bytes)
      }
      if (path === '/__atlas/ready') return json(res, 200, { ok: true })
      if (path === '/_ket/upload' && req.method === 'POST') {
        const session = req.headers['x-flow-fixture']
        if (!sessions.has(session))
          return json(res, 403, {
            ok: false,
            code: 'fixtureSession',
            message: 'Phiên thử nghiệm đã hết hạn. Tải lại trang.',
          })
        const chunks = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > MAX_UPLOAD)
            return json(res, 413, { ok: false, code: 'tooLarge', message: 'Tệp vượt quá 25 MB.' })
          chunks.push(chunk)
        }
        const type = String(req.headers['content-type'] ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase()
        let name = 'file'
        try {
          name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'file')).slice(0, 255) || 'file'
        } catch {}
        return json(res, 200, {
          ok: true,
          uploadId: storeUpload({
            session,
            name,
            type: /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream',
            bytes: Buffer.concat(chunks),
          }),
        })
      }
      if (path.startsWith('/_ket/files/') && (req.method === 'GET' || req.method === 'HEAD')) {
        const upload = uploads.get(path.slice('/_ket/files/'.length))
        if (!upload) return json(res, 404, { ok: false, message: 'Not found' })
        return serveUpload(req, res, upload, url.searchParams.has('download'))
      }
      if (path.startsWith('/_ket/fn/') && req.method === 'POST') {
        const session = sessions.get(req.headers['x-flow-fixture'])
        if (!session)
          return json(res, 403, {
            ok: false,
            code: 'fixtureSession',
            message: 'Phiên thử nghiệm đã hết hạn. Tải lại trang.',
          })
        session.touched = Date.now()
        let body = ''
        for await (const chunk of req) {
          body += chunk
          if (body.length > 1000000) return json(res, 413, { ok: false, message: 'Dữ liệu quá lớn.' })
        }
        if (session.scenario === 'loading') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.write(' ')
          const timer = setTimeout(
            () => res.end(JSON.stringify(session.call('flow.workspace.bootstrap'))),
            120000,
          )
          res.on('close', () => clearTimeout(timer))
          return
        }
        await new Promise((r) => setTimeout(r, 120))
        const name = path.slice('/_ket/fn/'.length),
          input = JSON.parse(body || '{}')
        // The client never dictates stored bytes: size and type come from the upload itself.
        if (name === 'flow.entity.save' && input.collection === 'files' && Array.isArray(input.files)) {
          for (const file of input.files) {
            if (file?.uploadId == null) continue
            const upload = uploads.get(file.uploadId)
            if (!upload || upload.session !== req.headers['x-flow-fixture'])
              return json(res, 200, {
                ok: true,
                value: {
                  ok: false,
                  errors: [{ code: 'validation', message: 'Tệp tải lên đã hết hạn. Thử lại.' }],
                },
              })
            file.size = upload.bytes.length
            file.type = upload.type
          }
        }
        const result = session.call(name, input)
        if (result.value?.screenBaseURL) result.value.screenBaseURL = `http://127.0.0.1:${previewPort}/flow/`
        return json(res, 200, result)
      }
      if (path.startsWith('/flow/')) {
        const screen = path.slice('/flow/'.length) || 'my-work'
        if (!routes[screen]) return json(res, 404, { ok: false, message: 'Unknown Flow screen' })
        const scenario = url.searchParams.get('state') ?? 'baseline'
        const session = randomUUID()
        sessions.set(session, {
          ...createSession(scenario, screen, { profile: 'realistic' }),
          touched: Date.now(),
        })
        const props = {
          screen,
          companyId: url.searchParams.get('company') ?? 'demo',
          workspaceId: url.searchParams.get('workspace') ?? '',
          record: url.searchParams.get('id') ?? 'KV-142',
          project: url.searchParams.get('project') ?? 'core',
          query: url.searchParams.get('q') ?? '',
          status: url.searchParams.get('status') ?? 'all',
          basePath: '/flow/',
          repository: url.searchParams.get('repository') ?? '',
          branch: url.searchParams.get('branch') ?? '',
          atlasPath: url.searchParams.get('atlas') ?? '',
          // Atlas has no real accounts; the blank organization shows its mock owner credential on the sign-in page.
          signInDemo: blankStages.includes(scenario)
            ? { email: BLANK_OWNER.email, password: BLANK_OWNER.password }
            : null,
        }
        const island = renderIsland('flow.workspace', createFlowWorkspace, props, { tag: 'div' })
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        })
        return res.end(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flow</title><link rel="stylesheet" href="/design-system/tokens.css"><link rel="stylesheet" href="/flow-ui/styles.css">${extraStyles.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}<link rel="stylesheet" href="/flow-client/brand/brand.css"><script type="importmap">${serialize({ imports })}</script></head><body style="margin:0">${island}<script type="application/json" id="flow-environment">${serialize({ session })}</script><script type="module" src="${entry}"></script></body></html>`,
        )
      }
      let file
      if (entryFile && path === entry) file = entryFile
      else if (path === '/design-system/tokens.css') file = tokens
      else {
        const mounts = [
          ['/_ket/view/', view],
          ['/flow-ui/', ui],
          ...extraMounts,
          ['/flow-client/', resolve(root, 'dist')],
          ['/atlas/', resolve(root, 'atlas')],
        ]
        const mount = mounts.find(([prefix]) => path.startsWith(prefix))
        if (!mount) throw new Error('404')
        const [prefix, base, allowed] = mount
        file = resolve(base, path.slice(prefix.length))
        if (!file.startsWith(resolve(base) + sep)) throw new Error('404')
        if (allowed && !allowed.some((p) => path.slice(prefix.length).startsWith(p))) throw new Error('404')
        if (prefix === '/atlas/' && path !== '/atlas/entry.mjs') throw new Error('404')
      }
      const bytes = await readFile(file)
      res.writeHead(200, {
        'content-type': `${types[extname(file)] ?? 'application/octet-stream'}; charset=utf-8`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      res.end(bytes)
    } catch (error) {
      json(res, 404, { ok: false, message: 'Not found' })
    }
  }
  const server = createServer(handler)
  const previewServer = createServer(handler)
  previewServer.listen(previewPort, '127.0.0.1')
  const sweep = setInterval(() => {
    for (const [id, s] of sessions) if (Date.now() - s.touched > 3600000) sessions.delete(id)
  }, 60000)
  sweep.unref()
  server.listen(port, '127.0.0.1', () => console.log(`Flow renderer: http://127.0.0.1:${port}/flow/my-work`))
  for (const sig of ['SIGINT', 'SIGTERM'])
    process.on(sig, () => {
      clearInterval(sweep)
      server.close()
      previewServer.close()
    })

  return { server, previewServer }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  startAtlasServer()
