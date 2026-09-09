import 'dotenv/config';
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import multer from 'multer';
import { authRouter } from './routes/auth.js';
import { techniciansRouter } from './routes/technicians.js';
import { equipmentRouter } from './routes/equipment.js';
import { casesRouter } from './routes/cases.js';
import { glassCasesRouter } from './routes/glass-cases.js';
import { configRouter } from './routes/config.js';
import { pushTokensRouter } from './routes/push-tokens.js';
import { reportsRouter } from './routes/reports.js';
import { usersRouter } from './routes/users.js';
import { isIntranetEnabled } from './intranet.js';
import { startPolling } from './notifications.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/technicians', techniciansRouter);
app.use('/equipment', equipmentRouter);
app.use('/cases', casesRouter);
app.use('/glass-cases', glassCasesRouter);
app.use('/config', configRouter);
app.use('/push-tokens', pushTokensRouter);
app.use('/reports', reportsRouter);
app.use('/users', usersRouter);

const handleUploadErrors: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof multer.MulterError || (err instanceof Error && err.message === 'Solo se permiten imágenes')) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
};
app.use(handleUploadErrors);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`CRM backend escuchando en http://localhost:${PORT}`);
  console.log(
    isIntranetEnabled()
      ? 'Conectado a la intranet real (INTRANET_EMAIL configurado).'
      : 'Modo local/demo (define INTRANET_EMAIL e INTRANET_PASSWORD para conectar la intranet real).',
  );
  startPolling();
});
