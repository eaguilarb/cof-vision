// Genera una copia personal de la página con la clave de Gemini incorporada.
// Uso: GEMINI_KEY=tu-clave [CLAUDE_KEY=sk-ant-…] node simple/con-clave.mjs ruta/de/salida.html
// La copia contiene la clave: no la subas al repositorio ni la compartas.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const key = (process.env.GEMINI_KEY || '').trim()
const out = process.argv[2]
if (!key || !out) {
  console.error('Uso: GEMINI_KEY=tu-clave node simple/con-clave.mjs salida.html')
  process.exit(1)
}
const here = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(here, '..', 'server', 'public', 'camara.html'), 'utf8')
if (!html.includes("'__GEMINI_KEY__'")) throw new Error('No se encontró el lugar de la clave')
const claude = (process.env.CLAUDE_KEY || '').trim()
const quote = (k) => JSON.stringify(k).replace(/"/g, "'")
let page = html.replace("'__GEMINI_KEY__'", () => quote(key))
if (claude) page = page.replace("'__CLAUDE_KEY__'", () => quote(claude))
writeFileSync(out, page)
console.log(`Listo: ${out}`)
