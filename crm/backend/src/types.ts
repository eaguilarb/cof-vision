export type Role = 'admin' | 'technician' | 'operator';

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  technicianId?: string;
  createdAt: string;
}

export interface Technician {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone?: string;
  specialty?: string;
  active: boolean;
  /**
   * Terminales que puede ver/procesar este técnico u "operador" (vidriero
   * incluido). Vacío o ausente = sin restricción (ve todos los terminales,
   * comportamiento anterior por compatibilidad con técnicos ya creados).
   */
  assignedTerminals?: string[];
  /**
   * Módulo al que queda restringido este operador: un técnico solo ve/crea
   * casos de "tech", un vidriero solo de "glass". Ausente = sin
   * restricción (comportamiento anterior, ve ambos módulos) — solo se usa
   * así para cuentas que todavía no se han separado explícitamente.
   */
  assignedModule?: 'tech' | 'glass';
}

export interface Equipment {
  id: string;
  name: string;
  type: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  clientName: string;
  clientContact?: string;
  location?: string;
  createdAt: string;
  /** Estándar del bus (solo modo intranet): "RED" tiene wifi/cámaras, "TS" no. */
  estandar?: 'RED' | 'TS';
  /**
   * Si el bus tiene algún caso (técnico o de vidrios) abierto/asignado/en
   * proceso, queda "no operativo" hasta que ese caso se resuelva. Se
   * calcula al vuelo, no se guarda.
   */
  operational?: boolean;
}

export type CaseStatus = 'open' | 'assigned' | 'in_progress' | 'resolved';

export type CasePriority = 'low' | 'medium' | 'high' | 'urgent';

export interface CaseNote {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface CaseHistoryEntry {
  id: string;
  status: CaseStatus;
  changedBy: string;
  changedAt: string;
}

export interface CasePhoto {
  id: string;
  filename: string;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface Case {
  id: string;
  code: string;
  title: string;
  description: string;
  equipmentId: string;
  clientName: string;
  priority: CasePriority;
  status: CaseStatus;
  assignedTechnicianId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  notes: CaseNote[];
  history: CaseHistoryEntry[];
  photos: CasePhoto[];
  /** Categoría de falla (solo modo intranet: disco_duro, dvr, camaras, etc). */
  categoria: string | null;
  /** Qué se hizo para resolverlo (ej. "Reemplazo de disco duro") — se pide al cerrar el caso. */
  resolutionAction: string | null;
  /** Detalle libre adicional sobre la reparación. */
  resolutionNotes: string | null;
}

/**
 * Lo que devuelven las rutas de casos: un Case más los días calculados al
 * vuelo (no se guardan en el JSON, se recalculan en cada respuesta — ver
 * services/case-service.ts).
 */
export interface CaseWithAge extends Case {
  /** Días desde que se creó el caso hasta hoy (o hasta que se resolvió, si ya está resuelto). */
  daysOpen: number;
  /** Días que tomó resolverlo, o null si todavía no está resuelto. */
  resolvedInDays: number | null;
}

/**
 * Datos que el CRM guarda de forma local para un caso que en realidad
 * vive en la intranet (que no tiene dónde guardar técnico asignado,
 * prioridad, notas ni fotos). Se indexa por el id del caso en la intranet.
 */
export interface CaseOverlay {
  assignedTechnicianId: string | null;
  priority: CasePriority;
  notes: CaseNote[];
  history: CaseHistoryEntry[];
  photos: CasePhoto[];
  resolutionAction: string | null;
  resolutionNotes: string | null;
}

export interface PushToken {
  token: string;
  userId: string;
  createdAt: string;
}

/**
 * Recuerda, por caso, el último estado que ya generó una notificación (o
 * que ya se vio al menos una vez). Así el sondeo periódico de la intranet
 * (ver notifications.ts) sabe qué es "nuevo" o "recién resuelto" sin
 * volver a avisar de algo ya notificado, y `bootstrapped` evita mandar
 * notificaciones de todos los casos preexistentes la primera vez que
 * corre.
 */
export interface NotifyState {
  bootstrapped: boolean;
  lastStatusByCaseId: Record<string, CaseStatus>;
}

export interface DbShape {
  users: User[];
  technicians: Technician[];
  equipment: Equipment[];
  cases: Case[];
  caseSequence: number;
  caseOverlays: Record<string, CaseOverlay>;
  pushTokens: PushToken[];
  notifyState: NotifyState;
  /**
   * Casos del módulo "Vidrios" — siempre locales a este CRM (la intranet
   * real no tiene un módulo de vidrios), pero validados contra la flota
   * real al crearse. Mismo modelo de datos que `cases`.
   */
  glassCases: Case[];
  glassCaseSequence: number;
}
