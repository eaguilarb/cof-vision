export type Role = 'admin' | 'technician';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  technicianId: string | null;
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

export interface AppConfig {
  intranetEnabled: boolean;
  categorias: Categoria[];
}
