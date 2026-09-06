import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/state/auth-context';
import { API_BASE_URL } from '@/api/client';
import { colors } from '@/constants/colors';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.role}>
          {user?.role === 'admin' ? 'Administrador' : 'Técnico'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Backend conectado</Text>
        <Text style={styles.mono}>{API_BASE_URL}</Text>
        <Text style={styles.hintText}>
          Configura EXPO_PUBLIC_API_URL para apuntar esta app a la API real de tu intranet.
        </Text>
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
  logoutButton: {
    backgroundColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  logoutText: { color: '#fff', fontWeight: '700' },
});
