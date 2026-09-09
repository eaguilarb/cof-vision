import { useMemo, useState } from 'react';
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
import { useConfig, useCreateCase, useEquipment, useTechnicians } from '@/api/hooks';
import { apiErrorMessage } from '@/api/client';
import { PRIORITY_LABELS, type CasePriority } from '@/api/types';
import { useAuth } from '@/state/auth-context';
import { colors } from '@/constants/colors';

const PRIORITIES = Object.keys(PRIORITY_LABELS) as CasePriority[];
const MAX_EQUIPMENT_RESULTS = 25;

export default function NewCaseScreen() {
  const router = useRouter();
  const { module } = useAuth();
  const configQuery = useConfig();
  const equipmentQuery = useEquipment();
  const techniciansQuery = useTechnicians();
  const createCase = useCreateCase();

  const intranetEnabled = configQuery.data?.intranetEnabled ?? false;
  // El módulo Vidrios siempre usa categoría fija + patente (no hay modo
  // "local/demo" para vidrios: depende de la flota real).
  const useFixedCategories = module === 'glass' || intranetEnabled;
  const categoriaOptions =
    module === 'glass' ? (configQuery.data?.glassCategorias ?? []) : (configQuery.data?.categorias ?? []);

  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [categoria, setCategoria] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<CasePriority>('medium');
  const [equipmentSearch, setEquipmentSearch] = useState('');
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const [technicianId, setTechnicianId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requiresFleetEquipment = module === 'tech' && (categoria === 'wifi' || categoria === 'camaras');

  const filteredEquipment = useMemo(() => {
    const all = equipmentQuery.data ?? [];
    if (!useFixedCategories) return all;
    const eligible = requiresFleetEquipment ? all.filter((eq) => eq.estandar !== 'TS') : all;
    const query = equipmentSearch.trim().toLowerCase();
    const matches = query ? eligible.filter((eq) => eq.name.toLowerCase().includes(query)) : eligible;
    return matches.slice(0, MAX_EQUIPMENT_RESULTS);
  }, [equipmentQuery.data, equipmentSearch, useFixedCategories, requiresFleetEquipment]);

  async function handleSubmit() {
    setError(null);
    if (!description.trim() || !equipmentId) {
      setError('Descripción y equipo son requeridos');
      return;
    }
    if (useFixedCategories && !categoria) {
      setError('Selecciona una categoría');
      return;
    }
    if (!useFixedCategories && (!title.trim() || !clientName.trim())) {
      setError('Título y cliente son requeridos');
      return;
    }

    try {
      const created = await createCase.mutateAsync({
        description,
        priority,
        equipmentId,
        assignedTechnicianId: technicianId,
        ...(useFixedCategories ? { categoria: categoria! } : { title, clientName }),
      });
      router.replace(`/case/${created.id}`);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!useFixedCategories && (
        <>
          <Text style={styles.label}>Título</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Resumen del problema" />
        </>
      )}

      {useFixedCategories && (
        <>
          <Text style={styles.label}>Categoría</Text>
          <View style={styles.chipRow}>
            {categoriaOptions.map((cat) => (
              <Pressable
                key={cat.value}
                style={[styles.chip, categoria === cat.value && styles.chipActive]}
                onPress={() => setCategoria(cat.value)}
              >
                <Text style={[styles.chipText, categoria === cat.value && styles.chipTextActive]}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>Descripción</Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        value={description}
        onChangeText={setDescription}
        placeholder="Detalle del problema"
        multiline
      />

      {!useFixedCategories && (
        <>
          <Text style={styles.label}>Cliente / área</Text>
          <TextInput
            style={styles.input}
            value={clientName}
            onChangeText={setClientName}
            placeholder="Ej. Contabilidad"
          />
        </>
      )}

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

      <Text style={styles.label}>{useFixedCategories ? 'Bus (patente)' : 'Equipo'}</Text>
      {requiresFleetEquipment && (
        <Text style={styles.hint}>
          Los buses estándar TS no tienen wifi ni cámaras — no aparecen en esta lista.
        </Text>
      )}
      {useFixedCategories && (
        <TextInput
          style={[styles.input, { marginBottom: 8 }]}
          value={equipmentSearch}
          onChangeText={setEquipmentSearch}
          placeholder="Busca por patente, ej. SPBP91"
          autoCapitalize="characters"
        />
      )}
      {equipmentQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <View style={styles.chipRow}>
          {filteredEquipment.map((eq) => (
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
          {filteredEquipment.length === 0 && !useFixedCategories && (
            <Text style={styles.hint}>Registra un equipo primero en la pestaña "Equipos".</Text>
          )}
          {filteredEquipment.length === 0 && useFixedCategories && (
            <Text style={styles.hint}>Sin resultados para "{equipmentSearch}".</Text>
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
