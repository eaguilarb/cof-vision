import type { Case, CaseOverlay, CaseWithAge, DbShape } from '../types.js';
import { CATEGORIA_LABELS, ESTADO_TO_STATUS, fetchCasos, isIntranetEnabled, type IntranetCaso } from '../intranet.js';

/**
 * Arma un Case (con días abiertos/resueltos ya calculados) a partir de un
 * caso crudo de la intranet o uno local — se usa desde las rutas de casos,
 * de reportes y de exportación para no repetir esta cuenta en cada lugar.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function withAge(c: Case, resolvedAtIso: string | null): CaseWithAge {
  const createdMs = new Date(c.createdAt).getTime();
  const nowMs = Date.now();
  const daysOpen = Math.max(0, Math.floor((nowMs - createdMs) / DAY_MS));
  let resolvedInDays: number | null = null;
  if (c.status === 'resolved') {
    const resolvedMs = resolvedAtIso ? new Date(resolvedAtIso).getTime() : nowMs;
    resolvedInDays = Math.max(0, Math.floor((resolvedMs - createdMs) / DAY_MS));
  }
  return { ...c, daysOpen, resolvedInDays };
}

export function emptyOverlay(): CaseOverlay {
  return {
    assignedTechnicianId: null,
    priority: 'medium',
    notes: [],
    history: [],
    photos: [],
    resolutionAction: null,
    resolutionNotes: null,
  };
}

export function getOverlay(db: DbShape, id: string): CaseOverlay {
  return db.caseOverlays[id] || emptyOverlay();
}

export function toCase(raw: IntranetCaso, db: DbShape): CaseWithAge {
  const id = String(raw.id);
  const overlay = getOverlay(db, id);
  const categoriaLabel = CATEGORIA_LABELS[raw.categoria] ?? raw.categoria;

  return withAge(
    {
      id,
      code: `COF-${id}`,
      title: `${categoriaLabel} · ${raw.ppu}`,
      description: raw.descripcion || '(sin descripción)',
      equipmentId: raw.ppu,
      clientName: raw.terminal || '—',
      priority: overlay.priority,
      status: ESTADO_TO_STATUS[raw.estado_caso] ?? 'open',
      assignedTechnicianId: overlay.assignedTechnicianId,
      createdBy: raw.creado_por || 'intranet',
      createdAt: raw.creado_en,
      updatedAt: raw.actualizado_en || raw.creado_en,
      notes: overlay.notes,
      history: overlay.history,
      photos: overlay.photos,
      categoria: raw.categoria,
      resolutionAction: overlay.resolutionAction,
      resolutionNotes: overlay.resolutionNotes,
    },
    raw.resuelto_en,
  );
}

function localResolvedAt(c: Case): string | null {
  const entry = [...c.history].reverse().find((h) => h.status === 'resolved');
  return entry?.changedAt ?? null;
}

/** Recalcula daysOpen/resolvedInDays de un Case guardado localmente. */
export function withLocalAge(c: Case): CaseWithAge {
  return withAge(c, localResolvedAt(c));
}

/** Todos los casos (intranet real o locales), ya con días calculados. */
export async function getAllCases(db: DbShape): Promise<CaseWithAge[]> {
  if (isIntranetEnabled()) {
    const casos = await fetchCasos();
    return casos.map((c) => toCase(c, db));
  }
  return db.cases.map(withLocalAge);
}

const OPEN_STATUSES = new Set(['open', 'assigned', 'in_progress']);

/**
 * Categorías técnicas que NO dejan el bus fuera de servicio: el bus sigue
 * operando con normalidad mientras se resuelve (cámaras, disco duro y DVR
 * son solo de respaldo/registro, no afectan la operación de la ruta).
 * Todo lo demás (GPS, wifi/router, consola de validación, validador,
 * otro) sí lo deja no operativo — igual que cualquier caso de Vidrios.
 */
const TECH_CATEGORIAS_SIN_IMPACTO_OPERATIVO = new Set(['camaras', 'disco_duro', 'dvr']);

/**
 * IDs de equipo (patente) con al menos un caso abierto/asignado/en proceso
 * que sí afecta su operación. Por defecto considera casos técnicos y de
 * vidrios juntos (un bus queda "no operativo" mientras tenga cualquiera de
 * los dos sin resolver). Si se indica `module`, sólo cuenta los casos de
 * ese módulo — así cada módulo ve su propio estado operativo/no operativo
 * para su reportería diaria, sin mezclar el estado del otro módulo.
 */
export async function getNonOperationalEquipmentIds(
  db: DbShape,
  module?: 'tech' | 'glass',
): Promise<Set<string>> {
  const [techCases, glassCases] = await Promise.all([
    module === 'glass' ? Promise.resolve([]) : getAllCases(db),
    module === 'tech' ? Promise.resolve([]) : Promise.resolve(db.glassCases.map(withLocalAge)),
  ]);
  const nonOperational = new Set<string>();
  for (const c of techCases) {
    if (!OPEN_STATUSES.has(c.status)) continue;
    if (c.categoria && TECH_CATEGORIAS_SIN_IMPACTO_OPERATIVO.has(c.categoria)) continue;
    nonOperational.add(c.equipmentId);
  }
  for (const c of glassCases) {
    if (OPEN_STATUSES.has(c.status)) nonOperational.add(c.equipmentId);
  }
  return nonOperational;
}
