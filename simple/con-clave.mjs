// Genera una copia personal de la página con la clave de Gemini incorporada.
// Uso: GEMINI_KEY=tu-clave node simple/con-clave.mjs ruta/de/salida.html
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
const html = readFileSync(join(here, 'cof-vision-simple.html'), 'utf8')
if (!html.includes("'__GEMINI_KEY__'")) throw new Error('No se encontró el lugar de la clave')
writeFileSync(out, html.replace("'__GEMINI_KEY__'", () => JSON.stringify(key).replace(/"/g, "'")))
console.log(`Listo: ${out}`)
