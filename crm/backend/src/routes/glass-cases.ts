import { Router } from 'express';
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { getUploadsDir, loadDb, saveDb } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { withLocalAge } from '../services/case-service.js';
import { allowedTerminalsFor, requireModuleAccess } from '../services/terminal-access.js';
import { GLASS_RESOLUTION_ACTIONS } from '../glass.js';
import { fetchFlota, isIntranetEnabled } from '../intranet.js';
import type { Case, CasePhoto, CasePriority, CaseStatus } from '../types.js';

/**
 * Casos del módulo "Vidrios" — mismo modelo de datos que /cases, pero
 * siempre guardados localmente (la intranet real no tiene un módulo de
 * vidrios) y validados contra la flota real al crearse (ver isValidPpu).
 */
export const glassCasesRouter = Router();

glassCasesRouter.use(requireAuth);
glassCasesRouter.use(requireModuleAccess('glass'));

const VALID_STATUSES: CaseStatus[] = ['open', 'assigned', 'in_progress', 'resolved'];
const VALID_PRIORITIES: CasePriority[] = ['low', 'medium', 'high', 'urgent'];
const GLASS_RESOLUTION_VALUES = GLASS_RESOLUTION_ACTIONS.map((a) => a.value);

function applyFilters(
  cases: Case[],
  query: { status?: string; technicianId?: string; mine?: string },
  auth?: { technicianId?: string },
  allowedTerminals?: string[] | null,
): Case[] {
  let result = cases;
  if (allowedTerminals) {
    result = result.filter((c) => allowedTerminals.includes(c.clientName));
  }
  if (query.mine === 'true' && auth?.technicianId) {
    result = result.filter((c) => c.assignedTechnicianId === auth.technicianId);
  } else if (query.technicianId) {
    result = result.filter((c) => c.assignedTechnicianId === query.technicianId);
  }
  if (query.status) {
    result = result.filter((c) => c.status === query.status);
  }
  return result;
}

function photoPath(caseId: string, photo: CasePhoto): string {
  return join(getUploadsDir(), `glass-${caseId}`, photo.filename);
}

function mkdirSyncFor(caseId: string) {
  const dir = join(getUploadsDir(), `glass-${caseId}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

glassCasesRouter.get('/', (req, res) => {
  const query = req.query as { status?: string; technicianId?: string; mine?: string };
  const db = loadDb();
  const allowedTerminals = allowedTerminalsFor(db, req.auth);
  let cases = applyFilters(db.glassCases, query, req.auth, allowedTerminals);
  cases = [...cases].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(cases.map(withLocalAge));
});

glassCasesRouter.get('/:id', (req, res) => {
  const db = loadDb();
  const found = db.glassCases.find((c) => c.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }
  const allowedTerminals = allowedTerminalsFor(db, req.auth);
  if (allowedTerminals && !allowedTerminals.includes(found.clientName)) {
    res.status(403).json({ error: 'No tienes acceso a ese terminal' });
    return;
  }
  res.json(withLocalAge(found));
});

glassCasesRouter.post('/', async (req, res) => {
  const { description, equipmentId, priority, assignedTechnicianId, categoria, clientName } = req.body as Partial<{
    description: string;
    equipmentId: string;
    priority: string;
    assignedTechnicianId: string | null;
    categoria: string;
    clientName: string;
  }>;

  if (!description || !equipmentId || !categoria) {
    res.status(400).json({ error: 'categoria, description y equipmentId (patente) son requeridos' });
    return;
  }

  const db = loadDb();
  const allowedTerminals = allowedTerminalsFor(db, req.auth);

  let terminal = clientName || '—';
  if (isIntranetEnabled()) {
    try {
      const flota = await fetchFlota();
      const bus = flota.find((b) => b.ppu === equipmentId);
      if (!bus) {
        res.status(400).json({ error: `La patente ${equipmentId} no existe en la flota` });
        return;
      }
      terminal = bus.terminal || terminal;
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Error al conectar con la intranet' });
      return;
    }
  }

  if (allowedTerminals && !allowedTerminals.includes(terminal)) {
    res.status(403).json({ error: 'No puedes crear casos fuera de tu terminal asignado' });
    return;
  }

  const resolvedPriority: CasePriority = VALID_PRIORITIES.includes(priority as CasePriority)
    ? (priority as CasePriority)
    : 'medium';

  db.glassCaseSequence += 1;
  const now = new Date().toISOString();
  const status: CaseStatus = assignedTechnicianId ? 'assigned' : 'open';

  const newCase: Case = {
    id: uuid(),
    code: `VID-${String(db.glassCaseSequence).padStart(4, '0')}`,
    title: `${categoria} · ${equipmentId}`,
    description,
    equipmentId,
    clientName: terminal,
    priority: resolvedPriority,
    status,
    assignedTechnicianId: assignedTechnicianId ?? null,
    createdBy: req.auth!.sub,
    createdAt: now,
    updatedAt: now,
    notes: [],
    history: [{ id: uuid(), status, changedBy: req.auth!.name, changedAt: now }],
    photos: [],
    categoria,
    resolutionAction: null,
    resolutionNotes: null,
  };

  db.glassCases.push(newCase);
  saveDb(db);
  res.status(201).json(withLocalAge(newCase));
});

glassCasesRouter.delete('/:id', requireRole('admin'), (req, res) => {
  const db = loadDb();
  const caseId = req.params.id;
  const found = db.glassCases.find((c) => c.id === caseId);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }
  db.glassCases = db.glassCases.filter((c) => c.id !== caseId);
  saveDb(db);
  const uploadsDir = join(getUploadsDir(), `glass-${caseId}`);
  if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true, force: true });
  res.status(204).end();
});

glassCasesRouter.patch('/:id/assign', requireRole('admin'), (req, res) => {
  const { technicianId } = req.body as { technicianId?: string | null };
  const db = loadDb();

  if (technicianId && !db.technicians.some((t) => t.id === technicianId)) {
    res.status(400).json({ error: 'Técnico no encontrado' });
    return;
  }

  const found = db.glassCases.find((c) => c.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }

  found.assignedTechnicianId = technicianId ?? null;
  found.updatedAt = new Date().toISOString();
  if (technicianId && found.status === 'open') {
    found.status = 'assigned';
    found.history.push({ id: uuid(), status: 'assigned', changedBy: req.auth!.name, changedAt: found.updatedAt });
  }
  saveDb(db);
  res.json(withLocalAge(found));
});

glassCasesRouter.patch('/:id/status', (req, res) => {
  const { status, resolutionAction, resolutionNotes } = req.body as {
    status?: CaseStatus;
    resolutionAction?: string;
    resolutionNotes?: string;
  };
  if (!status || !VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: `status debe ser uno de: ${VALID_STATUSES.join(', ')}` });
    return;
  }

  const db = loadDb();
  const found = db.glassCases.find((c) => c.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }

  const isOwnerTechnician =
    req.auth?.role === 'technician' && req.auth.technicianId === found.assignedTechnicianId;
  const canChangeStatus = req.auth?.role === 'admin' || req.auth?.role === 'operator' || isOwnerTechnician;
  if (!canChangeStatus) {
    res.status(403).json({ error: 'Solo el técnico asignado, un admin o un operador pueden cambiar el estado' });
    return;
  }

  if (status === 'resolved') {
    if (!resolutionAction || !GLASS_RESOLUTION_VALUES.includes(resolutionAction)) {
      res.status(400).json({ error: 'Debes indicar qué se hizo para resolver el caso (resolutionAction)' });
      return;
    }
    found.resolutionAction = resolutionAction;
    found.resolutionNotes = resolutionNotes || null;
  }

  found.status = status;
  found.updatedAt = new Date().toISOString();
  found.history.push({ id: uuid(), status, changedBy: req.auth!.name, changedAt: found.updatedAt });
  saveDb(db);
  res.json(withLocalAge(found));
});

glassCasesRouter.patch('/:id/priority', (req, res) => {
  const { priority } = req.body as { priority?: CasePriority };
  if (!priority || !VALID_PRIORITIES.includes(priority)) {
    res.status(400).json({ error: `priority debe ser una de: ${VALID_PRIORITIES.join(', ')}` });
    return;
  }

  const db = loadDb();
  const found = db.glassCases.find((c) => c.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }
  found.priority = priority;
  found.updatedAt = new Date().toISOString();
  saveDb(db);
  res.json(withLocalAge(found));
});

glassCasesRouter.post('/:id/notes', (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text) {
    res.status(400).json({ error: 'text es requerido' });
    return;
  }

  const db = loadDb();
  const found = db.glassCases.find((c) => c.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }
  const now = new Date().toISOString();
  const note = { id: uuid(), authorId: req.auth!.sub, authorName: req.auth!.name, text, createdAt: now };
  found.notes.push(note);
  found.updatedAt = now;
  saveDb(db);
  res.status(201).json(note);
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Solo se permiten imágenes'));
      return;
    }
    cb(null, true);
  },
});

glassCasesRouter.post('/:id/photos', upload.single('photo'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Falta el archivo "photo"' });
    return;
  }
  const db = loadDb();
  const caseId = req.params.id;
  const found = db.glassCases.find((c) => c.id === caseId);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }
  const photo: CasePhoto = {
    id: uuid(),
    filename: `${uuid()}${extname(req.file.originalname) || '.jpg'}`,
    mimeType: req.file.mimetype,
    uploadedBy: req.auth!.name,
    uploadedAt: new Date().toISOString(),
  };
  mkdirSyncFor(caseId);
  writeFileSync(photoPath(caseId, photo), req.file.buffer);
  found.photos.push(photo);
  found.updatedAt = photo.uploadedAt;
  saveDb(db);
  res.status(201).json(photo);
});

glassCasesRouter.get('/:id/photos/:photoId', (req, res) => {
  const db = loadDb();
  const found = db.glassCases.find((c) => c.id === req.params.id);
  const photo = found?.photos.find((p) => p.id === req.params.photoId);
  if (!photo) {
    res.status(404).json({ error: 'Foto no encontrada' });
    return;
  }
  const filePath = photoPath(req.params.id, photo);
  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'Foto no encontrada' });
    return;
  }
  res.setHeader('Content-Type', photo.mimeType);
  res.sendFile(filePath);
});

glassCasesRouter.delete('/:id/photos/:photoId', (req, res) => {
  const db = loadDb();
  const caseId = req.params.id;
  const found = db.glassCases.find((c) => c.id === caseId);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }
  const photo = found.photos.find((p) => p.id === req.params.photoId);
  if (!photo) {
    res.status(404).json({ error: 'Foto no encontrada' });
    return;
  }
  const filePath = photoPath(caseId, photo);
  if (existsSync(filePath)) unlinkSync(filePath);
  found.photos = found.photos.filter((p) => p.id !== photo.id);
  saveDb(db);
  res.status(204).end();
});
