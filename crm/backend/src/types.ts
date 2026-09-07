export type Role = 'admin' | 'technician';

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
}

export interface DbShape {
  users: User[];
  technicians: Technician[];
  equipment: Equipment[];
  cases: Case[];
  caseSequence: number;
  caseOverlays: Record<string, CaseOverlay>;
}
