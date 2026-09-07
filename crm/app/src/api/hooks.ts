import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { AppConfig, Case, CasePriority, CaseStatus, Equipment, Technician } from './types';

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: async () => (await api.get<AppConfig>('/config')).data,
    staleTime: Infinity,
  });
}

export function useTechnicians() {
  return useQuery({
    queryKey: ['technicians'],
    queryFn: async () => (await api.get<Technician[]>('/technicians')).data,
  });
}

export function useEquipment() {
  return useQuery({
    queryKey: ['equipment'],
    queryFn: async () => (await api.get<Equipment[]>('/equipment')).data,
  });
}

export function useCreateEquipment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      type: string;
      clientName: string;
      brand?: string;
      model?: string;
      serialNumber?: string;
      location?: string;
    }) => (await api.post<Equipment>('/equipment', input)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['equipment'] }),
  });
}

export interface CaseFilters {
  status?: CaseStatus;
  mine?: boolean;
}

export function useCases(filters: CaseFilters = {}) {
  return useQuery({
    queryKey: ['cases', filters],
    queryFn: async () =>
      (
        await api.get<Case[]>('/cases', {
          params: {
            status: filters.status,
            mine: filters.mine ? 'true' : undefined,
          },
        })
      ).data,
  });
}

export function useCase(id: string | undefined) {
  return useQuery({
    queryKey: ['cases', id],
    queryFn: async () => (await api.get<Case>(`/cases/${id}`)).data,
    enabled: !!id,
  });
}

export function useCreateCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      description: string;
      equipmentId: string;
      priority: CasePriority;
      assignedTechnicianId?: string | null;
      // Modo intranet real: categoría fija en vez de título libre.
      categoria?: string;
      // Modo local/demo (sin intranet conectada).
      title?: string;
      clientName?: string;
    }) => (await api.post<Case>('/cases', input)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cases'] }),
  });
}

export function useAssignCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, technicianId }: { id: string; technicianId: string | null }) =>
      (await api.patch<Case>(`/cases/${id}/assign`, { technicianId })).data,
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.setQueryData(['cases', updated.id], updated);
    },
  });
}

export function useUpdateCaseStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CaseStatus }) =>
      (await api.patch<Case>(`/cases/${id}/status`, { status })).data,
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.setQueryData(['cases', updated.id], updated);
    },
  });
}

export function useUpdateCasePriority() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, priority }: { id: string; priority: CasePriority }) =>
      (await api.patch<Case>(`/cases/${id}/priority`, { priority })).data,
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.setQueryData(['cases', updated.id], updated);
    },
  });
}

export function useAddCaseNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) =>
      (await api.post(`/cases/${id}/notes`, { text })).data,
    onSuccess: (_note, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cases', variables.id] });
    },
  });
}
