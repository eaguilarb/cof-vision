import type { CaseStatus } from './types.js';

/**
 * Cliente hacia la intranet real de COF (Next.js en Railway). Se autentica
 * con una cuenta de servicio (variables de entorno) y expone los mismos
 * endpoints que usa la propia interfaz de la intranet:
 *   - GET  /api/problemas-tecnicos   (casos: discos duros, DVR, cámaras, etc.)
 *   - GET  /api/flota                (buses = "equipamiento")
 *   - PATCH /api/problemas-tecnicos/:id  { estado_caso }
 *   - POST  /api/problemas-tecnicos       { ppu, categoria, descripcion, ... }
 *
 * La intranet no tiene dónde guardar técnico asignado, prioridad ni notas
 * del CRM — eso se guarda localmente (ver types.ts CaseOverlay) y se
 * combina con estos datos en las rutas.
 */

const BASE_URL = (process.env.INTRANET_BASE_URL || 'https://intranet-cof-production.up.railway.app').replace(
  /\/+$/,
  '',
);
const EMAIL = process.env.INTRANET_EMAIL;
const PASSWORD = process.env.INTRANET_PASSWORD;

export function isIntranetEnabled(): boolean {
  return Boolean(EMAIL && PASSWORD);
}

let sessionCookie: string | null = null;
let loginPromise: Promise<string> | null = null;

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`No se pudo iniciar sesión en la intranet (código ${res.status})`);
  }
  const setCookie = res.headers.get('set-cookie');
  const match = setCookie?.match(/cof_session=[^;]+/);
  if (!match) {
    throw new Error('La intranet no devolvió cookie de sesión al iniciar sesión');
  }
  return match[0];
}

async function getSessionCookie(): Promise<string> {
  if (sessionCookie) return sessionCookie;
  if (!loginPromise) {
    loginPromise = login().finally(() => {
      loginPromise = null;
    });
  }
  sessionCookie = await loginPromise;
  return sessionCookie;
}

async function intranetFetch(path: string, init: RequestInit = {}, allowRetry = true): Promise<Response> {
  const cookie = await getSessionCookie();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Cookie: cookie },
  });
  if (res.status === 401 && allowRetry) {
    sessionCookie = null;
    return intranetFetch(path, init, false);
  }
  return res;
}

export interface IntranetCaso {
  id: number;
  ppu: string;
  categoria: string;
  estado_caso: string;
  tecnico_asignado: string | null;
  descripcion: string;
  terminal: string;
  creado_por: string;
  creado_en: string;
  actualizado_en: string | null;
  resuelto_en: string | null;
}

export interface IntranetBus {
  id: number;
  ppu: string;
  terminal: string;
  tipo_bus: string | null;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  disco_operativo: number | null;
  streaming_online: number | null;
  /** "RED" (con wifi/cámaras) o "TS" (sin wifi/cámaras). */
  estandar: string | null;
}

export async function fetchCasos(): Promise<IntranetCaso[]> {
  const res = await intranetFetch('/api/problemas-tecnicos');
  if (!res.ok) throw new Error(`No se pudo leer los casos de la intranet (código ${res.status})`);
  const data = (await res.json()) as { casos: IntranetCaso[] };
  return data.casos;
}

export async function fetchFlota(): Promise<IntranetBus[]> {
  const res = await intranetFetch('/api/flota');
  if (!res.ok) throw new Error(`No se pudo leer la flota de la intranet (código ${res.status})`);
  const data = (await res.json()) as { flota: IntranetBus[] };
  return data.flota;
}

export async function updateEstadoCaso(id: string, estado_caso: string): Promise<void> {
  const res = await intranetFetch(`/api/problemas-tecnicos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado_caso }),
  });
  if (!res.ok) {
    throw new Error(`No se pudo actualizar el estado en la intranet (código ${res.status})`);
  }
}

export async function createCaso(input: {
  ppu: string;
  categoria: string;
  descripcion: string;
}): Promise<IntranetCaso> {
  const res = await intranetFetch('/api/problemas-tecnicos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `No se pudo crear el caso en la intranet (código ${res.status})`);
  }
  // El endpoint de la intranet no siempre devuelve el registro creado
  // completo; para tener su id real, buscamos el caso recién creado.
  const casos = await fetchCasos();
  const created = casos.find(
    (c) => c.ppu === input.ppu && c.categoria === input.categoria && c.descripcion === input.descripcion,
  );
  if (!created) {
    throw new Error('El caso se creó pero no se pudo confirmar su id en la intranet');
  }
  return created;
}

export async function deleteCaso(id: string): Promise<void> {
  const res = await intranetFetch(`/api/problemas-tecnicos/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`No se pudo eliminar el caso en la intranet (código ${res.status})`);
  }
}

export const STATUS_TO_ESTADO: Record<CaseStatus, string> = {
  open: 'pendiente',
  assigned: 'asignado',
  in_progress: 'en_proceso',
  resolved: 'resuelto',
};

export const ESTADO_TO_STATUS: Record<string, CaseStatus> = {
  pendiente: 'open',
  asignado: 'assigned',
  en_proceso: 'in_progress',
  resuelto: 'resolved',
};

export const CATEGORIAS: { value: string; label: string }[] = [
  { value: 'camaras', label: 'Cámaras' },
  { value: 'disco_duro', label: 'Disco duro' },
  { value: 'dvr', label: 'DVR' },
  { value: 'gps', label: 'GPS' },
  { value: 'wifi', label: 'WiFi' },
  { value: 'consola_validacion', label: 'Consola de validación' },
  { value: 'validador', label: 'Validador' },
  { value: 'otro', label: 'Otro' },
];

export const CATEGORIA_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORIAS.map((c) => [c.value, c.label]),
);
