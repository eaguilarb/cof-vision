import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api,
  apiErrorMessage,
  getModule,
  loadStoredModule,
  setAuthToken,
  setModule,
  setUnauthorizedHandler,
  type AppModule,
} from '@/api/client';
import type { AuthUser } from '@/api/types';

const STORAGE_KEY = 'crm.auth';

interface StoredAuth {
  token: string;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  module: AppModule | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  chooseModule: (module: AppModule) => Promise<void>;
  resetModule: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [module, setModuleState] = useState<AppModule | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthToken(null);
      setUser(null);
      queryClient.clear();
      AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
      router.replace('/login');
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  useEffect(() => {
    (async () => {
      try {
        await loadStoredModule();
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const stored = JSON.parse(raw) as StoredAuth;
          setAuthToken(stored.token);
          setUser(stored.user);
          if (stored.user.assignedModule && getModule() !== stored.user.assignedModule) {
            await setModule(stored.user.assignedModule);
          }
        }
        setModuleState(getModule());
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      module,
      async login(email: string, password: string) {
        try {
          const { data } = await api.post('/auth/login', { email, password });
          setAuthToken(data.token);
          setUser(data.user);
          await AsyncStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ token: data.token, user: data.user } satisfies StoredAuth),
          );
          // Un técnico o vidriero con módulo fijo no elige módulo: queda
          // directo en el suyo, sin pasar por la pantalla de selección.
          if (data.user.assignedModule) {
            await setModule(data.user.assignedModule);
            setModuleState(data.user.assignedModule);
          }
        } catch (error) {
          throw new Error(apiErrorMessage(error, 'No se pudo iniciar sesión'));
        }
      },
      async logout() {
        setAuthToken(null);
        setUser(null);
        await AsyncStorage.removeItem(STORAGE_KEY);
      },
      async chooseModule(next: AppModule) {
        if (user?.assignedModule) return;
        await setModule(next);
        setModuleState(next);
      },
      async resetModule() {
        if (user?.assignedModule) return;
        await setModule(null);
        setModuleState(null);
      },
    }),
    [user, isLoading, module],
  );

  // Las pantallas no se muestran hasta recuperar la sesión guardada: si
  // no, al abrir o recargar directo una página (ej. /case/new) las
  // consultas salían sin token y la pantalla quedaba vacía.
  return <AuthContext.Provider value={value}>{isLoading ? null : children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
