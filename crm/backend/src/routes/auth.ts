import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { loadDb } from '../db.js';
import { signToken } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'Email y contraseña son requeridos' });
    return;
  }

  const db = loadDb();
  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    res.status(401).json({ error: 'Credenciales inválidas' });
    return;
  }

  const token = signToken({
    sub: user.id,
    role: user.role,
    technicianId: user.technicianId,
    name: user.name,
  });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      technicianId: user.technicianId ?? null,
    },
  });
});
