// Genera el acceso directo personal: un archivo pequeño que abre la página publicada y le pasa las claves
// (tras el #, no se envían a ningún servidor; la página las guarda en el navegador y las borra de la dirección).
// Así se usa la página publicada, que corre YOLO con todos los núcleos del procesador.
// Uso: GEMINI_KEY=… [CLAUDE_KEY=sk-ant-…] node simple/acceso.mjs salida.html
// El archivo contiene las claves: no lo subas al repositorio ni lo compartas.
import { writeFileSync } from 'node:fs'

const g = (process.env.GEMINI_KEY || '').trim()
const c = (process.env.CLAUDE_KEY || '').trim()
const out = process.argv[2]
if ((!g && !c) || !out) {
  console.error('Uso: GEMINI_KEY=… [CLAUDE_KEY=…] node simple/acceso.mjs salida.html')
  process.exit(1)
}
const url = 'https://eaguilarb.github.io/cof-vision/camara.html#' + [g && `k=${encodeURIComponent(g)}`, c && `ck=${encodeURIComponent(c)}`].filter(Boolean).join('&')
writeFileSync(out, `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>COF Vision</title></head>
<body style="font:16px system-ui,sans-serif;padding:24px">
<p>Abriendo COF Vision… Si no se abre solo, <a id="go" href="#">haz clic aquí</a>.</p>
<script>var u = ${JSON.stringify(url)}; document.getElementById('go').href = u; location.replace(u);</script>
</body></html>
`)
console.log(`Listo: ${out}`)
