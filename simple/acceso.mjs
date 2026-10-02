// Genera el acceso directo personal: un archivo pequeño que abre la página publicada y le pasa las claves
// (tras el #, no se envían a ningún servidor; la página las guarda en el navegador y las borra de la dirección).
// Así se usa la página publicada, que corre YOLO con todos los núcleos del procesador.
// Uso: QWEN_KEY=sk-… node simple/acceso.mjs salida.html  (la IA de la página es Qwen, de Alibaba Cloud)
// El archivo contiene las claves: no lo subas al repositorio ni lo compartas.
import { writeFileSync } from 'node:fs'

const q = (process.env.QWEN_KEY || '').trim()
const out = process.argv[2]
if (!q || !out) {
  console.error('Uso: QWEN_KEY=sk-… node simple/acceso.mjs salida.html')
  process.exit(1)
}
const url = 'https://eaguilarb.github.io/cof-vision/camara.html#qk=' + encodeURIComponent(q)
writeFileSync(out, `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>COF Vision</title></head>
<body style="font:16px system-ui,sans-serif;padding:24px">
<p>Abriendo COF Vision… Si no se abre solo, <a id="go" href="#">haz clic aquí</a>.</p>
<script>var u = ${JSON.stringify(url)}; document.getElementById('go').href = u; location.replace(u);</script>
</body></html>
`)
console.log(`Listo: ${out}`)
