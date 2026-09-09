import type { AuthPayload } from '../middleware/auth.js';
import type { DbShape } from '../types.js';

/**
 * Terminales que puede ver el usuario autenticado, o `null` si no tiene
 * restricción (admin, supervisor, o un operador sin terminales asignadas
 * — comportamiento por compatibilidad con técnicos ya creados).
 */
export function allowedTerminalsFor(db: DbShape, auth?: AuthPayload): string[] | null {
  if (!auth || auth.role !== 'technician' || !auth.technicianId) return null;
  const technician = db.technicians.find((t) => t.id === auth.technicianId);
  const terminals = technician?.assignedTerminals;
  if (!terminals || terminals.length === 0) return null;
  return terminals;
}
