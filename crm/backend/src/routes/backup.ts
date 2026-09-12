import { Router } from 'express';
import { loadDb } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

/**
 * Volcado completo de los datos propios del CRM (no la intranet) para
 * respaldo — cuentas, casos de Vidrios, overlays, etc. Se usa desde
 * fuera vía HTTPS en vez de bajar el archivo directo del volumen de
 * Railway, porque no todos los entornos desde donde se podría llamar
 * (ej. GitHub Actions) tienen acceso SFTP a Railway, pero sí HTTPS.
 * Las contraseñas viajan como hash (bcrypt), nunca en texto plano.
 */
export const backupRouter = Router();

backupRouter.use(requireAuth, requireRole('admin'));

backupRouter.get('/', (_req, res) => {
  const db = loadDb();
  res.setHeader('Content-Disposition', `attachment; filename="cof-crm-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(db);
});
