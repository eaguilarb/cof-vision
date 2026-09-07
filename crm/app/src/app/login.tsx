import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/state/auth-context';
import { getApiBaseUrl, getDefaultApiBaseUrl, setApiBaseUrl } from '@/api/client';
import { colors } from '@/constants/colors';

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showServerField, setShowServerField] = useState(false);
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl());
  const [serverSaved, setServerSaved] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const isDefaultServer = getApiBaseUrl() === getDefaultApiBaseUrl();

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSaveServer() {
    setServerError(null);
    if (!/^https?:\/\/.+/.test(serverUrl.trim())) {
      setServerError('La URL debe empezar con http:// o https://');
      return;
    }
    await setApiBaseUrl(serverUrl);
    setServerSaved(true);
    setShowServerField(false);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>COF CRM</Text>
        <Text style={styles.subtitle}>Reparación de equipamiento tecnológico</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="tucorreo@empresa.com"
        />

        <Text style={styles.label}>Contraseña</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, isSubmitting && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={styles.buttonText}>Entrar</Text>
          )}
        </Pressable>

        <View style={styles.serverBox}>
          {showServerField ? (
            <>
              <Text style={styles.serverLabel}>URL del servidor</Text>
              <TextInput
                style={styles.serverInput}
                value={serverUrl}
                onChangeText={setServerUrl}
                placeholder="https://tu-backend.up.railway.app"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              {serverError ? <Text style={styles.error}>{serverError}</Text> : null}
              <View style={styles.serverButtonRow}>
                <Pressable
                  style={[styles.smallButton, styles.smallButtonSecondary]}
                  onPress={() => {
                    setServerUrl(getApiBaseUrl());
                    setServerError(null);
                    setShowServerField(false);
                  }}
                >
                  <Text style={styles.smallButtonSecondaryText}>Cancelar</Text>
                </Pressable>
                <Pressable style={styles.smallButton} onPress={handleSaveServer}>
                  <Text style={styles.smallButtonText}>Guardar</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Pressable onPress={() => setShowServerField(true)}>
              <Text style={styles.serverCurrent}>
                Servidor: <Text style={styles.serverCurrentValue}>{getApiBaseUrl()}</Text>
              </Text>
              <Text style={styles.linkText}>Cambiar servidor</Text>
            </Pressable>
          )}
          {serverSaved && !showServerField && (
            <Text style={styles.serverSavedHint}>Guardado. Ya puedes iniciar sesión.</Text>
          )}
          {isDefaultServer && !showServerField && !serverSaved && (
            <Text style={styles.hint}>
              Este es el servidor de prueba de la app — probablemente necesites cambiarlo por el
              real antes de entrar.
            </Text>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.background,
  },
  error: {
    color: colors.danger,
    marginTop: 12,
    fontSize: 13,
  },
  button: {
    marginTop: 20,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: colors.primaryText,
    fontWeight: '700',
    fontSize: 15,
  },
  hint: {
    marginTop: 8,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
  serverBox: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  serverCurrent: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
  serverCurrentValue: {
    fontWeight: '600',
    color: colors.text,
  },
  linkText: {
    marginTop: 4,
    fontSize: 12,
    color: colors.primary,
    fontWeight: '700',
    textAlign: 'center',
  },
  serverLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  serverInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    backgroundColor: colors.background,
    color: colors.text,
  },
  serverButtonRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  smallButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  smallButtonText: { color: colors.primaryText, fontWeight: '700', fontSize: 13 },
  smallButtonSecondary: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  smallButtonSecondaryText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  serverSavedHint: {
    marginTop: 8,
    fontSize: 12,
    color: colors.success,
    textAlign: 'center',
    fontWeight: '600',
  },
});
