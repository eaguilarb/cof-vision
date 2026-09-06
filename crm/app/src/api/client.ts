import axios from 'axios';

/**
 * URL base del backend. Hoy apunta al backend "mock" incluido en crm/backend.
 * Cuando se conecte a la intranet real, basta con definir EXPO_PUBLIC_API_URL
 * (en un .env o en la configuración de build) apuntando a esa API — no hace
 * falta tocar el resto de la app.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

export const api = axios.create({
  baseURL: API_BASE_URL,
});

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
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
