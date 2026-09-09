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

/** Confirma que una patente existe en la flota real antes de crear un caso. */
export async function isValidPpu(ppu: string): Promise<boolean> {
  const flota = await fetchFlota();
  return flota.some((b) => b.ppu === ppu);
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

/**
 * Qué se hizo para resolver un caso, según su categoría — se pide al
 * cerrarlo (ver PATCH /cases/:id/status) para llevar el control de
 * repuestos/piezas usadas (discos duros, DVR, etc. reemplazados).
 */
export const RESOLUTION_ACTIONS_BY_CATEGORIA: Record<string, { value: string; label: string }[]> = {
  disco_duro: [
    { value: 'reemplazo_disco_duro', label: 'Reemplazo de disco duro' },
    { value: 'reparacion_disco_duro', label: 'Reparación/formateo de disco duro' },
    { value: 'otro', label: 'Otro' },
  ],
  dvr: [
    { value: 'reemplazo_dvr', label: 'Reemplazo de DVR' },
    { value: 'reparacion_dvr', label: 'Reparación/configuración de DVR' },
    { value: 'otro', label: 'Otro' },
  ],
  camaras: [
    { value: 'reemplazo_camara', label: 'Reemplazo de cámara' },
    { value: 'reparacion_camara', label: 'Reparación/reinstalación de cámara' },
    { value: 'otro', label: 'Otro' },
  ],
  gps: [
    { value: 'reemplazo_gps', label: 'Reemplazo de equipo GPS' },
    { value: 'reparacion_gps', label: 'Reparación/configuración de GPS' },
    { value: 'otro', label: 'Otro' },
  ],
  wifi: [
    { value: 'reemplazo_wifi', label: 'Reemplazo de router/antena WiFi' },
    { value: 'reparacion_wifi', label: 'Reparación/configuración de WiFi' },
    { value: 'otro', label: 'Otro' },
  ],
  consola_validacion: [
    { value: 'reemplazo_consola', label: 'Reemplazo de consola de validación' },
    { value: 'reparacion_consola', label: 'Reparación de consola de validación' },
    { value: 'otro', label: 'Otro' },
  ],
  validador: [
    { value: 'reemplazo_validador', label: 'Reemplazo de validador' },
    { value: 'reparacion_validador', label: 'Reparación de validador' },
    { value: 'otro', label: 'Otro' },
  ],
  otro: [
    { value: 'reparacion', label: 'Reparación' },
    { value: 'reemplazo_equipo', label: 'Reemplazo de equipo' },
    { value: 'otro', label: 'Otro' },
  ],
};

/** Lista genérica para modo local/demo (sin categoría de intranet). */
export const GENERIC_RESOLUTION_ACTIONS: { value: string; label: string }[] = [
  { value: 'reparado', label: 'Reparado' },
  { value: 'reemplazado', label: 'Equipo reemplazado' },
  { value: 'configurado', label: 'Configurado/ajustado' },
  { value: 'otro', label: 'Otro' },
];

export function resolutionActionLabel(categoria: string | null, action: string | null): string | null {
  if (!action) return null;
  const list = (categoria && RESOLUTION_ACTIONS_BY_CATEGORIA[categoria]) || GENERIC_RESOLUTION_ACTIONS;
  return list.find((a) => a.value === action)?.label ?? action;
}
