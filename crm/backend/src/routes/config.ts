import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { CATEGORIAS, isIntranetEnabled } from '../intranet.js';

export const configRouter = Router();

configRouter.use(requireAuth);

// Le dice al frontend si estamos conectados a la intranet real (y por lo
// tanto debe pedir "categoría" de una lista fija y una patente en vez de
// un título libre) o corriendo en modo local/demo.
configRouter.get('/', (_req, res) => {
  res.json({
    intranetEnabled: isIntranetEnabled(),
    categorias: isIntranetEnabled() ? CATEGORIAS : [],
  });
});
