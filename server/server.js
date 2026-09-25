// Servidor de COF Vision para Railway: pide usuario y contraseña, entrega la página y
// reenvía las consultas a Gemini agregando la clave, que nunca llega al navegador.
//
// Variables de entorno:
//   GEMINI_API_KEY   clave de Gemini (aistudio.google.com/apikey)
//   APP_USER         usuario para entrar
//   APP_PASSWORD     contraseña para entrar
//   APP_USERS        (opcional) más usuarios: "ana:clave1,pedro:clave2"
//   SESSION_SECRET   (opcional) secreto para firmar la sesión; si falta se deriva de lo anterior
//   PORT             lo define Railway
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000
const KEY = (process.env.GEMINI_API_KEY || '').trim()
const USERS = new Map()
if (process.env.APP_USER && process.env.APP_PASSWORD) USERS.set(process.env.APP_USER.trim(), process.env.APP_PASSWORD)
for (const pair of (process.env.APP_USERS || '').split(',')) {
  const i = pair.indexOf(':')
  if (i > 0) USERS.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
}
const SECRET = process.env.SESSION_SECRET || createHash('sha256').update(`cof|${KEY}|${[...USERS].flat().join('|')}`).digest('hex')
const SESSION_DAYS = 30
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models'
const MAX_BODY = 40 * 1024 * 1024

if (!KEY) console.warn('Falta GEMINI_API_KEY: la página cargará pero no podrá analizar.')
if (!USERS.size) console.warn('Faltan APP_USER y APP_PASSWORD: nadie podrá entrar.')

// La página se lee al arrancar; se le avisa que la clave la pone el servidor.
const page = readFileSync(join(here, 'public', 'camara.html'), 'utf8').replace('<script>\n(() => {', '<script>window.COF_SERVER = true;</script>\n<script>\n(() => {')

// ---------------------------------------------------------------- sesión
const sign = (v) => createHmac('sha256', SECRET).update(v).digest('base64url')
const same = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}
function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({ u: user, e: Date.now() + SESSION_DAYS * 86400e3 })).toString('base64url')
  return `${payload}.${sign(payload)}`
}
function readToken(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)cof_s=([^;]+)/)
  if (!m) return null
  const [payload, mac] = m[1].split('.')
  if (!payload || !mac || !same(mac, sign(payload))) return null
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString())
    // Si se quita a un usuario de la lista, su sesión deja de valer.
    return d.e > Date.now() && USERS.has(d.u) ? d.u : null
  } catch {
    return null
  }
}
const secure = (req) => (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
const cookie = (req, value, maxAge) => `cof_s=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`

// Freno a quien prueba contraseñas: 10 intentos fallidos cada 15 minutos por IP.
const tries = new Map()
const ipOf = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
function blocked(ip) {
  const t = tries.get(ip)
  if (!t || t.until < Date.now()) return false
  return t.n >= 10
}
function failed(ip) {
  const t = tries.get(ip)
  if (!t || t.until < Date.now()) tries.set(ip, { n: 1, until: Date.now() + 15 * 60e3 })
  else t.n++
}

// ---------------------------------------------------------------- respuestas
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
}
function send(res, status, body, type, extra) {
  res.writeHead(status, { ...HEADERS, 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...(extra || {}) })
  res.end(body)
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
function loginPage(msg) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#10181f">
<title>COF Vision · Entrar</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #10181f; font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #14202b; padding: 16px; box-sizing: border-box; }
  form { background: #fff; border-radius: 14px; padding: 28px 24px; width: 100%; max-width: 360px; box-sizing: border-box; display: grid; gap: 12px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  p { margin: 0 0 8px; color: #5d6b78; font-size: 14px; }
  label { font-size: 14px; font-weight: 600; display: grid; gap: 4px; }
  input { font: inherit; padding: 10px 12px; border: 1px solid #d9e0e6; border-radius: 8px; }
  button { font: inherit; font-weight: 700; border: 0; border-radius: 8px; padding: 11px; background: #f5a300; color: #1a1200; cursor: pointer; margin-top: 4px; }
  .err { color: #d63b2f; background: #fdecea; border-radius: 8px; padding: 8px 10px; font-size: 14px; }
</style>
</head>
<body>
<form method="post" action="login">
  <h1>COF Vision</h1>
  <p>Revisión de cámaras de flota</p>
  ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
  <label>Usuario<input name="usuario" autocomplete="username" autocapitalize="none" required autofocus></label>
  <label>Contraseña<input name="clave" type="password" autocomplete="current-password" required></label>
  <button type="submit">Entrar</button>
</form>
</body>
</html>`
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(Object.assign(new Error('demasiado grande'), { status: 413 }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------- rutas
async function handle(req, res) {
  const url = new URL(req.url, 'http://x')
  const path = url.pathname

  if (path === '/salud') return send(res, 200, 'ok')

  if (path === '/login' && req.method === 'GET') {
    if (readToken(req)) return send(res, 302, '', null, { Location: './' })
    return send(res, 200, loginPage(), 'text/html; charset=utf-8')
  }
  if (path === '/login' && req.method === 'POST') {
    const ip = ipOf(req)
    if (blocked(ip)) return send(res, 429, loginPage('Demasiados intentos. Espera 15 minutos.'), 'text/html; charset=utf-8')
    const form = new URLSearchParams((await readBody(req, 10_000)).toString())
    const user = (form.get('usuario') || '').trim()
    const pass = form.get('clave') || ''
    if (USERS.has(user) && same(pass, USERS.get(user))) {
      tries.delete(ip)
      return send(res, 302, '', null, { Location: './', 'Set-Cookie': cookie(req, makeToken(user), SESSION_DAYS * 86400) })
    }
    failed(ip)
    return send(res, 401, loginPage('Usuario o contraseña incorrectos.'), 'text/html; charset=utf-8')
  }
  if (path === '/salir') return send(res, 302, '', null, { Location: 'login', 'Set-Cookie': cookie(req, '', 0) })

  const user = readToken(req)

  // Consultas a Gemini: el servidor agrega la clave.
  const m = path.match(/^\/api\/gemini\/models\/([a-z0-9.-]{3,60}):generateContent$/)
  if (m && req.method === 'POST') {
    if (!user) return send(res, 401, JSON.stringify({ error: { message: 'Tu sesión terminó. Vuelve a entrar.' } }), 'application/json')
    if (!KEY) return send(res, 403, JSON.stringify({ error: { message: 'Falta configurar GEMINI_API_KEY en Railway.' } }), 'application/json')
    const body = await readBody(req, MAX_BODY)
    let r
    try {
      r = await fetch(`${GEMINI}/${m[1]}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, body })
    } catch (e) {
      return send(res, 502, JSON.stringify({ error: { message: `No se pudo conectar con Google: ${e.message}` } }), 'application/json')
    }
    const text = await r.text()
    const extra = r.headers.get('retry-after') ? { 'Retry-After': r.headers.get('retry-after') } : {}
    return send(res, r.status, text, 'application/json', extra)
  }

  if (path === '/' || path === '/index.html' || path === '/camara.html') {
    if (!user) return send(res, 302, '', null, { Location: 'login' })
    return send(res, 200, page, 'text/html; charset=utf-8')
  }
  return send(res, 404, 'No encontrado')
}

createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!res.headersSent) send(res, e.status || 500, e.status ? e.message : 'Error interno')
    else res.end()
    if (!e.status) console.error(e)
  })
}).listen(PORT, () => console.log(`COF Vision escuchando en el puerto ${PORT} · ${USERS.size} usuario(s) · clave de Gemini ${KEY ? 'configurada' : 'FALTANTE'}`))
