import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useCreateUser, useDeleteUser, useUsers } from '@/api/hooks';
import { apiErrorMessage } from '@/api/client';
import { colors } from '@/constants/colors';
import { ROLE_LABELS, type Role } from '@/api/types';
import { useAuth } from '@/state/auth-context';

const CREATABLE_ROLES: Role[] = ['operator', 'admin'];

export default function UsersScreen() {
  const { user: currentUser } = useAuth();
  const usersQuery = useUsers();
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Nombre, email y contraseña son requeridos');
      return;
    }
    try {
      await createUser.mutateAsync({ name, email, password, role });
      setName('');
      setEmail('');
      setPassword('');
      setRole('operator');
      setShowForm(false);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deleteUser.mutateAsync(id);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Usuarios</Text>
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
          <View style={styles.chipRow}>
            {CREATABLE_ROLES.map((r) => (
              <Pressable
                key={r}
                style={[styles.chip, role === r && styles.chipActive]}
                onPress={() => setRole(r)}
              >
                <Text style={[styles.chipText, role === r && styles.chipTextActive]}>{ROLE_LABELS[r]}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>
            Operador: puede ver todo y cerrar casos, sin administrar usuarios ni técnicos.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.saveButton} onPress={handleCreate} disabled={createUser.isPending}>
            <Text style={styles.saveButtonText}>{createUser.isPending ? 'Guardando…' : 'Guardar usuario'}</Text>
          </Pressable>
        </View>
      )}

      {!showForm && error ? <Text style={[styles.error, { marginHorizontal: 14 }]}>{error}</Text> : null}

      {usersQuery.isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={usersQuery.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>Aún no hay usuarios.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text style={styles.cardSubtitle}>{item.email}</Text>
                <Text style={styles.cardMeta}>{ROLE_LABELS[item.role]}</Text>
              </View>
              {item.role !== 'technician' && item.id !== currentUser?.id && (
                <Pressable style={styles.deleteButton} onPress={() => handleDelete(item.id)}>
                  <Text style={styles.deleteButtonText}>Eliminar</Text>
                </Pressable>
              )}
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: colors.primaryText },
  hint: { fontSize: 11, color: colors.textMuted },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardSubtitle: { fontSize: 13, color: colors.textMuted },
  cardMeta: { fontSize: 12, color: colors.textMuted },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40 },
  deleteButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deleteButtonText: { color: colors.danger, fontSize: 12, fontWeight: '700' },
});
