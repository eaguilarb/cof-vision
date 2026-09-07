import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { techniciansRouter } from './routes/technicians.js';
import { equipmentRouter } from './routes/equipment.js';
import { casesRouter } from './routes/cases.js';
import { configRouter } from './routes/config.js';
import { isIntranetEnabled } from './intranet.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/technicians', techniciansRouter);
app.use('/equipment', equipmentRouter);
app.use('/cases', casesRouter);
app.use('/config', configRouter);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`CRM backend escuchando en http://localhost:${PORT}`);
  console.log(
    isIntranetEnabled()
      ? 'Conectado a la intranet real (INTRANET_EMAIL configurado).'
      : 'Modo local/demo (define INTRANET_EMAIL e INTRANET_PASSWORD para conectar la intranet real).',
  );
});
