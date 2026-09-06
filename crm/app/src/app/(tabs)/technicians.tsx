import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTechnicians } from '@/api/hooks';
import { api, apiErrorMessage } from '@/api/client';
import { colors } from '@/constants/colors';
import type { Technician } from '@/api/types';

export default function TechniciansScreen() {
  const techniciansQuery = useTechnicians();
  const queryClient = useQueryClient();
  const createTechnician = useMutation({
    mutationFn: async (input: { name: string; email: string; password: string; specialty?: string }) =>
      (await api.post<Technician>('/technicians', input)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['technicians'] }),
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Nombre, email y contraseña son requeridos');
      return;
    }
    try {
      await createTechnician.mutateAsync({ name, email, password, specialty: specialty || undefined });
      setName('');
      setEmail('');
      setPassword('');
      setSpecialty('');
      setShowForm(false);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Técnicos</Text>
        <Pressable style={styles.addButton} onPress={() => setShowForm((v) => !v)}>
          <Text style={styles.addButtonText}>{showForm ? 'Cancelar' : '+ Agregar'}</Text>
        </Pressable>
      </View>

      {showForm && (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder="Nombre" value={name} onChangeText={setName} />
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Contraseña temporal"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TextInput
            style={styles.input}
            placeholder="Especialidad (opcional)"
            value={specialty}
            onChangeText={setSpecialty}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.saveButton} onPress={handleCreate} disabled={createTechnician.isPending}>
            <Text style={styles.saveButtonText}>
              {createTechnician.isPending ? 'Guardando…' : 'Guardar técnico'}
            </Text>
          </Pressable>
        </View>
      )}

      {techniciansQuery.isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={techniciansQuery.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>Aún no hay técnicos registrados.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardSubtitle}>{item.email}</Text>
              {item.specialty ? <Text style={styles.cardMeta}>{item.specialty}</Text> : null}
              {item.phone ? <Text style={styles.cardMeta}>{item.phone}</Text> : null}
              <Text style={[styles.cardMeta, { color: item.active ? colors.success : colors.danger }]}>
                {item.active ? 'Activo' : 'Inactivo'}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  addButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: { color: colors.primaryText, fontWeight: '600', fontSize: 13 },
  form: {
    backgroundColor: colors.surface,
    marginHorizontal: 14,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: colors.background,
  },
  error: { color: colors.danger, fontSize: 12 },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveButtonText: { color: colors.primaryText, fontWeight: '700' },
  listContent: { padding: 14, paddingTop: 0 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    gap: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardSubtitle: { fontSize: 13, color: colors.textMuted },
  cardMeta: { fontSize: 12, color: colors.textMuted },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40 },
});
