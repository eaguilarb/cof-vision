import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCreateCase, useEquipment, useTechnicians } from '@/api/hooks';
import { apiErrorMessage } from '@/api/client';
import { PRIORITY_LABELS, type CasePriority } from '@/api/types';
import { colors } from '@/constants/colors';

const PRIORITIES = Object.keys(PRIORITY_LABELS) as CasePriority[];

export default function NewCaseScreen() {
  const router = useRouter();
  const equipmentQuery = useEquipment();
  const techniciansQuery = useTechnicians();
  const createCase = useCreateCase();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clientName, setClientName] = useState('');
  const [priority, setPriority] = useState<CasePriority>('medium');
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const [technicianId, setTechnicianId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!title.trim() || !description.trim() || !clientName.trim() || !equipmentId) {
      setError('Título, descripción, cliente y equipo son requeridos');
      return;
    }
    try {
      const created = await createCase.mutateAsync({
        title,
        description,
        clientName,
        priority,
        equipmentId,
        assignedTechnicianId: technicianId,
      });
      router.replace(`/case/${created.id}`);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Título</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Resumen del problema" />

      <Text style={styles.label}>Descripción</Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        value={description}
        onChangeText={setDescription}
        placeholder="Detalle del problema"
        multiline
      />

      <Text style={styles.label}>Cliente / área</Text>
      <TextInput style={styles.input} value={clientName} onChangeText={setClientName} placeholder="Ej. Contabilidad" />

      <Text style={styles.label}>Prioridad</Text>
      <View style={styles.chipRow}>
        {PRIORITIES.map((p) => (
          <Pressable
            key={p}
            style={[styles.chip, priority === p && styles.chipActive]}
            onPress={() => setPriority(p)}
          >
            <Text style={[styles.chipText, priority === p && styles.chipTextActive]}>
              {PRIORITY_LABELS[p]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Equipo</Text>
      {equipmentQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <View style={styles.chipRow}>
          {(equipmentQuery.data ?? []).map((eq) => (
            <Pressable
              key={eq.id}
              style={[styles.chip, equipmentId === eq.id && styles.chipActive]}
              onPress={() => setEquipmentId(eq.id)}
            >
              <Text style={[styles.chipText, equipmentId === eq.id && styles.chipTextActive]}>
                {eq.name}
              </Text>
            </Pressable>
          ))}
          {(equipmentQuery.data ?? []).length === 0 && (
            <Text style={styles.hint}>Registra un equipo primero en la pestaña "Equipos".</Text>
          )}
        </View>
      )}

      <Text style={styles.label}>Técnico asignado (opcional)</Text>
      <View style={styles.chipRow}>
        <Pressable
          style={[styles.chip, technicianId === null && styles.chipActive]}
          onPress={() => setTechnicianId(null)}
        >
          <Text style={[styles.chipText, technicianId === null && styles.chipTextActive]}>
            Sin asignar
          </Text>
        </Pressable>
        {(techniciansQuery.data ?? []).map((t) => (
          <Pressable
            key={t.id}
            style={[styles.chip, technicianId === t.id && styles.chipActive]}
            onPress={() => setTechnicianId(t.id)}
          >
            <Text style={[styles.chipText, technicianId === t.id && styles.chipTextActive]}>
              {t.name}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.submitButton} onPress={handleSubmit} disabled={createCase.isPending}>
        {createCase.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitText}>Crear caso</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 4 },
  label: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: colors.surface,
  },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: colors.primaryText },
  hint: { fontSize: 12, color: colors.textMuted },
  error: { color: colors.danger, marginTop: 14, fontSize: 13 },
  submitButton: {
    marginTop: 24,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
