import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbShape } from './types.js';

/**
 * Almacén simple respaldado por un archivo JSON: cuentas del CRM
 * (admin/técnicos) y, en modo intranet, el "overlay" local (técnico
 * asignado, prioridad, notas) — ver intranet.ts. En modo local/demo
 * también guarda equipos/casos de ejemplo.
 *
 * DATA_DIR debe apuntar a un volumen persistente en producción (en
 * Railway: monta un volumen y define DATA_DIR con su mount path) — sin
 * eso, cada redeploy borra las cuentas y las asignaciones.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
const DATA_FILE = join(DATA_DIR, 'db.json');
const UPLOADS_DIR = join(DATA_DIR, 'uploads');

export function getUploadsDir(): string {
  if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
  return UPLOADS_DIR;
}

const empty: DbShape = {
  users: [],
  technicians: [],
  equipment: [],
  cases: [],
  caseSequence: 0,
  caseOverlays: {},
};

function ensureFile() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) writeFileSync(DATA_FILE, JSON.stringify(empty, null, 2));
}

export function loadDb(): DbShape {
  ensureFile();
  const raw = readFileSync(DATA_FILE, 'utf-8');
  const db = JSON.parse(raw) as DbShape;
  db.caseOverlays = db.caseOverlays || {};
  for (const overlay of Object.values(db.caseOverlays)) {
    overlay.photos = overlay.photos || [];
  }
  for (const c of db.cases) {
    c.photos = c.photos || [];
  }
  return db;
}

export function saveDb(db: DbShape): void {
  ensureFile();
  writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
