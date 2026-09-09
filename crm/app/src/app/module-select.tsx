import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/state/auth-context';
import { colors } from '@/constants/colors';
import type { AppModule } from '@/api/client';

export default function ModuleSelectScreen() {
  const router = useRouter();
  const { chooseModule } = useAuth();

  async function handleChoose(module: AppModule) {
    await chooseModule(module);
    router.replace('/(tabs)');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>COF CRM</Text>
      <Text style={styles.subtitle}>¿Qué vas a trabajar?</Text>

      <Pressable style={styles.card} onPress={() => handleChoose('tech')}>
        <Text style={styles.cardIcon}>🔧</Text>
        <Text style={styles.cardTitle}>Tecnológico</Text>
        <Text style={styles.cardDesc}>
          Discos duros, DVR, cámaras, GPS, WiFi y validadores.
        </Text>
      </Pressable>

      <Pressable style={styles.card} onPress={() => handleChoose('glass')}>
        <Text style={styles.cardIcon}>🪟</Text>
        <Text style={styles.cardTitle}>Vidrios</Text>
        <Text style={styles.cardDesc}>
          Vidrio lateral, parabrisas y vidrio de puertas.
        </Text>
      </Pressable>

      <Text style={styles.hint}>Puedes cambiar de módulo después desde Perfil.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 24,
    justifyContent: 'center',
    gap: 16,
  },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginBottom: 8 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 22,
    alignItems: 'center',
    gap: 6,
  },
  cardIcon: { fontSize: 40 },
  cardTitle: { fontSize: 19, fontWeight: '800', color: colors.text },
  cardDesc: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  hint: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 8 },
});
