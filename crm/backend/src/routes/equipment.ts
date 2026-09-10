import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { loadDb, saveDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { fetchFlota, isIntranetEnabled, type IntranetBus } from '../intranet.js';
import { getNonOperationalEquipmentIds } from '../services/case-service.js';
import { allowedTerminalsFor } from '../services/terminal-access.js';
import type { Equipment } from '../types.js';

export const equipmentRouter = Router();

equipmentRouter.use(requireAuth);

function toEquipment(bus: IntranetBus): Equipment {
  return {
    id: bus.ppu,
    name: bus.ppu,
    type: bus.tipo_bus || 'Bus',
    brand: bus.marca ?? undefined,
    model: bus.modelo ?? undefined,
    clientName: bus.terminal || '—',
    location: bus.terminal ?? undefined,
    createdAt: new Date().toISOString(),
    // "RED" tiene wifi/cámaras, "TS" no — ver categorías wifi/camaras al crear casos.
    estandar: bus.estandar === 'TS' ? 'TS' : 'RED',
  };
}

equipmentRouter.get('/', async (req, res) => {
  const db = loadDb();
  const module = req.query.module === 'glass' || req.query.module === 'tech' ? req.query.module : undefined;
  const nonOperational = await getNonOperationalEquipmentIds(db, module);
  const allowedTerminals = allowedTerminalsFor(db, req.auth);

  if (isIntranetEnabled()) {
    try {
      const flota = await fetchFlota();
      let list = flota.map(toEquipment);
      if (allowedTerminals) list = list.filter((eq) => allowedTerminals.includes(eq.clientName));
      res.json(list.map((eq) => ({ ...eq, operational: !nonOperational.has(eq.id) })));
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Error al conectar con la intranet' });
    }
    return;
  }

  let list = db.equipment;
  if (allowedTerminals) list = list.filter((eq) => allowedTerminals.includes(eq.clientName));
  res.json(list.map((eq) => ({ ...eq, operational: !nonOperational.has(eq.id) })));
});

equipmentRouter.post('/', (req, res) => {
  if (isIntranetEnabled()) {
    res.status(400).json({
      error: 'La flota se administra desde la intranet (módulo Flota), no se puede agregar equipos desde aquí.',
    });
    return;
  }

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
