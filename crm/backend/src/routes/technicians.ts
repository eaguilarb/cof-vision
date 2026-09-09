import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import { loadDb, saveDb } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const techniciansRouter = Router();

techniciansRouter.use(requireAuth);

techniciansRouter.get('/', (_req, res) => {
  const db = loadDb();
  res.json(db.technicians);
});

techniciansRouter.post('/', requireRole('admin'), (req, res) => {
  const { name, email, phone, specialty, password } = req.body as {
    name?: string;
    email?: string;
    phone?: string;
    specialty?: string;
    password?: string;
  };
  if (!name || !email || !password) {
    res.status(400).json({ error: 'name, email y password son requeridos' });
    return;
  }

  const db = loadDb();
  if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    return;
  }

  const technicianId = uuid();
  const userId = uuid();

  db.technicians.push({
    id: technicianId,
    userId,
    name,
    email,
    phone,
    specialty,
    active: true,
  });

  db.users.push({
    id: userId,
    name,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'technician',
    technicianId,
    createdAt: new Date().toISOString(),
  });

  saveDb(db);
  res.status(201).json(db.technicians.find((t) => t.id === technicianId));
});

techniciansRouter.patch('/:id', requireRole('admin'), (req, res) => {
  const db = loadDb();
  const technician = db.technicians.find((t) => t.id === req.params.id);
  if (!technician) {
    res.status(404).json({ error: 'Técnico no encontrado' });
    return;
  }
  const { name, phone, specialty, active, assignedTerminals, password } = req.body as Partial<{
    name: string;
    phone: string;
    specialty: string;
    active: boolean;
    assignedTerminals: string[];
    password: string;
  }>;
  if (name !== undefined) technician.name = name;
  if (phone !== undefined) technician.phone = phone;
  if (specialty !== undefined) technician.specialty = specialty;
  if (active !== undefined) technician.active = active;
  if (assignedTerminals !== undefined) technician.assignedTerminals = assignedTerminals;
  if (password) {
    const user = db.users.find((u) => u.id === technician.userId);
    if (user) user.passwordHash = bcrypt.hashSync(password, 10);
  }
  saveDb(db);
  res.json(technician);
});

// Elimina al técnico y su cuenta de acceso. Los casos que tenía asignados
// quedan sin asignar (no se borran).
techniciansRouter.delete('/:id', requireRole('admin'), (req, res) => {
  const db = loadDb();
  const technician = db.technicians.find((t) => t.id === req.params.id);
  if (!technician) {
    res.status(404).json({ error: 'Técnico no encontrado' });
    return;
  }

  db.technicians = db.technicians.filter((t) => t.id !== req.params.id);
  db.users = db.users.filter((u) => u.technicianId !== req.params.id);
  for (const overlay of Object.values(db.caseOverlays)) {
    if (overlay.assignedTechnicianId === req.params.id) overlay.assignedTechnicianId = null;
  }
  for (const c of db.cases) {
    if (c.assignedTechnicianId === req.params.id) c.assignedTechnicianId = null;
  }

  saveDb(db);
  res.status(204).end();
});
