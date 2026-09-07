import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

/**
 * URL base del backend. El valor compilado (EXPO_PUBLIC_API_URL, o
 * localhost:4000 si no se definió) es solo el default inicial — se puede
 * cambiar dentro de la app (pantalla Perfil) sin recompilar, por ejemplo
 * cuando el backend pase de correr en tu red local a estar desplegado en
 * Railway. El valor elegido se guarda en el dispositivo.
 */
const DEFAULT_API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
const STORAGE_KEY = 'cof-crm.apiBaseUrl';

export const api = axios.create({
  baseURL: DEFAULT_API_BASE_URL,
});

export function getApiBaseUrl(): string {
  return api.defaults.baseURL as string;
}

export function getDefaultApiBaseUrl(): string {
  return DEFAULT_API_BASE_URL;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  const trimmed = url.trim().replace(/\/+$/, '');
  api.defaults.baseURL = trimmed;
  await AsyncStorage.setItem(STORAGE_KEY, trimmed);
}

export async function loadStoredApiBaseUrl(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) api.defaults.baseURL = stored;
  } catch {
    // Sin storage disponible: nos quedamos con el default compilado.
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Para pedir imágenes (React Native <Image source={{ uri, headers }}>). */
export function getAuthHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

export function getCasePhotoUrl(caseId: string, photoId: string): string {
  return `${getApiBaseUrl()}/cases/${caseId}/photos/${photoId}`;
}

api.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

export function apiErrorMessage(error: unknown, fallback = 'Ocurrió un error inesperado'): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error ?? error.message ?? fallback;
  }
  return fallback;
}
