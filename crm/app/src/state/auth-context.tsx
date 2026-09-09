import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api,
  apiErrorMessage,
  getModule,
  loadStoredApiBaseUrl,
  loadStoredModule,
  setAuthToken,
  setModule,
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

  useEffect(() => {
    (async () => {
      try {
        await loadStoredApiBaseUrl();
        await loadStoredModule();
        setModuleState(getModule());
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const stored = JSON.parse(raw) as StoredAuth;
          setAuthToken(stored.token);
          setUser(stored.user);
        }
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
        await setModule(next);
        setModuleState(next);
      },
      async resetModule() {
        await setModule(null);
        setModuleState(null);
      },
    }),
    [user, isLoading, module],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
