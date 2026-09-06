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
import { useLocalSearchParams } from 'expo-router';
import {
  useAddCaseNote,
  useAssignCase,
  useCase,
  useEquipment,
  useTechnicians,
  useUpdateCaseStatus,
} from '@/api/hooks';
import { apiErrorMessage } from '@/api/client';
import { PRIORITY_LABELS, STATUS_LABELS, type CaseStatus } from '@/api/types';
import { useAuth } from '@/state/auth-context';
import { colors, priorityColors, statusColors } from '@/constants/colors';
import { Badge } from '@/components/badge';

const STATUSES = Object.keys(STATUS_LABELS) as CaseStatus[];

export default function CaseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const caseQuery = useCase(id);
  const equipmentQuery = useEquipment();
  const techniciansQuery = useTechnicians();
  const updateStatus = useUpdateCaseStatus();
  const assignCase = useAssignCase();
  const addNote = useAddCaseNote();

  const [noteText, setNoteText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  if (caseQuery.isLoading || !caseQuery.data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const item = caseQuery.data;
  const equipment = equipmentQuery.data?.find((e) => e.id === item.equipmentId);
  const canManage =
    user?.role === 'admin' || (user?.role === 'technician' && user.technicianId === item.assignedTechnicianId);

  async function handleStatusChange(status: CaseStatus) {
    setActionError(null);
    try {
      await updateStatus.mutateAsync({ id: item.id, status });
    } catch (err) {
      setActionError(apiErrorMessage(err));
    }
  }

  async function handleAssign(technicianId: string | null) {
    setActionError(null);
    try {
      await assignCase.mutateAsync({ id: item.id, technicianId });
    } catch (err) {
      setActionError(apiErrorMessage(err));
    }
  }

  async function handleAddNote() {
    if (!noteText.trim()) return;
    try {
      await addNote.mutateAsync({ id: item.id, text: noteText.trim() });
      setNoteText('');
    } catch (err) {
      setActionError(apiErrorMessage(err));
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.code}>{item.code}</Text>
        <Badge label={PRIORITY_LABELS[item.priority]} color={priorityColors[item.priority]} />
      </View>
      <Text style={styles.title}>{item.title}</Text>
      <Badge label={STATUS_LABELS[item.status]} color={statusColors[item.status]} />

      <Text style={styles.sectionTitle}>Descripción</Text>
      <Text style={styles.text}>{item.description}</Text>

      <Text style={styles.sectionTitle}>Cliente</Text>
      <Text style={styles.text}>{item.clientName}</Text>

      <Text style={styles.sectionTitle}>Equipo</Text>
      <Text style={styles.text}>
        {equipment ? `${equipment.name} (${equipment.type})` : 'Cargando…'}
      </Text>

      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

      <Text style={styles.sectionTitle}>Estado</Text>
      {canManage ? (
        <View style={styles.chipRow}>
          {STATUSES.map((s) => (
            <Pressable
              key={s}
              style={[styles.chip, item.status === s && styles.chipActive]}
              onPress={() => handleStatusChange(s)}
              disabled={updateStatus.isPending}
            >
              <Text style={[styles.chipText, item.status === s && styles.chipTextActive]}>
                {STATUS_LABELS[s]}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.hint}>Solo el técnico asignado o un administrador pueden cambiar el estado.</Text>
      )}

      <Text style={styles.sectionTitle}>Técnico asignado</Text>
      {user?.role === 'admin' ? (
        <View style={styles.chipRow}>
          <Pressable
            style={[styles.chip, !item.assignedTechnicianId && styles.chipActive]}
            onPress={() => handleAssign(null)}
            disabled={assignCase.isPending}
          >
            <Text style={[styles.chipText, !item.assignedTechnicianId && styles.chipTextActive]}>
              Sin asignar
            </Text>
          </Pressable>
          {(techniciansQuery.data ?? []).map((t) => (
            <Pressable
              key={t.id}
              style={[styles.chip, item.assignedTechnicianId === t.id && styles.chipActive]}
              onPress={() => handleAssign(t.id)}
              disabled={assignCase.isPending}
            >
              <Text
                style={[styles.chipText, item.assignedTechnicianId === t.id && styles.chipTextActive]}
              >
                {t.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.text}>
          {techniciansQuery.data?.find((t) => t.id === item.assignedTechnicianId)?.name ?? 'Sin asignar'}
        </Text>
      )}

      <Text style={styles.sectionTitle}>Notas</Text>
      {item.notes.length === 0 ? (
        <Text style={styles.hint}>Sin notas todavía.</Text>
      ) : (
        item.notes.map((note) => (
          <View key={note.id} style={styles.noteCard}>
            <Text style={styles.noteAuthor}>{note.authorName}</Text>
            <Text style={styles.text}>{note.text}</Text>
          </View>
        ))
      )}

      <View style={styles.noteInputRow}>
        <TextInput
          style={styles.noteInput}
          placeholder="Agregar una nota…"
          value={noteText}
          onChangeText={setNoteText}
        />
        <Pressable style={styles.noteButton} onPress={handleAddNote} disabled={addNote.isPending}>
          <Text style={styles.noteButtonText}>Enviar</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Historial</Text>
      {[...item.history].reverse().map((entry) => (
        <Text key={entry.id} style={styles.historyLine}>
          {new Date(entry.changedAt).toLocaleString()} · {STATUS_LABELS[entry.status]} · {entry.changedBy}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  code: { fontSize: 12, color: colors.textMuted, fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 4, marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 18, marginBottom: 6 },
  text: { fontSize: 14, color: colors.text, lineHeight: 20 },
  hint: { fontSize: 12, color: colors.textMuted },
  error: { color: colors.danger, marginTop: 12, fontSize: 13 },
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
  noteCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  noteAuthor: { fontSize: 12, fontWeight: '700', color: colors.primary, marginBottom: 2 },
  noteInputRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  noteInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    fontSize: 14,
  },
  noteButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  noteButtonText: { color: '#fff', fontWeight: '700' },
  historyLine: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
});
