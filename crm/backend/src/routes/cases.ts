import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { loadDb, saveDb } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import type { CaseStatus } from '../types.js';

export const casesRouter = Router();

casesRouter.use(requireAuth);

const VALID_STATUSES: CaseStatus[] = [
  'open',
  'assigned',
  'in_progress',
  'waiting_parts',
  'resolved',
  'closed',
];

// GET /cases?status=&technicianId=&mine=true
casesRouter.get('/', (req, res) => {
  const db = loadDb();
  let cases = db.cases;

  const { status, technicianId, mine } = req.query as {
    status?: string;
    technicianId?: string;
    mine?: string;
  };

  if (mine === 'true' && req.auth?.technicianId) {
    cases = cases.filter((c) => c.assignedTechnicianId === req.auth!.technicianId);
  } else if (technicianId) {
    cases = cases.filter((c) => c.assignedTechnicianId === technicianId);
  }

  if (status) {
    cases = cases.filter((c) => c.status === status);
  }

  cases = [...cases].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(cases);
});

casesRouter.get('/:id', (req, res) => {
  const db = loadDb();
  const found = db.cases.find((c) => c.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }
  res.json(found);
});

casesRouter.post('/', (req, res) => {
  const { title, description, equipmentId, clientName, priority, assignedTechnicianId } =
    req.body as Partial<{
      title: string;
      description: string;
      equipmentId: string;
      clientName: string;
      priority: string;
      assignedTechnicianId: string | null;
    }>;

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

  const newCase = {
    id: uuid(),
    code: `CASE-${String(db.caseSequence).padStart(4, '0')}`,
    title,
    description,
    equipmentId,
    clientName,
    priority: (priority as any) || 'medium',
    status,
    assignedTechnicianId: assignedTechnicianId ?? null,
    createdBy: req.auth!.sub,
    createdAt: now,
    updatedAt: now,
    notes: [],
    history: [{ id: uuid(), status, changedBy: req.auth!.name, changedAt: now }],
  };

  db.cases.push(newCase);
  saveDb(db);
  res.status(201).json(newCase);
});

casesRouter.patch('/:id/assign', requireRole('admin'), (req, res) => {
  const { technicianId } = req.body as { technicianId?: string | null };
  const db = loadDb();
  const found = db.cases.find((c) => c.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }
  if (technicianId && !db.technicians.some((t) => t.id === technicianId)) {
    res.status(400).json({ error: 'Técnico no encontrado' });
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
  res.json(found);
});

casesRouter.patch('/:id/status', (req, res) => {
  const { status } = req.body as { status?: CaseStatus };
  if (!status || !VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: `status debe ser uno de: ${VALID_STATUSES.join(', ')}` });
    return;
  }

  const db = loadDb();
  const found = db.cases.find((c) => c.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }

  const isOwnerTechnician =
    req.auth?.role === 'technician' && req.auth.technicianId === found.assignedTechnicianId;
  if (req.auth?.role !== 'admin' && !isOwnerTechnician) {
    res.status(403).json({ error: 'Solo el técnico asignado o un admin pueden cambiar el estado' });
    return;
  }

  found.status = status;
  found.updatedAt = new Date().toISOString();
  found.history.push({ id: uuid(), status, changedBy: req.auth!.name, changedAt: found.updatedAt });
  saveDb(db);
  res.json(found);
});

casesRouter.post('/:id/notes', (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text) {
    res.status(400).json({ error: 'text es requerido' });
    return;
  }

  const db = loadDb();
  const found = db.cases.find((c) => c.id === req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Caso no encontrado' });
    return;
  }

  const note = {
    id: uuid(),
    authorId: req.auth!.sub,
    authorName: req.auth!.name,
    text,
    createdAt: new Date().toISOString(),
  };
  found.notes.push(note);
  found.updatedAt = note.createdAt;
  saveDb(db);
  res.status(201).json(note);
});
