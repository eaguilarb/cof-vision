import { Router } from 'express';
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { getUploadsDir, loadDb, saveDb } from '../db.js';
import { notifyIntranetCaso, notifyLocalCase } from '../notifications.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getOverlay, toCase, withLocalAge } from '../services/case-service.js';
import type { Case, CasePhoto, CasePriority, CaseStatus, CaseWithAge } from '../types.js';
import {
  GENERIC_RESOLUTION_ACTIONS,
  RESOLUTION_ACTIONS_BY_CATEGORIA,
  STATUS_TO_ESTADO,
  createCaso,
  deleteCaso,
  fetchCasos,
  isIntranetEnabled,
  isValidPpu,
  updateEstadoCaso,
} from '../intranet.js';

function validResolutionActionValues(categoria: string | null): string[] {
  const list = (categoria && RESOLUTION_ACTIONS_BY_CATEGORIA[categoria]) || GENERIC_RESOLUTION_ACTIONS;
  return list.map((a) => a.value);
}

export const casesRouter = Router();

casesRouter.use(requireAuth);

const VALID_STATUSES: CaseStatus[] = ['open', 'assigned', 'in_progress', 'resolved'];
const VALID_PRIORITIES: CasePriority[] = ['low', 'medium', 'high', 'urgent'];

function applyFilters<T extends Case>(
  cases: T[],
  query: { status?: string; technicianId?: string; mine?: string },
  auth?: { technicianId?: string },
): T[] {
  let result = cases;
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

// GET /cases?status=&technicianId=&mine=true
casesRouter.get('/', async (req, res) => {
  const query = req.query as { status?: string; technicianId?: string; mine?: string };

  if (isIntranetEnabled()) {
    try {
      const db = loadDb();
      const casos = await fetchCasos();
      let cases = casos.map((c) => toCase(c, db));
      cases = applyFilters(cases, query, req.auth);
      cases.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json(cases);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Error al conectar con la intranet' });
    }
    return;
  }

  const db = loadDb();
  let cases = applyFilters(db.cases, query, req.auth);
  cases = [...cases].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(cases.map(withLocalAge));
});

casesRouter.get('/:id', async (req, res) => {
  if (isIntranetEnabled()) {
    try {
      const db = loadDb();
      const casos = await fetchCasos();
      const raw = casos.find((c) => String(c.id) === req.params.id);
      if (!raw) {
        res.status(404).json({ error: 'Caso no encontrado' });
        return;
      }
      res.json(toCase(raw, db));
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Error al conectar con la intranet' });
    }
    return;
  }

  const db = loadDb();
  const found = db.cases.find((c) => c.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }
  res.json(withLocalAge(found));
});

casesRouter.post('/', async (req, res) => {
  const { description, equipmentId, priority, assignedTechnicianId } = req.body as Partial<{
    description: string;
    equipmentId: string;
    priority: string;
    assignedTechnicianId: string | null;
  }>;

  const resolvedPriority: CasePriority = VALID_PRIORITIES.includes(priority as CasePriority)
    ? (priority as CasePriority)
    : 'medium';

  if (isIntranetEnabled()) {
    const { categoria } = req.body as { categoria?: string };
    if (!categoria || !description || !equipmentId) {
      res.status(400).json({ error: 'categoria, description y equipmentId (patente) son requeridos' });
      return;
    }
    try {
      if (!(await isValidPpu(equipmentId))) {
        res.status(400).json({ error: `La patente ${equipmentId} no existe en la flota` });
        return;
      }
      const created = await createCaso({ ppu: equipmentId, categoria, descripcion: description });
      const db = loadDb();
      const now = new Date().toISOString();
      const status: CaseStatus = assignedTechnicianId ? 'assigned' : 'open';
      db.caseOverlays[String(created.id)] = {
        assignedTechnicianId: assignedTechnicianId ?? null,
        priority: resolvedPriority,
        notes: [],
        history: [{ id: uuid(), status, changedBy: req.auth!.name, changedAt: now }],
        photos: [],
        resolutionAction: null,
        resolutionNotes: null,
      };
      if (assignedTechnicianId) {
        await updateEstadoCaso(String(created.id), STATUS_TO_ESTADO.assigned);
        created.estado_caso = STATUS_TO_ESTADO.assigned;
      }
      await notifyIntranetCaso(created, db.caseOverlays[String(created.id)], db, { save: false });
      saveDb(db);
      res.status(201).json(toCase(created, db));
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Error al conectar con la intranet' });
    }
    return;
  }

  const { title, clientName } = req.body as Partial<{ title: string; clientName: string }>;
  if (!title || !description || !equipmentId || !clientName) {
    res.status(400).json({ error: 'title, description, equipmentId y clientName son requeridos' });
    return;
  }

  const db = loadDb();
  const equipment = db.equipment.find((e) => e.id === equipmentId);
  if (!equipment) {
    res.status(400).json({ error: 'El equipo indicado no existe' });
    return;
  }

  db.caseSequence += 1;
  const now = new Date().toISOString();
  const status: CaseStatus = assignedTechnicianId ? 'assigned' : 'open';

  const newCase: Case = {
    id: uuid(),
    code: `CASE-${String(db.caseSequence).padStart(4, '0')}`,
    title,
    description,
    equipmentId,
    clientName,
    priority: resolvedPriority,
    status,
    assignedTechnicianId: assignedTechnicianId ?? null,
    createdBy: req.auth!.sub,
    createdAt: now,
    updatedAt: now,
    notes: [],
    history: [{ id: uuid(), status, changedBy: req.auth!.name, changedAt: now }],
    photos: [],
    categoria: null,
    resolutionAction: null,
    resolutionNotes: null,
  };

  db.cases.push(newCase);
  await notifyLocalCase(newCase, db, { save: false });
  saveDb(db);
  res.status(201).json(withLocalAge(newCase));
});

// Elimina un caso definitivamente (de la intranet real si está conectada,
// o del almacén local). Solo admin — es irreversible.
casesRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  const caseId = req.params.id;
  const db = loadDb();

  if (isIntranetEnabled()) {
    try {
      await deleteCaso(caseId);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Error al conectar con la intranet' });
      return;
    }
    delete db.caseOverlays[caseId];
    delete db.notifyState.lastStatusByCaseId[caseId];
    saveDb(db);
    const uploadsDir = join(getUploadsDir(), caseId);
    if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true, force: true });
    res.status(204).end();
    return;
  }

  const found = db.cases.find((c) => c.id === caseId);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }
  db.cases = db.cases.filter((c) => c.id !== caseId);
  delete db.notifyState.lastStatusByCaseId[caseId];
  saveDb(db);
  const uploadsDir = join(getUploadsDir(), caseId);
  if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true, force: true });
  res.status(204).end();
});

casesRouter.patch('/:id/assign', requireRole('admin'), async (req, res) => {
  const { technicianId } = req.body as { technicianId?: string | null };
  const db = loadDb();

  if (technicianId && !db.technicians.some((t) => t.id === technicianId)) {
    res.status(400).json({ error: 'Técnico no encontrado' });
    return;
  }

  if (isIntranetEnabled()) {
    try {
      const casos = await fetchCasos();
      const raw = casos.find((c) => String(c.id) === req.params.id);
      if (!raw) {
        res.status(404).json({ error: 'Caso no encontrado' });
        return;
      }
      const overlay = { ...getOverlay(db, req.params.id) };
      overlay.assignedTechnicianId = technicianId ?? null;
      const now = new Date().toISOString();
      if (technicianId && raw.estado_caso === 'pendiente') {
        await updateEstadoCaso(req.params.id, STATUS_TO_ESTADO.assigned);
        raw.estado_caso = STATUS_TO_ESTADO.assigned;
        overlay.history = [
          ...overlay.history,
          { id: uuid(), status: 'assigned', changedBy: req.auth!.name, changedAt: now },
        ];
      }
      db.caseOverlays[req.params.id] = overlay;
      saveDb(db);
      res.json(toCase(raw, db));
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Error al conectar con la intranet' });
    }
    return;
  }

  const found = db.cases.find((c) => c.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }

  found.assignedTechnicianId = technicianId ?? null;
  found.updatedAt = new Date().toISOString();
  if (technicianId && found.status === 'open') {
    found.status = 'assigned';
    found.history.push({
      id: uuid(),
      status: 'assigned',
      changedBy: req.auth!.name,
      changedAt: found.updatedAt,
    });
  }
  saveDb(db);
  res.json(withLocalAge(found));
});

casesRouter.patch('/:id/status', async (req, res) => {
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

  if (isIntranetEnabled()) {
    try {
      const casos = await fetchCasos();
      const raw = casos.find((c) => String(c.id) === req.params.id);
      if (!raw) {
        res.status(404).json({ error: 'Caso no encontrado' });
        return;
      }
      const overlay = getOverlay(db, req.params.id);
      const isOwnerTechnician =
        req.auth?.role === 'technician' && req.auth.technicianId === overlay.assignedTechnicianId;
      const canChangeStatus = req.auth?.role === 'admin' || req.auth?.role === 'operator' || isOwnerTechnician;
      if (!canChangeStatus) {
        res.status(403).json({ error: 'Solo el técnico asignado, un admin o un operador pueden cambiar el estado' });
        return;
      }

      if (status === 'resolved') {
        const valid = validResolutionActionValues(raw.categoria);
        if (!resolutionAction || !valid.includes(resolutionAction)) {
          res.status(400).json({ error: 'Debes indicar qué se hizo para resolver el caso (resolutionAction)' });
          return;
        }
      }

      await updateEstadoCaso(req.params.id, STATUS_TO_ESTADO[status]);
      raw.estado_caso = STATUS_TO_ESTADO[status];
      const now = new Date().toISOString();
      db.caseOverlays[req.params.id] = {
        ...overlay,
        history: [...overlay.history, { id: uuid(), status, changedBy: req.auth!.name, changedAt: now }],
        ...(status === 'resolved'
          ? { resolutionAction: resolutionAction!, resolutionNotes: resolutionNotes || null }
          : {}),
      };
      await notifyIntranetCaso(raw, db.caseOverlays[req.params.id], db, { save: false });
      saveDb(db);
      res.json(toCase(raw, db));
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Error al conectar con la intranet' });
    }
    return;
  }

  const found = db.cases.find((c) => c.id === req.params.id);
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
    const valid = validResolutionActionValues(found.categoria);
    if (!resolutionAction || !valid.includes(resolutionAction)) {
      res.status(400).json({ error: 'Debes indicar qué se hizo para resolver el caso (resolutionAction)' });
      return;
    }
    found.resolutionAction = resolutionAction;
    found.resolutionNotes = resolutionNotes || null;
  }

  found.status = status;
  found.updatedAt = new Date().toISOString();
  found.history.push({ id: uuid(), status, changedBy: req.auth!.name, changedAt: found.updatedAt });
  await notifyLocalCase(found, db, { save: false });
  saveDb(db);
  res.json(withLocalAge(found));
});

casesRouter.patch('/:id/priority', async (req, res) => {
  const { priority } = req.body as { priority?: CasePriority };
  if (!priority || !VALID_PRIORITIES.includes(priority)) {
    res.status(400).json({ error: `priority debe ser una de: ${VALID_PRIORITIES.join(', ')}` });
    return;
  }

  const db = loadDb();

  if (isIntranetEnabled()) {
    try {
      const casos = await fetchCasos();
      const raw = casos.find((c) => String(c.id) === req.params.id);
      if (!raw) {
        res.status(404).json({ error: 'Caso no encontrado' });
        return;
      }
      db.caseOverlays[req.params.id] = { ...getOverlay(db, req.params.id), priority };
      saveDb(db);
      res.json(toCase(raw, db));
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Error al conectar con la intranet' });
    }
    return;
  }

  const found = db.cases.find((c) => c.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }
  found.priority = priority;
  found.updatedAt = new Date().toISOString();
  saveDb(db);
  res.json(withLocalAge(found));
});

casesRouter.post('/:id/notes', async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text) {
    res.status(400).json({ error: 'text es requerido' });
    return;
  }

  const db = loadDb();
  const now = new Date().toISOString();
  const note = { id: uuid(), authorId: req.auth!.sub, authorName: req.auth!.name, text, createdAt: now };

  if (isIntranetEnabled()) {
    try {
      const casos = await fetchCasos();
      const raw = casos.find((c) => String(c.id) === req.params.id);
      if (!raw) {
        res.status(404).json({ error: 'Caso no encontrado' });
        return;
      }
      const overlay = getOverlay(db, req.params.id);
      db.caseOverlays[req.params.id] = { ...overlay, notes: [...overlay.notes, note] };
      saveDb(db);
      res.status(201).json(note);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Error al conectar con la intranet' });
    }
    return;
  }

  const found = db.cases.find((c) => c.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }
  found.notes.push(note);
  found.updatedAt = note.createdAt;
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

function photoPath(caseId: string, photo: CasePhoto): string {
  return join(getUploadsDir(), caseId, photo.filename);
}

casesRouter.post('/:id/photos', upload.single('photo'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Falta el archivo "photo"' });
    return;
  }

  const db = loadDb();
  const caseId = req.params.id;

  if (isIntranetEnabled()) {
    try {
      const casos = await fetchCasos();
      const raw = casos.find((c) => String(c.id) === caseId);
      if (!raw) {
        res.status(404).json({ error: 'Caso no encontrado' });
        return;
      }
      const overlay = getOverlay(db, caseId);
      const photo: CasePhoto = {
        id: uuid(),
        filename: `${uuid()}${extname(req.file.originalname) || '.jpg'}`,
        mimeType: req.file.mimetype,
        uploadedBy: req.auth!.name,
        uploadedAt: new Date().toISOString(),
      };
      mkdirSyncFor(caseId);
      writeFileSync(photoPath(caseId, photo), req.file.buffer);
      db.caseOverlays[caseId] = { ...overlay, photos: [...overlay.photos, photo] };
      saveDb(db);
      res.status(201).json(photo);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Error al conectar con la intranet' });
    }
    return;
  }

  const found = db.cases.find((c) => c.id === caseId);
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

function mkdirSyncFor(caseId: string) {
  const dir = join(getUploadsDir(), caseId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

casesRouter.get('/:id/photos/:photoId', (req, res) => {
  const db = loadDb();
  const overlay = db.caseOverlays[req.params.id];
  const localCase = db.cases.find((c) => c.id === req.params.id);
  const photo =
    overlay?.photos.find((p) => p.id === req.params.photoId) ||
    localCase?.photos.find((p) => p.id === req.params.photoId);

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

casesRouter.delete('/:id/photos/:photoId', (req, res) => {
  const db = loadDb();
  const caseId = req.params.id;

  if (isIntranetEnabled()) {
    const overlay = getOverlay(db, caseId);
    const photo = overlay.photos.find((p) => p.id === req.params.photoId);
    if (!photo) {
      res.status(404).json({ error: 'Foto no encontrada' });
      return;
    }
    const filePath = photoPath(caseId, photo);
    if (existsSync(filePath)) unlinkSync(filePath);
    db.caseOverlays[caseId] = { ...overlay, photos: overlay.photos.filter((p) => p.id !== photo.id) };
    saveDb(db);
    res.status(204).end();
    return;
  }

  const found = db.cases.find((c) => c.id === caseId);
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
