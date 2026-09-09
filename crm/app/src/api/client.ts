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
