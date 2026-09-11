import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/state/auth-context';
import { colors } from '@/constants/colors';
import { fontFamily } from '@/constants/typography';
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

      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => handleChoose('tech')}
      >
        <Text style={styles.cardIcon}>🔧</Text>
        <Text style={styles.cardTitle}>Tecnológico</Text>
        <Text style={styles.cardDesc}>
          Discos duros, DVR, cámaras, GPS, WiFi y validadores.
        </Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => handleChoose('glass')}
      >
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
  title: { fontSize: 28, fontFamily: fontFamily.extrabold, color: colors.text, textAlign: 'center', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, fontFamily: fontFamily.medium, color: colors.textMuted, textAlign: 'center', marginBottom: 8 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 6,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  cardPressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
  cardIcon: { fontSize: 40 },
  cardTitle: { fontSize: 19, fontFamily: fontFamily.extrabold, color: colors.text },
  cardDesc: { fontSize: 13, fontFamily: fontFamily.medium, color: colors.textMuted, textAlign: 'center' },
  hint: { fontSize: 12, fontFamily: fontFamily.medium, color: colors.textMuted, textAlign: 'center', marginTop: 8 },
});
