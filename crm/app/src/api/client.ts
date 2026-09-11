import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

/**
 * URL fija del backend de producción. No es configurable desde la app —
 * a diferencia de una versión anterior, no se puede editar desde Perfil
 * ni queda guardada en el dispositivo, para evitar que alguien apunte la
 * app a un servidor distinto (por error o con intención maliciosa, ej.
 * para capturar credenciales de técnicos/vidrieros).
 */
const API_BASE_URL = 'https://cof-crm-backend-production.up.railway.app';

export const api = axios.create({
  baseURL: API_BASE_URL,
});

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Para pedir imágenes (React Native <Image source={{ uri, headers }}>). */
export function getAuthHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

/**
 * Módulo activo: "tech" (equipamiento tecnológico, el CRM original) o
 * "glass" (vidrios) — mismo backend, distinta colección de casos
 * (/cases vs /glass-cases). Se elige una vez tras el login (ver
 * app/module-select.tsx) y se recuerda en el dispositivo.
 */
export type AppModule = 'tech' | 'glass';
const MODULE_STORAGE_KEY = 'cof-crm.module';
let currentModule: AppModule | null = null;

export function getModule(): AppModule | null {
  return currentModule;
}

export async function setModule(module: AppModule | null): Promise<void> {
  currentModule = module;
  if (module) await AsyncStorage.setItem(MODULE_STORAGE_KEY, module);
  else await AsyncStorage.removeItem(MODULE_STORAGE_KEY);
}

export async function loadStoredModule(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(MODULE_STORAGE_KEY);
    if (stored === 'tech' || stored === 'glass') currentModule = stored;
  } catch {
    // Sin storage disponible: se pedirá elegir de nuevo.
  }
}

export function casesBasePath(): string {
  return getModule() === 'glass' ? '/glass-cases' : '/cases';
}

export function getCasePhotoUrl(caseId: string, photoId: string): string {
  return `${getApiBaseUrl()}${casesBasePath()}/${caseId}/photos/${photoId}`;
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
