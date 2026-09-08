import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { loadDb, saveDb } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import type { Role, User } from '../types.js';

/**
 * Gestión de cuentas admin/operator. Los técnicos se administran desde
 * /technicians (crean tanto el User como el Technician juntos).
 */
export const usersRouter = Router();

usersRouter.use(requireAuth, requireRole('admin'));

function toPublicUser(u: User) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt };
}

usersRouter.get('/', (_req, res) => {
  const db = loadDb();
  res.json(db.users.map(toPublicUser));
});

usersRouter.post('/', (req, res) => {
  const { name, email, password, role } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    role?: Role;
  };
  if (!name || !email || !password || !role) {
    res.status(400).json({ error: 'name, email, password y role son requeridos' });
    return;
  }
  if (role !== 'admin' && role !== 'operator') {
    res.status(400).json({ error: 'Para crear técnicos usa la pestaña Técnicos; role debe ser admin u operator' });
    return;
  }

  const db = loadDb();
  if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    return;
  }

  const user: User = {
    id: uuid(),
    name,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  saveDb(db);
  res.status(201).json(toPublicUser(user));
});

usersRouter.delete('/:id', (req, res) => {
  if (req.auth!.sub === req.params.id) {
    res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    return;
  }

  const db = loadDb();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }
  if (user.role === 'technician') {
    res.status(400).json({ error: 'Para técnicos, desactívalos desde la pestaña Técnicos en vez de eliminarlos' });
    return;
  }

  db.users = db.users.filter((u) => u.id !== req.params.id);
  saveDb(db);
  res.status(204).end();
});
