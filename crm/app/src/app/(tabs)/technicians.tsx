import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDeleteTechnician, useEquipment, useTechnicians, useUpdateTechnician } from '@/api/hooks';
import { api, apiErrorMessage } from '@/api/client';
import { colors } from '@/constants/colors';
import { fontFamily } from '@/constants/typography';
import type { Technician } from '@/api/types';

export default function TechniciansScreen() {
  const techniciansQuery = useTechnicians();
  const equipmentQuery = useEquipment();
  const queryClient = useQueryClient();
  const createTechnician = useMutation({
    mutationFn: async (input: {
      name: string;
      email: string;
      password: string;
      specialty?: string;
      assignedModule?: 'tech' | 'glass';
    }) => (await api.post<Technician>('/technicians', input)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['technicians'] }),
  });
  const deleteTechnician = useDeleteTechnician();
  const updateTechnician = useUpdateTechnician();

  const terminals = useMemo(() => {
    const set = new Set<string>();
    for (const eq of equipmentQuery.data ?? []) set.add(eq.clientName);
    return Array.from(set).sort();
  }, [equipmentQuery.data]);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [module, setModule] = useState<'tech' | 'glass' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTerminals, setEditTerminals] = useState<string[]>([]);
  const [editModule, setEditModule] = useState<'tech' | 'glass' | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Nombre, email y contraseña son requeridos');
      return;
    }
    try {
      await createTechnician.mutateAsync({
        name,
        email,
        password,
        specialty: specialty || undefined,
        assignedModule: module ?? undefined,
      });
      setName('');
      setEmail('');
      setPassword('');
      setSpecialty('');
      setModule(null);
      setShowForm(false);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  function startEdit(technician: Technician) {
    setEditingId(technician.id);
    setEditTerminals(technician.assignedTerminals ?? []);
    setEditModule(technician.assignedModule ?? null);
    setEditPassword('');
    setEditError(null);
  }

  function toggleEditTerminal(terminal: string) {
    setEditTerminals((prev) =>
      prev.includes(terminal) ? prev.filter((t) => t !== terminal) : [...prev, terminal],
    );
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setEditError(null);
    try {
      await updateTechnician.mutateAsync({
        id: editingId,
        assignedTerminals: editTerminals,
        assignedModule: editModule,
        ...(editPassword.trim() ? { password: editPassword.trim() } : {}),
      });
      setEditingId(null);
    } catch (err) {
      setEditError(apiErrorMessage(err));
    }
  }

  async function handleDelete(technician: Technician) {
    const message = `¿Eliminar a ${technician.name}? Sus casos asignados quedarán sin asignar.`;
    const confirmed =
      Platform.OS === 'web'
        ? window.confirm(message)
        : await new Promise<boolean>((resolve) => {
            Alert.alert('Eliminar técnico', message, [
              { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Eliminar', style: 'destructive', onPress: () => resolve(true) },
            ]);
          });
    if (!confirmed) return;

    setError(null);
    try {
      await deleteTechnician.mutateAsync(technician.id);
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
          <Text style={styles.hint}>
            Módulo al que queda restringido — un técnico no debe ver Vidrios, ni un vidriero
            Tecnológico. Sin selección = ve ambos (no recomendado salvo admin/supervisor).
          </Text>
          <View style={styles.chipRow}>
            {(['tech', 'glass'] as const).map((m) => (
              <Pressable
                key={m}
                style={[styles.terminalChip, module === m && styles.terminalChipActive]}
                onPress={() => setModule((prev) => (prev === m ? null : m))}
              >
                <Text style={[styles.terminalChipText, module === m && styles.terminalChipTextActive]}>
                  {m === 'tech' ? 'Tecnológico' : 'Vidrios'}
                </Text>
              </Pressable>
            ))}
          </View>
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
          renderItem={({ item }) =>
            editingId === item.id ? (
              <View style={styles.form}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text style={styles.hint}>
                  Módulo al que queda restringido — un técnico no debe ver Vidrios, ni un vidriero
                  Tecnológico.
                </Text>
                <View style={styles.chipRow}>
                  {(['tech', 'glass'] as const).map((m) => (
                    <Pressable
                      key={m}
                      style={[styles.terminalChip, editModule === m && styles.terminalChipActive]}
                      onPress={() => setEditModule((prev) => (prev === m ? null : m))}
                    >
                      <Text
                        style={[styles.terminalChipText, editModule === m && styles.terminalChipTextActive]}
                      >
                        {m === 'tech' ? 'Tecnológico' : 'Vidrios'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.hint}>
                  Terminales que puede ver y procesar. Sin selección = sin restricción (ve todos).
                </Text>
                <View style={styles.chipRow}>
                  {terminals.map((t) => (
                    <Pressable
                      key={t}
                      style={[styles.terminalChip, editTerminals.includes(t) && styles.terminalChipActive]}
                      onPress={() => toggleEditTerminal(t)}
                    >
                      <Text
                        style={[
                          styles.terminalChipText,
                          editTerminals.includes(t) && styles.terminalChipTextActive,
                        ]}
                      >
                        {t}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Nueva contraseña (dejar vacío para no cambiar)"
                  value={editPassword}
                  onChangeText={setEditPassword}
                  secureTextEntry
                />
                {editError ? <Text style={styles.error}>{editError}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable
                    style={[styles.saveButton, { flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }]}
                    onPress={() => setEditingId(null)}
                  >
                    <Text style={[styles.saveButtonText, { color: colors.text }]}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.saveButton, { flex: 1 }]}
                    onPress={handleSaveEdit}
                    disabled={updateTechnician.isPending}
                  >
                    <Text style={styles.saveButtonText}>
                      {updateTechnician.isPending ? 'Guardando…' : 'Guardar'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={[styles.card, styles.cardRow]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.cardSubtitle}>{item.email}</Text>
                  {item.specialty ? <Text style={styles.cardMeta}>{item.specialty}</Text> : null}
                  {item.phone ? <Text style={styles.cardMeta}>{item.phone}</Text> : null}
                  <Text style={[styles.cardMeta, { color: item.active ? colors.success : colors.danger }]}>
                    {item.active ? 'Activo' : 'Inactivo'}
                  </Text>
                  <Text style={[styles.cardMeta, !item.assignedModule && { color: colors.danger }]}>
                    {item.assignedModule
                      ? `Módulo: ${item.assignedModule === 'tech' ? 'Tecnológico' : 'Vidrios'}`
                      : 'Sin módulo asignado (ve ambos)'}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {item.assignedTerminals && item.assignedTerminals.length > 0
                      ? `Terminales: ${item.assignedTerminals.join(', ')}`
                      : 'Sin restricción de terminal'}
                  </Text>
                </View>
                <View style={{ gap: 6 }}>
                  <Pressable style={styles.editButton} onPress={() => startEdit(item)}>
                    <Text style={styles.editButtonText}>Editar</Text>
                  </Pressable>
                  <Pressable
                    style={styles.deleteButton}
                    onPress={() => handleDelete(item)}
                    disabled={deleteTechnician.isPending}
                  >
                    <Text style={styles.deleteButtonText}>Eliminar</Text>
                  </Pressable>
                </View>
              </View>
            )
          }
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
  headerTitle: { fontSize: 20, fontFamily: fontFamily.extrabold, color: colors.text, letterSpacing: -0.3 },
  addButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  addButtonText: { color: colors.primaryText, fontFamily: fontFamily.semibold, fontSize: 13 },
  form: {
    backgroundColor: colors.surface,
    marginHorizontal: 14,
    marginBottom: 10,
    padding: 16,
    borderRadius: 16,
    gap: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
    fontFamily: fontFamily.regular,
    backgroundColor: colors.background,
  },
  error: { color: colors.danger, fontSize: 12, fontFamily: fontFamily.medium },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  saveButtonText: { color: colors.primaryText, fontFamily: fontFamily.bold },
  listContent: { padding: 14, paddingTop: 0 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    gap: 2,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  cardTitle: { fontSize: 15, fontFamily: fontFamily.bold, color: colors.text },
  cardSubtitle: { fontSize: 13, fontFamily: fontFamily.medium, color: colors.textMuted },
  cardMeta: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textMuted },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontFamily: fontFamily.medium },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  deleteButton: {
    backgroundColor: `${colors.danger}14`,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deleteButtonText: { color: colors.danger, fontSize: 12, fontFamily: fontFamily.semibold },
  editButton: {
    backgroundColor: `${colors.primary}14`,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  editButtonText: { color: colors.primary, fontSize: 12, fontFamily: fontFamily.semibold },
  hint: { fontSize: 11, fontFamily: fontFamily.medium, color: colors.textMuted },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  terminalChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.background,
  },
  terminalChipActive: { backgroundColor: colors.primary },
  terminalChipText: { fontSize: 12, color: colors.text, fontFamily: fontFamily.semibold },
  terminalChipTextActive: { color: colors.primaryText },
});
