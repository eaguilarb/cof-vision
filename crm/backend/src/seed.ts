import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import { loadDb, saveDb } from './db.js';
import type { Case, CaseStatus } from './types.js';

const db = loadDb();

if (db.users.length > 0) {
  console.log('La base ya tiene datos, no se vuelve a sembrar. Borra crm/backend/data/db.json para reiniciar.');
  process.exit(0);
}

const now = new Date().toISOString();

const adminUserId = uuid();
db.users.push({
  id: adminUserId,
  name: 'Admin COF',
  email: 'admin@cof.local',
  passwordHash: bcrypt.hashSync('admin123', 10),
  role: 'admin',
  createdAt: now,
});

function addTechnician(name: string, email: string, specialty: string, phone: string) {
  const technicianId = uuid();
  const userId = uuid();
  db.technicians.push({ id: technicianId, userId, name, email, phone, specialty, active: true });
  db.users.push({
    id: userId,
    name,
    email,
    passwordHash: bcrypt.hashSync('tecnico123', 10),
    role: 'technician',
    technicianId,
    createdAt: now,
  });
  return technicianId;
}

const tech1 = addTechnician('Carlos Pérez', 'carlos@cof.local', 'Redes y servidores', '555-0101');
const tech2 = addTechnician('Ana Gómez', 'ana@cof.local', 'Impresoras y periféricos', '555-0102');

function addEquipment(
  name: string,
  type: string,
  clientName: string,
  extra: Partial<{ brand: string; model: string; serialNumber: string; location: string }> = {},
) {
  const id = uuid();
  db.equipment.push({ id, name, type, clientName, createdAt: now, ...extra });
  return id;
}

const eq1 = addEquipment('Servidor de archivos', 'Servidor', 'Contabilidad', {
  brand: 'Dell',
  model: 'PowerEdge R440',
  serialNumber: 'SRV-2201',
  location: 'Sala de servidores - Piso 1',
});
const eq2 = addEquipment('Impresora recepción', 'Impresora', 'Recepción', {
  brand: 'HP',
  model: 'LaserJet M404',
  serialNumber: 'IMP-0099',
  location: 'Recepción',
});
const eq3 = addEquipment('Router principal', 'Networking', 'Sistemas', {
  brand: 'Ubiquiti',
  model: 'EdgeRouter 4',
  serialNumber: 'NET-3311',
  location: 'Rack principal',
});

function addCase(
  title: string,
  description: string,
  equipmentId: string,
  clientName: string,
  priority: 'low' | 'medium' | 'high' | 'urgent',
  status: CaseStatus,
  assignedTechnicianId: string | null,
): Case {
  db.caseSequence += 1;
  const c: Case = {
    id: uuid(),
    code: `CASE-${String(db.caseSequence).padStart(4, '0')}`,
    title,
    description,
    equipmentId,
    clientName,
    priority,
    status,
    assignedTechnicianId,
    createdBy: adminUserId,
    createdAt: now,
    updatedAt: now,
    notes: [],
    history: [{ id: uuid(), status, changedBy: 'Admin COF', changedAt: now }],
  };
  db.cases.push(c);
  return c;
}

addCase(
  'Servidor no arranca',
  'El servidor de archivos se apagó de golpe y no enciende. Posible falla de fuente de poder.',
  eq1,
  'Contabilidad',
  'urgent',
  'in_progress',
  tech1,
);
addCase(
  'Impresora atasca papel',
  'La impresora de recepción atasca el papel constantemente al imprimir a doble cara.',
  eq2,
  'Recepción',
  'medium',
  'assigned',
  tech2,
);
addCase(
  'Revisión preventiva de router',
  'Mantenimiento preventivo trimestral del router principal.',
  eq3,
  'Sistemas',
  'low',
  'open',
  null,
);

saveDb(db);
console.log('Datos de ejemplo creados.');
console.log('Login admin: admin@cof.local / admin123');
console.log('Login técnico 1: carlos@cof.local / tecnico123');
console.log('Login técnico 2: ana@cof.local / tecnico123');
