import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import { loadDb, saveDb } from './db.js';
import type { Case, Equipment, Technician, User } from './types.js';

const db = loadDb();

if (db.users.length > 0) {
  console.log('La base ya tiene datos, no se vuelve a sembrar. Borra crm/backend/data/db.json para reiniciar.');
  process.exit(0);
}

const adminUserId = uuid();
const carlosUserId = uuid();
const anaUserId = uuid();

// En producción, define ADMIN_EMAIL/ADMIN_NAME/ADMIN_PASSWORD para que la
// cuenta de administrador sea la real (no la de ejemplo).
const adminEmail = process.env.ADMIN_EMAIL || 'admin@cof.local';
const adminName = process.env.ADMIN_NAME || 'Admin COF';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

const users: User[] = [
  {
    id: adminUserId,
    name: adminName,
    email: adminEmail,
    passwordHash: bcrypt.hashSync(adminPassword, 10),
    role: 'admin',
    createdAt: '2026-09-01T09:00:00.000Z',
  },
  {
    id: carlosUserId,
    name: 'Carlos Pérez',
    email: 'carlos@cof.local',
    passwordHash: bcrypt.hashSync('tecnico123', 10),
    role: 'technician',
    technicianId: 't1',
    createdAt: '2026-09-01T09:00:00.000Z',
  },
  {
    id: anaUserId,
    name: 'Ana Gómez',
    email: 'ana@cof.local',
    passwordHash: bcrypt.hashSync('tecnico123', 10),
    role: 'technician',
    technicianId: 't2',
    createdAt: '2026-09-01T09:00:00.000Z',
  },
];

const technicians: Technician[] = [
  {
    id: 't1',
    userId: carlosUserId,
    name: 'Carlos Pérez',
    email: 'carlos@cof.local',
    phone: '555-0101',
    specialty: 'Redes y servidores',
    active: true,
  },
  {
    id: 't2',
    userId: anaUserId,
    name: 'Ana Gómez',
    email: 'ana@cof.local',
    phone: '555-0102',
    specialty: 'Impresoras y periféricos',
    active: true,
  },
];

const equipment: Equipment[] = [
  {
    id: 'e1',
    name: 'Servidor de archivos',
    type: 'Servidor',
    brand: 'Dell',
    model: 'PowerEdge R440',
    serialNumber: 'SRV-2201',
    clientName: 'Contabilidad',
    location: 'Sala de servidores - Piso 1',
    createdAt: '2026-09-01T09:00:00.000Z',
  },
  {
    id: 'e2',
    name: 'Impresora recepción',
    type: 'Impresora',
    brand: 'HP',
    model: 'LaserJet M404',
    serialNumber: 'IMP-0099',
    clientName: 'Recepción',
    location: 'Recepción',
    createdAt: '2026-09-01T09:00:00.000Z',
  },
  {
    id: 'e3',
    name: 'Router principal',
    type: 'Networking',
    brand: 'Ubiquiti',
    model: 'EdgeRouter 4',
    serialNumber: 'NET-3311',
    clientName: 'Sistemas',
    location: 'Rack principal',
    createdAt: '2026-09-01T09:00:00.000Z',
  },
];

const cases: Case[] = [
  {
    id: 'c1',
    code: 'CASE-0001',
    title: 'Servidor no arranca',
    description:
      'El servidor de archivos se apagó de golpe y no enciende. Posible falla de fuente de poder.',
    equipmentId: 'e1',
    clientName: 'Contabilidad',
    priority: 'urgent',
    status: 'in_progress',
    assignedTechnicianId: 't1',
    createdBy: adminUserId,
    createdAt: '2026-09-06T10:00:00.000Z',
    updatedAt: '2026-09-06T10:28:00.000Z',
    notes: [],
    history: [
      { id: 'h1', status: 'open', changedBy: 'Administrador', changedAt: '2026-09-06T10:00:00.000Z' },
      { id: 'h2', status: 'assigned', changedBy: 'Administrador', changedAt: '2026-09-06T10:10:00.000Z' },
      { id: 'h3', status: 'in_progress', changedBy: 'Carlos Pérez', changedAt: '2026-09-06T10:28:00.000Z' },
    ],
    photos: [],
  },
  {
    id: 'c2',
    code: 'CASE-0002',
    title: 'Impresora atasca papel',
    description: 'La impresora de recepción atasca el papel constantemente al imprimir a doble cara.',
    equipmentId: 'e2',
    clientName: 'Recepción',
    priority: 'medium',
    status: 'in_progress',
    assignedTechnicianId: null,
    createdBy: adminUserId,
    createdAt: '2026-09-06T09:00:00.000Z',
    updatedAt: '2026-09-06T22:55:06.147Z',
    notes: [],
    history: [
      { id: 'h4', status: 'open', changedBy: 'Administrador', changedAt: '2026-09-06T09:00:00.000Z' },
      { id: 'h5', status: 'assigned', changedBy: 'Administrador', changedAt: '2026-09-06T09:05:00.000Z' },
      { id: 'a6b46b82-ad9a-4fd4-bdf3-aee6add1c124', status: 'in_progress', changedBy: 'Administrador', changedAt: '2026-09-06T22:54:55.781Z' },
      { id: 'e09f7862-d30f-452b-8d89-6cb47b3c9138', status: 'in_progress', changedBy: 'Administrador', changedAt: '2026-09-06T22:55:06.147Z' },
    ],
    photos: [],
  },
  {
    id: 'c3',
    code: 'CASE-0003',
    title: 'Revisión preventiva de router',
    description: 'Mantenimiento preventivo trimestral del router principal.',
    equipmentId: 'e3',
    clientName: 'Sistemas',
    priority: 'low',
    status: 'resolved',
    assignedTechnicianId: null,
    createdBy: adminUserId,
    createdAt: '2026-09-06T08:00:00.000Z',
    updatedAt: '2026-09-06T22:54:12.775Z',
    notes: [
      {
        id: '0c4beb41-320b-4c5e-b7d5-fc17bd49fb05',
        authorId: adminUserId,
        authorName: 'Administrador',
        text: 'Ok',
        createdAt: '2026-09-06T22:54:12.775Z',
      },
    ],
    history: [
      { id: 'h6', status: 'open', changedBy: 'Administrador', changedAt: '2026-09-06T08:00:00.000Z' },
      { id: '8c0f90cd-89a2-44d2-8924-ad88ff648daa', status: 'resolved', changedBy: 'Administrador', changedAt: '2026-09-06T22:54:06.950Z' },
    ],
    photos: [],
  },
];

db.users.push(...users);
db.technicians.push(...technicians);
db.equipment.push(...equipment);
db.cases.push(...cases);
db.caseSequence = 3;

saveDb(db);
console.log('Datos de ejemplo creados (mismos casos que la demo web "COF Taller").');
console.log(`Login admin: ${adminEmail} / (la contraseña que definiste en ADMIN_PASSWORD)`);
console.log('Login técnico 1: carlos@cof.local / tecnico123');
console.log('Login técnico 2: ana@cof.local / tecnico123');
