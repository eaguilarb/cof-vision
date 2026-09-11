import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useConfig, useCreateCase, useEquipment, useTechnicians, useUploadCasePhoto } from '@/api/hooks';
import { apiErrorMessage } from '@/api/client';
import { PRIORITY_LABELS, type CasePriority } from '@/api/types';
import { useAuth } from '@/state/auth-context';
import { colors } from '@/constants/colors';
import { fontFamily } from '@/constants/typography';
import { BusGlassDiagram, type GlassZone } from '@/components/bus-glass-diagram';
import { PressableScale } from '@/components/pressable-scale';

const PRIORITIES = Object.keys(PRIORITY_LABELS) as CasePriority[];
const MAX_EQUIPMENT_RESULTS = 25;

interface PendingPhoto {
  uri: string;
  fileName: string;
  mimeType: string;
}

export default function NewCaseScreen() {
  const router = useRouter();
  const { module } = useAuth();
  const configQuery = useConfig();
  const equipmentQuery = useEquipment();
  const techniciansQuery = useTechnicians();
  const createCase = useCreateCase();
  const uploadPhoto = useUploadCasePhoto();

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
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
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

  const selectedEquipment = useMemo(
    () => equipmentQuery.data?.find((eq) => eq.id === equipmentId),
    [equipmentQuery.data, equipmentId],
  );

  function handleSelectZone(zone: GlassZone) {
    setCategoria(zone.categoria);
    setDescription((prev) => (prev.trim() ? prev : `${zone.label}: `));
  }

  async function handlePickPhoto(source: 'camera' | 'library') {
    setError(null);
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(source === 'camera' ? 'Necesitamos permiso para usar la cámara.' : 'Necesitamos permiso para ver tus fotos.');
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
    const result =
      source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPhotos((prev) => [
      ...prev,
      { uri: asset.uri, fileName: asset.fileName || `foto-${Date.now()}.jpg`, mimeType: asset.mimeType || 'image/jpeg' },
    ]);
  }

  function handleRemovePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

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
      for (const photo of photos) {
        try {
          await uploadPhoto.mutateAsync({ id: created.id, ...photo });
        } catch {
          // El caso ya se creó; si una foto falla al subir, se puede reintentar desde el detalle.
        }
      }
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

      {module === 'glass' && (
        <>
          <Text style={styles.label}>Diagrama del bus</Text>
          <BusGlassDiagram
            onSelectZone={handleSelectZone}
            ppu={selectedEquipment?.name}
            busModel={selectedEquipment?.model}
          />
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
          style={[styles.input, { marginBottom: 8, marginTop: 4 }]}
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
      {selectedEquipment && (selectedEquipment.brand || selectedEquipment.model) && (
        <Text style={styles.hint}>
          Modelo: {[selectedEquipment.brand, selectedEquipment.model].filter(Boolean).join(' ')}
          {module === 'glass' ? ' — confirma el modelo antes de retirar el vidrio del stock.' : ''}
        </Text>
      )}

      <Text style={styles.label}>Fotos</Text>
      <View style={styles.photoRow}>
        {photos.map((photo, index) => (
          <View key={photo.uri} style={styles.photoThumbWrap}>
            <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
            <Pressable style={styles.photoRemoveButton} onPress={() => handleRemovePhoto(index)}>
              <Text style={styles.photoRemoveButtonText}>✕</Text>
            </Pressable>
          </View>
        ))}
        <Pressable style={styles.photoAddButton} onPress={() => handlePickPhoto('camera')}>
          <Text style={styles.photoAddButtonText}>📷{'\n'}Cámara</Text>
        </Pressable>
        <Pressable style={styles.photoAddButton} onPress={() => handlePickPhoto('library')}>
          <Text style={styles.photoAddButtonText}>🖼️{'\n'}Galería</Text>
        </Pressable>
      </View>

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

      <PressableScale style={styles.submitButton} onPress={handleSubmit} disabled={createCase.isPending}>
        {createCase.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitText}>Crear caso</Text>
        )}
      </PressableScale>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 4 },
  label: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.text, marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fontFamily.regular,
    backgroundColor: colors.surface,
  },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, fontFamily: fontFamily.semibold },
  chipTextActive: { color: colors.primaryText },
  hint: { fontSize: 12, fontFamily: fontFamily.medium, color: colors.textMuted },
  error: { color: colors.danger, marginTop: 14, fontSize: 13, fontFamily: fontFamily.medium },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoThumbWrap: { position: 'relative' },
  photoThumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: colors.border },
  photoRemoveButton: {
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
  photoRemoveButtonText: { color: '#fff', fontSize: 11, fontFamily: fontFamily.bold },
  photoAddButton: {
    width: 64,
    height: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAddButtonText: { fontSize: 11, color: colors.textMuted, textAlign: 'center', fontFamily: fontFamily.semibold },
  submitButton: {
    marginTop: 24,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 3,
  },
  submitText: { color: '#fff', fontFamily: fontFamily.bold, fontSize: 15 },
});
