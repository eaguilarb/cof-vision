export type Role = 'admin' | 'technician' | 'operator';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  technician: 'Técnico',
  operator: 'Operador',
};

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  technicianId: string | null;
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
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
  /** Días desde que se creó el caso hasta hoy (o hasta que se resolvió). */
  daysOpen: number;
  /** Días que tomó resolverlo, o null si todavía no está resuelto. */
  resolvedInDays: number | null;
  /** Categoría de falla (solo modo intranet). */
  categoria: string | null;
  /** Qué se hizo para resolverlo (ej. "reemplazo_disco_duro"), pedido al cerrar el caso. */
  resolutionAction: string | null;
  resolutionNotes: string | null;
}

export const STATUS_LABELS: Record<CaseStatus, string> = {
  open: 'Pendiente',
  assigned: 'Asignado',
  in_progress: 'En proceso',
  resolved: 'Resuelto',
};

export const PRIORITY_LABELS: Record<CasePriority, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  urgent: 'Urgente',
};

export interface Categoria {
  value: string;
  label: string;
}

export interface ResolutionAction {
  value: string;
  label: string;
}

export interface AppConfig {
  intranetEnabled: boolean;
  categorias: Categoria[];
  resolutionActionsByCategoria: Record<string, ResolutionAction[]>;
  genericResolutionActions: ResolutionAction[];
}

export interface TerminalReport {
  terminal: string;
  total: number;
  resolved: number;
  resolvedPct: number;
  avgDaysToResolve: number | null;
}

export interface TechnicianReport {
  technicianId: string;
  name: string;
  assigned: number;
  resolved: number;
  resolvedPct: number;
  avgDaysToResolve: number | null;
}

export interface PartsUsageEntry {
  label: string;
  count: number;
}

export interface ReportSummary {
  generatedAt: string;
  totalCases: number;
  byStatus: Record<CaseStatus, number>;
  byTerminal: TerminalReport[];
  byTechnician: TechnicianReport[];
  partsUsage: PartsUsageEntry[];
}
