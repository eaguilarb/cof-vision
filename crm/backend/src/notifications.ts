import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resend } from 'resend';
import { getUploadsDir, loadDb, saveDb } from './db.js';
import { CATEGORIA_LABELS, ESTADO_TO_STATUS, fetchCasos, isIntranetEnabled, type IntranetCaso } from './intranet.js';
import type { Case, CaseOverlay, CaseStatus, DbShape } from './types.js';

/**
 * Dos avisos, según lo pedido:
 *   - Correo (Resend) cuando un caso pasa a "resuelto", con el detalle
 *     (notas) y las fotos adjuntas.
 *   - Notificación push (Expo) cuando aparece un caso nuevo.
 *
 * Se disparan en dos lugares: al tiro cuando el cambio se hace desde este
 * mismo CRM (ver routes/cases.ts), y cada POLL_INTERVAL_MS sondeando la
 * intranet real (por si el cambio se hizo directo ahí, fuera del CRM) —
 * ver startPolling() más abajo.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL_TO = process.env.NOTIFY_EMAIL_TO || 'eaguilarb@stpsantiago.cl';
const NOTIFY_EMAIL_FROM = process.env.NOTIFY_EMAIL_FROM || 'COF CRM <onboarding@resend.dev>';
const POLL_INTERVAL_MS = Number(process.env.NOTIFY_POLL_INTERVAL_MS) || 5 * 60 * 1000;

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export async function registerPushToken(userId: string, token: string): Promise<void> {
  const db = loadDb();
  if (!db.pushTokens.some((t) => t.token === token)) {
    db.pushTokens.push({ token, userId, createdAt: new Date().toISOString() });
    saveDb(db);
  }
}

async function sendPushToAll(db: DbShape, title: string, body: string, data?: Record<string, unknown>) {
  if (db.pushTokens.length === 0) return;
  const messages = db.pushTokens.map((t) => ({ to: t.token, sound: 'default', title, body, data }));
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.error('Error al enviar notificación push:', err);
  }
}

/** Forma común de un caso (real o local) para armar los avisos. */
interface NotifyCaseInfo {
  id: string;
  status: CaseStatus;
  title: string;
  terminal: string;
  description: string;
  notes: { authorName: string; text: string }[];
  photos: { filename: string }[];
  uploadsSubdir: string;
}

function fromIntranetCaso(raw: IntranetCaso, overlay: CaseOverlay): NotifyCaseInfo {
  const categoriaLabel = CATEGORIA_LABELS[raw.categoria] ?? raw.categoria;
  return {
    id: String(raw.id),
    status: ESTADO_TO_STATUS[raw.estado_caso] ?? 'open',
    title: `${categoriaLabel} · ${raw.ppu}`,
    terminal: raw.terminal || '—',
    description: raw.descripcion || '(sin descripción)',
    notes: overlay.notes.map((n) => ({ authorName: n.authorName, text: n.text })),
    photos: overlay.photos.map((p) => ({ filename: p.filename })),
    uploadsSubdir: String(raw.id),
  };
}

function fromLocalCase(c: Case): NotifyCaseInfo {
  return {
    id: c.id,
    status: c.status,
    title: c.title,
    terminal: c.clientName,
    description: c.description,
    notes: c.notes.map((n) => ({ authorName: n.authorName, text: n.text })),
    photos: c.photos.map((p) => ({ filename: p.filename })),
    uploadsSubdir: c.id,
  };
}

async function sendResolvedEmail(info: NotifyCaseInfo): Promise<void> {
  if (!resend) return;
  const notesHtml = info.notes.length
    ? info.notes.map((n) => `<li><strong>${n.authorName}:</strong> ${n.text}</li>`).join('')
    : '<li>(sin notas registradas)</li>';

  const attachments: { filename: string; content: string }[] = [];
  for (const photo of info.photos) {
    const filePath = join(getUploadsDir(), info.uploadsSubdir, photo.filename);
    if (existsSync(filePath)) {
      attachments.push({ filename: photo.filename, content: readFileSync(filePath).toString('base64') });
    }
  }

  try {
    await resend.emails.send({
      from: NOTIFY_EMAIL_FROM,
      to: NOTIFY_EMAIL_TO,
      subject: `Caso COF-${info.id} resuelto — ${info.title}`,
      html: `
        <h2>Caso COF-${info.id} cerrado</h2>
        <p><strong>Terminal:</strong> ${info.terminal}</p>
        <p><strong>${info.title}</strong></p>
        <p><strong>Descripción original:</strong> ${info.description}</p>
        <p><strong>Detalle de lo realizado:</strong></p>
        <ul>${notesHtml}</ul>
        <p>${
          info.photos.length ? `Se adjuntan ${info.photos.length} foto(s).` : 'No se adjuntaron fotos.'
        }</p>
      `,
      attachments,
    });
  } catch (err) {
    console.error('Error al enviar correo de caso resuelto:', err);
  }
}

/**
 * Revisa un caso contra el último estado conocido y dispara el aviso que
 * corresponda (push si es nuevo, correo si recién quedó resuelto).
 * `save: false` deja que quien llama guarde la base de datos (para no
 * pisar otros cambios hechos en el mismo request).
 */
export async function processCaseInfo(info: NotifyCaseInfo, db: DbShape, opts: { save?: boolean } = {}): Promise<void> {
  const previous = db.notifyState.lastStatusByCaseId[info.id];

  if (previous === undefined) {
    if (db.notifyState.bootstrapped) {
      await sendPushToAll(db, 'Nuevo caso COF', `${info.title} · ${info.terminal}`, { caseId: info.id });
    }
  } else if (previous !== 'resolved' && info.status === 'resolved') {
    await sendResolvedEmail(info);
  }

  db.notifyState.lastStatusByCaseId[info.id] = info.status;
  if (opts.save !== false) saveDb(db);
}

export async function notifyIntranetCaso(raw: IntranetCaso, overlay: CaseOverlay, db: DbShape, opts?: { save?: boolean }) {
  await processCaseInfo(fromIntranetCaso(raw, overlay), db, opts);
}

export async function notifyLocalCase(c: Case, db: DbShape, opts?: { save?: boolean }) {
  await processCaseInfo(fromLocalCase(c), db, opts);
}

async function pollIntranetOnce(): Promise<void> {
  try {
    const db = loadDb();
    const casos = await fetchCasos();
    const isFirstRun = !db.notifyState.bootstrapped;
    for (const raw of casos) {
      const overlay = db.caseOverlays[String(raw.id)] || {
        assignedTechnicianId: null,
        priority: 'medium' as const,
        notes: [],
        history: [],
        photos: [],
      };
      await processCaseInfo(fromIntranetCaso(raw, overlay), db, { save: false });
    }
    if (isFirstRun) db.notifyState.bootstrapped = true;
    saveDb(db);
  } catch (err) {
    console.error('Error en el sondeo de la intranet para notificaciones:', err);
  }
}

export function startPolling(): void {
  if (!isIntranetEnabled()) return;
  pollIntranetOnce();
  setInterval(pollIntranetOnce, POLL_INTERVAL_MS);
}
