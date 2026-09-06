import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbShape } from './types.js';

/**
 * Almacén simple respaldado por un archivo JSON. Sirve como backend "mock"
 * mientras se conecta esta API a la base de datos/API real de la intranet:
 * basta con reemplazar las funciones de este archivo (load/save) por
 * llamadas al sistema real sin tocar las rutas ni el resto de la app.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DATA_FILE = join(DATA_DIR, 'db.json');

const empty: DbShape = {
  users: [],
  technicians: [],
  equipment: [],
  cases: [],
  caseSequence: 0,
};

function ensureFile() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) writeFileSync(DATA_FILE, JSON.stringify(empty, null, 2));
}

export function loadDb(): DbShape {
  ensureFile();
  const raw = readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw) as DbShape;
}

export function saveDb(db: DbShape): void {
  ensureFile();
  writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
