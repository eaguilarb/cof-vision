import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { registerPushToken } from '../notifications.js';

export const pushTokensRouter = Router();

pushTokensRouter.use(requireAuth);

// Registra el token de push (Expo) del dispositivo del usuario logeado,
// para avisarle cuando entre un caso nuevo — ver notifications.ts.
pushTokensRouter.post('/', async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token) {
    res.status(400).json({ error: 'token es requerido' });
    return;
  }
  await registerPushToken(req.auth!.sub, token);
  res.status(204).end();
});
