import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

/**
 * URL fija del backend de producción. No es configurable desde la app —
 * a diferencia de una versión anterior, no se puede editar desde Perfil
 * ni queda guardada en el dispositivo, para evitar que alguien apunte la
 * app a un servidor distinto (por error o con intención maliciosa, ej.
 * para capturar credenciales de técnicos/vidrieros).
 *
 * Servidor propio (ya no Railway): la página web y la API van en la misma
 * dirección; Caddy manda /api/* al backend y lo demás a la página.
 */
const API_BASE_URL = 'https://crm.40-160-97-216.sslip.io/api';

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

/**
 * Sesión vencida o inválida (el token dura 7 días): antes la app seguía
 * "logeada" pero cada pantalla quedaba vacía sin explicación (sin
 * categorías, "Sin resultados" en patentes). Ahora se cierra la sesión y
 * se vuelve al login — ver AuthProvider.
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      authToken &&
      !error.config?.url?.includes('/auth/login')
    ) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

export function apiErrorMessage(error: unknown, fallback = 'Ocurrió un error inesperado'): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error ?? error.message ?? fallback;
  }
  return fallback;
}
