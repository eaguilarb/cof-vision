import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/state/auth-context';
import { getApiBaseUrl, getDefaultApiBaseUrl, setApiBaseUrl } from '@/api/client';
import { colors } from '@/constants/colors';
import { ROLE_LABELS } from '@/api/types';

const MODULE_LABELS = { tech: 'Tecnológico', glass: 'Vidrios' } as const;

export default function ProfileScreen() {
  const { user, logout, module, resetModule } = useAuth();
  const router = useRouter();

  const [serverUrl, setServerUrl] = useState(getApiBaseUrl());
  const [editingServer, setEditingServer] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  async function handleChangeModule() {
    await resetModule();
    router.replace('/module-select');
  }

  async function handleSaveServer() {
    setServerError(null);
    if (!/^https?:\/\/.+/.test(serverUrl.trim())) {
      setServerError('La URL debe empezar con http:// o https://');
      return;
    }
    setIsSaving(true);
    try {
      await setApiBaseUrl(serverUrl);
      setEditingServer(false);
      // El token de sesión pertenece al backend anterior: hay que volver a entrar.
      await logout();
      router.replace('/login');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.role}>{user ? ROLE_LABELS[user.role] : ''}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Módulo</Text>
        <Text style={styles.mono}>{module ? MODULE_LABELS[module] : '—'}</Text>
        {user?.assignedModule ? (
          <Text style={styles.hintText}>Tu cuenta está asignada solo a este módulo.</Text>
        ) : (
          <Pressable style={styles.linkButton} onPress={handleChangeModule}>
            <Text style={styles.linkButtonText}>Cambiar módulo</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Servidor</Text>
        {editingServer ? (
          <>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="https://tu-backend.up.railway.app"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            {serverError ? <Text style={styles.error}>{serverError}</Text> : null}
            <Text style={styles.hintText}>
              Al guardar se cierra la sesión actual (el backend nuevo no conoce este token).
            </Text>
            <View style={styles.buttonRow}>
              <Pressable
                style={[styles.smallButton, styles.smallButtonSecondary]}
                onPress={() => {
                  setServerUrl(getApiBaseUrl());
                  setServerError(null);
                  setEditingServer(false);
                }}
              >
                <Text style={styles.smallButtonSecondaryText}>Cancelar</Text>
              </Pressable>
              <Pressable style={styles.smallButton} onPress={handleSaveServer} disabled={isSaving}>
                {isSaving ? (
                  <ActivityIndicator color={colors.primaryText} />
                ) : (
                  <Text style={styles.smallButtonText}>Guardar y salir</Text>
                )}
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.mono}>{getApiBaseUrl()}</Text>
            {getApiBaseUrl() === getDefaultApiBaseUrl() && (
              <Text style={styles.hintText}>
                Este es el servidor de prueba incluido en la app. Cámbialo cuando tengas el backend
                desplegado (ej. en Railway).
              </Text>
            )}
            <Pressable style={styles.linkButton} onPress={() => setEditingServer(true)}>
              <Text style={styles.linkButtonText}>Cambiar servidor</Text>
            </Pressable>
          </>
        )}
      </View>

      <Pressable style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Cerrar sesión</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 14 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  name: { fontSize: 18, fontWeight: '700', color: colors.text },
  email: { fontSize: 13, color: colors.textMuted },
  role: { fontSize: 13, color: colors.primary, fontWeight: '600', marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  mono: { fontSize: 13, color: colors.textMuted },
  hintText: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    marginTop: 4,
    backgroundColor: colors.background,
    color: colors.text,
  },
  error: { color: colors.danger, fontSize: 12, marginTop: 6 },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  smallButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  smallButtonText: { color: colors.primaryText, fontWeight: '700', fontSize: 13 },
  smallButtonSecondary: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  smallButtonSecondaryText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  linkButton: { marginTop: 8 },
  linkButtonText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  logoutButton: {
    backgroundColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  logoutText: { color: '#fff', fontWeight: '700' },
});
