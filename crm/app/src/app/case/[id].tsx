import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  useAddCaseNote,
  useAssignCase,
  useCase,
  useConfig,
  useDeleteCase,
  useDeleteCasePhoto,
  useEquipment,
  useTechnicians,
  useUpdateCasePriority,
  useUpdateCaseStatus,
  useUploadCasePhoto,
} from '@/api/hooks';
import { apiErrorMessage, getCasePhotoUrl } from '@/api/client';
import { PRIORITY_LABELS, STATUS_LABELS, type CasePriority, type CaseStatus } from '@/api/types';
import { useAuth } from '@/state/auth-context';
import { colors, priorityColors, statusColors } from '@/constants/colors';
import { Badge } from '@/components/badge';
import { AuthImage } from '@/components/auth-image';

const STATUSES = Object.keys(STATUS_LABELS) as CaseStatus[];
const PRIORITIES = Object.keys(PRIORITY_LABELS) as CasePriority[];

export default function CaseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, module } = useAuth();
  const caseQuery = useCase(id);
  const configQuery = useConfig();
  const equipmentQuery = useEquipment();
  const techniciansQuery = useTechnicians();
  const updateStatus = useUpdateCaseStatus();
  const updatePriority = useUpdateCasePriority();
  const assignCase = useAssignCase();
  const addNote = useAddCaseNote();
  const uploadPhoto = useUploadCasePhoto();
  const deletePhoto = useDeleteCasePhoto();
  const deleteCase = useDeleteCase();

  const [noteText, setNoteText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolveAction, setResolveAction] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');
  const [resolveError, setResolveError] = useState<string | null>(null);

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
    user?.role === 'admin' ||
    user?.role === 'operator' ||
    (user?.role === 'technician' && user.technicianId === item.assignedTechnicianId);
  const dayWord = (n: number) => (n === 1 ? 'día' : 'días');
  const ageLabel =
    item.status === 'resolved'
      ? item.resolvedInDays === 0
        ? 'Resuelto hoy'
        : `Resuelto en ${item.resolvedInDays} ${dayWord(item.resolvedInDays!)}`
      : item.daysOpen === 0
        ? 'Abierto hoy'
        : `${item.daysOpen} ${dayWord(item.daysOpen)} abierto`;

  // El primer evento del historial es siempre la creación del caso (lo
  // registra el CRM al crearlo); si el caso viene de antes de usar el CRM
  // o se creó directo en la intranet, no hay ese registro y mostramos el
  // dato crudo de la intranet como respaldo.
  const createdByLabel = item.history[0]?.changedBy || item.createdBy;
  const resolvedEntry = [...item.history].reverse().find((h) => h.status === 'resolved');
  const closedByLabel = item.status === 'resolved' ? resolvedEntry?.changedBy : undefined;

  const resolutionActions =
    module === 'glass'
      ? configQuery.data?.glassResolutionActions ?? []
      : (item.categoria && configQuery.data?.resolutionActionsByCategoria[item.categoria]) ||
        configQuery.data?.genericResolutionActions ||
        [];
  const resolutionActionLabel = resolutionActions.find((a) => a.value === item.resolutionAction)?.label;

  async function handleStatusChange(status: CaseStatus) {
    if (status === 'resolved') {
      setResolveAction(null);
      setResolveNotes('');
      setResolveError(null);
      setShowResolveModal(true);
      return;
    }
    setActionError(null);
    try {
      await updateStatus.mutateAsync({ id: item.id, status });
    } catch (err) {
      setActionError(apiErrorMessage(err));
    }
  }

  async function handleConfirmResolve() {
    if (!resolveAction) {
      setResolveError('Selecciona qué se hizo para resolver el caso.');
      return;
    }
    setResolveError(null);
    try {
      await updateStatus.mutateAsync({
        id: item.id,
        status: 'resolved',
        resolutionAction: resolveAction,
        resolutionNotes: resolveNotes.trim() || undefined,
      });
      setShowResolveModal(false);
    } catch (err) {
      setResolveError(apiErrorMessage(err));
    }
  }

  async function handlePriorityChange(priority: CasePriority) {
    setActionError(null);
    try {
      await updatePriority.mutateAsync({ id: item.id, priority });
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

  async function handleAddPhoto(source: 'camera' | 'library') {
    setActionError(null);
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setActionError(
        source === 'camera' ? 'Necesitamos permiso para usar la cámara.' : 'Necesitamos permiso para ver tus fotos.',
      );
      return;
    }

    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
    const result =
      source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    try {
      await uploadPhoto.mutateAsync({
        id: item.id,
        uri: asset.uri,
        fileName: asset.fileName || `foto-${Date.now()}.jpg`,
        mimeType: asset.mimeType || 'image/jpeg',
      });
    } catch (err) {
      setActionError(apiErrorMessage(err));
    }
  }

  async function handleDeletePhoto(photoId: string) {
    setActionError(null);
    try {
      await deletePhoto.mutateAsync({ id: item.id, photoId });
    } catch (err) {
      setActionError(apiErrorMessage(err));
    }
  }

  async function handleDeleteCase() {
    const message = `¿Eliminar el caso ${item.code} definitivamente? Esta acción no se puede deshacer.`;
    const confirmed =
      Platform.OS === 'web'
        ? window.confirm(message)
        : await new Promise<boolean>((resolve) => {
            Alert.alert('Eliminar caso', message, [
              { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Eliminar', style: 'destructive', onPress: () => resolve(true) },
            ]);
          });
    if (!confirmed) return;

    setActionError(null);
    try {
      await deleteCase.mutateAsync(item.id);
      router.back();
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
      <View style={styles.headerRow}>
        <Badge label={STATUS_LABELS[item.status]} color={statusColors[item.status]} />
        <Text style={styles.ageText}>{ageLabel}</Text>
      </View>

      <Text style={styles.metaLine}>Creado por: {createdByLabel}</Text>
      {closedByLabel && <Text style={styles.metaLine}>Cerrado por: {closedByLabel}</Text>}

      {item.status === 'resolved' && resolutionActionLabel && (
        <View style={styles.resolutionBox}>
          <Text style={styles.resolutionTitle}>Detalle de la reparación</Text>
          <Text style={styles.text}>{resolutionActionLabel}</Text>
          {item.resolutionNotes && <Text style={styles.text}>{item.resolutionNotes}</Text>}
        </View>
      )}

      <Text style={styles.sectionTitle}>Descripción</Text>
      <Text style={styles.text}>{item.description}</Text>

      <Text style={styles.sectionTitle}>Cliente / Terminal</Text>
      <Text style={styles.text}>{item.clientName}</Text>

      <Text style={styles.sectionTitle}>Equipo</Text>
      <Text style={styles.text}>
        {equipment ? `${equipment.name} (${equipment.type})` : 'Cargando…'}
      </Text>
      {equipment && (equipment.brand || equipment.model) && (
        <Text style={styles.hint}>
          Modelo: {[equipment.brand, equipment.model].filter(Boolean).join(' ')}
          {module === 'glass' ? ' — revisa el modelo antes de retirar el vidrio del stock.' : ''}
        </Text>
      )}

      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

      <Text style={styles.sectionTitle}>Fotos</Text>
      <View style={styles.photoRow}>
        {item.photos.map((photo) => {
          const uri = getCasePhotoUrl(item.id, photo.id);
          return (
            <View key={photo.id} style={styles.photoThumbWrap}>
              <Pressable onPress={() => setViewingPhotoUrl(uri)}>
                <AuthImage uri={uri} style={styles.photoThumb} />
              </Pressable>
              {user?.role === 'admin' && (
                <Pressable style={styles.photoDeleteBadge} onPress={() => handleDeletePhoto(photo.id)}>
                  <Text style={styles.photoDeleteText}>✕</Text>
                </Pressable>
              )}
            </View>
          );
        })}
        <Pressable
          style={styles.photoAddButton}
          onPress={() => handleAddPhoto('camera')}
          disabled={uploadPhoto.isPending}
        >
          <Text style={styles.photoAddIcon}>📷</Text>
        </Pressable>
        <Pressable
          style={styles.photoAddButton}
          onPress={() => handleAddPhoto('library')}
          disabled={uploadPhoto.isPending}
        >
          <Text style={styles.photoAddIcon}>🖼️</Text>
        </Pressable>
        {uploadPhoto.isPending && <ActivityIndicator color={colors.primary} />}
      </View>

      <Modal visible={!!viewingPhotoUrl} transparent onRequestClose={() => setViewingPhotoUrl(null)}>
        <Pressable style={styles.photoModalBackdrop} onPress={() => setViewingPhotoUrl(null)}>
          {viewingPhotoUrl && <AuthImage uri={viewingPhotoUrl} style={styles.photoModalImage} />}
        </Pressable>
      </Modal>

      <Modal visible={showResolveModal} transparent animationType="fade" onRequestClose={() => setShowResolveModal(false)}>
        <View style={styles.resolveModalBackdrop}>
          <View style={styles.resolveModalCard}>
            <Text style={styles.resolveModalTitle}>Cerrar caso {item.code}</Text>
            <Text style={styles.hint}>¿Qué se hizo para resolverlo? Esto queda registrado para el control de repuestos.</Text>
            <View style={[styles.chipRow, { marginTop: 10 }]}>
              {resolutionActions.map((a) => (
                <Pressable
                  key={a.value}
                  style={[styles.chip, resolveAction === a.value && styles.chipActive]}
                  onPress={() => setResolveAction(a.value)}
                >
                  <Text style={[styles.chipText, resolveAction === a.value && styles.chipTextActive]}>
                    {a.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={[styles.noteInput, { marginTop: 12 }]}
              placeholder="Detalle adicional (opcional)"
              value={resolveNotes}
              onChangeText={setResolveNotes}
              multiline
            />
            {resolveError && <Text style={styles.error}>{resolveError}</Text>}
            <View style={styles.resolveModalActions}>
              <Pressable style={styles.resolveCancelButton} onPress={() => setShowResolveModal(false)}>
                <Text style={styles.resolveCancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={styles.resolveConfirmButton}
                onPress={handleConfirmResolve}
                disabled={updateStatus.isPending}
              >
                <Text style={styles.resolveConfirmButtonText}>
                  {updateStatus.isPending ? 'Guardando…' : 'Cerrar caso'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Text style={styles.sectionTitle}>Prioridad</Text>
      <View style={styles.chipRow}>
        {PRIORITIES.map((p) => (
          <Pressable
            key={p}
            style={[styles.chip, item.priority === p && styles.chipActive]}
            onPress={() => handlePriorityChange(p)}
            disabled={updatePriority.isPending}
          >
            <Text style={[styles.chipText, item.priority === p && styles.chipTextActive]}>
              {PRIORITY_LABELS[p]}
            </Text>
          </Pressable>
        ))}
      </View>

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
        <Text style={styles.hint}>Solo el técnico asignado, un administrador o un operador pueden cambiar el estado.</Text>
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

      {user?.role === 'admin' && (
        <Pressable
          style={styles.deleteCaseButton}
          onPress={handleDeleteCase}
          disabled={deleteCase.isPending}
        >
          <Text style={styles.deleteCaseButtonText}>
            {deleteCase.isPending ? 'Eliminando…' : '🗑️ Eliminar caso'}
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ageText: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  metaLine: { fontSize: 12.5, color: colors.textMuted, marginTop: 6, fontWeight: '600' },
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
  deleteCaseButton: {
    marginTop: 28,
    borderWidth: 1.5,
    borderColor: colors.danger,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  deleteCaseButtonText: { color: colors.danger, fontWeight: '700', fontSize: 14 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  photoThumbWrap: { position: 'relative' },
  photoThumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoDeleteBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoDeleteText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  photoAddButton: {
    width: 72,
    height: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  photoAddIcon: { fontSize: 22 },
  photoModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoModalImage: { width: '100%', height: '80%', resizeMode: 'contain' },
  resolutionBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: statusColors.resolved,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    gap: 2,
  },
  resolutionTitle: { fontSize: 12, fontWeight: '700', color: statusColors.resolved, marginBottom: 2 },
  resolveModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  resolveModalCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 18,
    width: '100%',
    maxWidth: 420,
  },
  resolveModalTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 6 },
  resolveModalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  resolveCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  resolveCancelButtonText: { color: colors.text, fontWeight: '700' },
  resolveConfirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  resolveConfirmButtonText: { color: '#fff', fontWeight: '700' },
});
