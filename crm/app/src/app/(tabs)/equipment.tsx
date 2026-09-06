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
import { useCreateEquipment, useEquipment } from '@/api/hooks';
import { apiErrorMessage } from '@/api/client';
import { colors } from '@/constants/colors';
import type { Equipment } from '@/api/types';

export default function EquipmentScreen() {
  const equipmentQuery = useEquipment();
  const createEquipment = useCreateEquipment();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [clientName, setClientName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    if (!name.trim() || !type.trim() || !clientName.trim()) {
      setError('Nombre, tipo y cliente son requeridos');
      return;
    }
    try {
      await createEquipment.mutateAsync({ name, type, clientName });
      setName('');
      setType('');
      setClientName('');
      setShowForm(false);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Equipos registrados</Text>
        <Pressable style={styles.addButton} onPress={() => setShowForm((v) => !v)}>
          <Text style={styles.addButtonText}>{showForm ? 'Cancelar' : '+ Agregar'}</Text>
        </Pressable>
      </View>

      {showForm && (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Nombre del equipo"
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={styles.input}
            placeholder="Tipo (ej. Impresora, Servidor)"
            value={type}
            onChangeText={setType}
          />
          <TextInput
            style={styles.input}
            placeholder="Cliente / área"
            value={clientName}
            onChangeText={setClientName}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.saveButton} onPress={handleCreate} disabled={createEquipment.isPending}>
            <Text style={styles.saveButtonText}>
              {createEquipment.isPending ? 'Guardando…' : 'Guardar equipo'}
            </Text>
          </Pressable>
        </View>
      )}

      {equipmentQuery.isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={equipmentQuery.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>Aún no hay equipos registrados.</Text>}
          renderItem={({ item }) => <EquipmentCard item={item} />}
        />
      )}
    </View>
  );
}

function EquipmentCard({ item }: { item: Equipment }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{item.name}</Text>
      <Text style={styles.cardSubtitle}>
        {item.type}
        {item.brand ? ` · ${item.brand}` : ''}
        {item.model ? ` ${item.model}` : ''}
      </Text>
      <Text style={styles.cardMeta}>Cliente: {item.clientName}</Text>
      {item.serialNumber ? <Text style={styles.cardMeta}>N/S: {item.serialNumber}</Text> : null}
      {item.location ? <Text style={styles.cardMeta}>Ubicación: {item.location}</Text> : null}
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
  listContent: { padding: 14, paddingTop: 0, gap: 10 },
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
