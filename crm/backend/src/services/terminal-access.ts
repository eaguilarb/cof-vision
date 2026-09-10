import type { NextFunction, Request, Response } from 'express';
import { loadDb } from '../db.js';
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

/**
 * Módulo ("tech" o "glass") al que queda restringido el usuario
 * autenticado, o `null` si no tiene restricción (admin, supervisor, o un
 * operador sin módulo asignado — comportamiento por compatibilidad con
 * técnicos ya creados, que ven ambos módulos).
 */
export function allowedModuleFor(db: DbShape, auth?: AuthPayload): 'tech' | 'glass' | null {
  if (!auth || auth.role !== 'technician' || !auth.technicianId) return null;
  const technician = db.technicians.find((t) => t.id === auth.technicianId);
  return technician?.assignedModule ?? null;
}

/**
 * Middleware de router: bloquea todo el módulo de casos ("tech" o
 * "glass") para un técnico/vidriero cuya cuenta esté restringida al otro
 * módulo — un técnico no debe poder listar ni crear casos de Vidrios, ni
 * un vidriero de Tecnológico.
 */
export function requireModuleAccess(module: 'tech' | 'glass') {
  return (req: Request, res: Response, next: NextFunction) => {
    const db = loadDb();
    const allowed = allowedModuleFor(db, req.auth);
    if (allowed && allowed !== module) {
      res.status(403).json({ error: 'Tu cuenta no tiene acceso a este módulo' });
      return;
    }
    next();
  };
}
