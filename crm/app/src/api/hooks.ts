import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { api } from './client';
import type {
  AppConfig,
  AppUser,
  Case,
  CasePhoto,
  CasePriority,
  CaseStatus,
  Equipment,
  ReportSummary,
  Role,
  Technician,
} from './types';

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

export function useUploadCasePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      uri,
      fileName,
      mimeType,
    }: {
      id: string;
      uri: string;
      fileName: string;
      mimeType: string;
    }) => {
      const formData = new FormData();
      if (Platform.OS === 'web') {
        // En web el picker entrega un blob:/data: URI real — hay que
        // convertirlo a Blob; el truco {uri,name,type} de abajo solo lo
        // entiende el shim de red de React Native (Android/iOS).
        const blob = await (await fetch(uri)).blob();
        formData.append('photo', blob, fileName);
      } else {
        // React Native's FormData accepts this {uri,name,type} shape for
        // files (it isn't a real Blob/File, but RN's networking layer
        // knows how to read it) — see https://reactnative.dev/docs/network#uploading-files.
        formData.append('photo', { uri, name: fileName, type: mimeType } as unknown as Blob);
      }
      // No content-type header here on purpose: both the browser and RN's
      // networking layer set multipart/form-data with the right boundary
      // automatically from the FormData body — setting it ourselves
      // without a boundary breaks the request.
      return (await api.post<CasePhoto>(`/cases/${id}/photos`, formData)).data;
    },
    onSuccess: (_photo, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cases', variables.id] });
    },
  });
}

export function useReportSummary() {
  return useQuery({
    queryKey: ['reports', 'summary'],
    queryFn: async () => (await api.get<ReportSummary>('/reports/summary')).data,
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get<AppUser[]>('/users')).data,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; email: string; password: string; role: Role }) =>
      (await api.post<AppUser>('/users', input)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeleteCasePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, photoId }: { id: string; photoId: string }) =>
      api.delete(`/cases/${id}/photos/${photoId}`),
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cases', variables.id] });
    },
  });
}
