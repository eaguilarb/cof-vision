import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { loadDb, saveDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export const equipmentRouter = Router();

equipmentRouter.use(requireAuth);

equipmentRouter.get('/', (_req, res) => {
  const db = loadDb();
  res.json(db.equipment);
});

equipmentRouter.post('/', (req, res) => {
  const { name, type, brand, model, serialNumber, clientName, clientContact, location } =
    req.body as Partial<{
      name: string;
      type: string;
      brand: string;
      model: string;
      serialNumber: string;
      clientName: string;
      clientContact: string;
      location: string;
    }>;

  if (!name || !type || !clientName) {
    res.status(400).json({ error: 'name, type y clientName son requeridos' });
    return;
  }

  const db = loadDb();
  const equipment = {
    id: uuid(),
    name,
    type,
    brand,
    model,
    serialNumber,
    clientName,
    clientContact,
    location,
    createdAt: new Date().toISOString(),
  };
  db.equipment.push(equipment);
  saveDb(db);
  res.status(201).json(equipment);
});
