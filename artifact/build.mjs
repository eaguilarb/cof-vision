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
