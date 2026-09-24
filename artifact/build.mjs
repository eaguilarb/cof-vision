import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const template = readFileSync(join(here, 'camaras.src.html'), 'utf8')
const leafletCss = readFileSync(join(here, '..', 'node_modules', 'leaflet', 'dist', 'leaflet.css'), 'utf8')
  // Solo se usan marcadores propios: se quitan las referencias a imágenes externas que el sandbox bloquearía.
  .replace(/background-image:\s*url\([^)]*\);?/g, '')
const appJs = readFileSync(join(here, 'app.js'), 'utf8')

const out = template.replace('/*__LEAFLET_CSS__*/', () => leafletCss).replace('/*__APP_JS__*/', () => appJs)
writeFileSync(join(here, 'camaras.html'), out)
console.log(`camaras.html: ${(out.length / 1024).toFixed(1)} KB`)

// Versión para abrir con doble clic (fuera de claude.ai): necesita su propio encabezado.
const standalone = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${out}
</body>
</html>
`
writeFileSync(join(here, 'COF-Vision-Camaras.html'), standalone)
console.log(`COF-Vision-Camaras.html: ${(standalone.length / 1024).toFixed(1)} KB`)
