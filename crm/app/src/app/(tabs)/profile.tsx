import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/state/auth-context';
import { getApiBaseUrl } from '@/api/client';
import { colors } from '@/constants/colors';
import { ROLE_LABELS } from '@/api/types';

const MODULE_LABELS = { tech: 'Tecnológico', glass: 'Vidrios' } as const;

export default function ProfileScreen() {
  const { user, logout, module, resetModule } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  async function handleChangeModule() {
    await resetModule();
    router.replace('/module-select');
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
        <Text style={styles.mono}>{getApiBaseUrl()}</Text>
        <Text style={styles.hintText}>Servidor fijo de producción — no se puede cambiar desde la app.</Text>
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
