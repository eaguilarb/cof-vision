import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  CATEGORIAS,
  GENERIC_RESOLUTION_ACTIONS,
  RESOLUTION_ACTIONS_BY_CATEGORIA,
  isIntranetEnabled,
} from '../intranet.js';

export const configRouter = Router();

configRouter.use(requireAuth);

// Le dice al frontend si estamos conectados a la intranet real (y por lo
// tanto debe pedir "categoría" de una lista fija y una patente en vez de
// un título libre) o corriendo en modo local/demo, y qué opciones de
// "qué se hizo" mostrar al cerrar un caso (ver PATCH /cases/:id/status).
configRouter.get('/', (_req, res) => {
  res.json({
    intranetEnabled: isIntranetEnabled(),
    categorias: isIntranetEnabled() ? CATEGORIAS : [],
    resolutionActionsByCategoria: RESOLUTION_ACTIONS_BY_CATEGORIA,
    genericResolutionActions: GENERIC_RESOLUTION_ACTIONS,
  });
});
