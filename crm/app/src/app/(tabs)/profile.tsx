import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/state/auth-context';
import { getApiBaseUrl } from '@/api/client';
import { colors } from '@/constants/colors';
import { fontFamily } from '@/constants/typography';
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
    borderRadius: 16,
    padding: 18,
    gap: 4,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  name: { fontSize: 19, fontFamily: fontFamily.extrabold, color: colors.text },
  email: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textMuted },
  role: { fontSize: 13, color: colors.primary, fontFamily: fontFamily.semibold, marginTop: 4 },
  sectionTitle: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.text },
  mono: { fontSize: 13, fontFamily: fontFamily.regular, color: colors.textMuted },
  hintText: { fontSize: 11, fontFamily: fontFamily.medium, color: colors.textMuted, marginTop: 6 },
  linkButton: { marginTop: 8 },
  linkButtonText: { color: colors.primary, fontFamily: fontFamily.bold, fontSize: 13 },
  logoutButton: {
    backgroundColor: colors.danger,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: colors.danger,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 3,
  },
  logoutText: { color: '#fff', fontFamily: fontFamily.bold, fontSize: 15 },
});
