import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useCases, useConfig, useCreateEquipment, useEquipment } from '@/api/hooks';
import { apiErrorMessage } from '@/api/client';
import { colors, statusColors } from '@/constants/colors';
import { STATUS_LABELS, type CaseStatus, type Equipment } from '@/api/types';
import { Badge } from '@/components/badge';

const STATUS_ORDER = Object.keys(STATUS_LABELS) as CaseStatus[];

// Colores llamativos y distintos por terminal, para diferenciarlos de un
// vistazo — no tienen significado propio (a diferencia de statusColors).
const TERMINAL_ACCENTS = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444'];

interface TerminalGroup {
  terminal: string;
  accent: string;
  equipment: Equipment[];
  statusCounts: Record<CaseStatus, number>;
  totalCases: number;
}

export default function EquipmentScreen() {
  const configQuery = useConfig();
  const equipmentQuery = useEquipment();
  const casesQuery = useCases({});
  const createEquipment = useCreateEquipment();
  const intranetEnabled = configQuery.data?.intranetEnabled ?? false;

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [clientName, setClientName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const all = equipmentQuery.data ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return all;
    return all.filter(
      (eq) => eq.name.toLowerCase().includes(query) || eq.clientName.toLowerCase().includes(query),
    );
  }, [equipmentQuery.data, search]);

  const terminalGroups = useMemo<TerminalGroup[]>(() => {
    const equipmentList = equipmentQuery.data ?? [];
    const cases = casesQuery.data ?? [];

    const casesByEquipmentId = new Map<string, CaseStatus[]>();
    for (const c of cases) {
      const list = casesByEquipmentId.get(c.equipmentId) ?? [];
      list.push(c.status);
      casesByEquipmentId.set(c.equipmentId, list);
    }

    const groups = new Map<string, TerminalGroup>();
    for (const eq of equipmentList) {
      const terminal = eq.clientName || 'Sin terminal';
      if (!groups.has(terminal)) {
        groups.set(terminal, {
          terminal,
          accent: TERMINAL_ACCENTS[groups.size % TERMINAL_ACCENTS.length],
          equipment: [],
          statusCounts: { open: 0, assigned: 0, in_progress: 0, resolved: 0 },
          totalCases: 0,
        });
      }
      const group = groups.get(terminal)!;
      group.equipment.push(eq);
      for (const status of casesByEquipmentId.get(eq.id) ?? []) {
        group.statusCounts[status] += 1;
        group.totalCases += 1;
      }
    }

    return Array.from(groups.values()).sort((a, b) => b.equipment.length - a.equipment.length);
  }, [equipmentQuery.data, casesQuery.data]);

  function toggleExpanded(terminal: string) {
    setExpanded((prev) => ({ ...prev, [terminal]: !prev[terminal] }));
  }

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

  const isSearching = search.trim().length > 0;
  const isLoading = equipmentQuery.isLoading || casesQuery.isLoading;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{intranetEnabled ? 'Flota' : 'Equipos registrados'}</Text>
        {!intranetEnabled && (
          <Pressable style={styles.addButton} onPress={() => setShowForm((v) => !v)}>
            <Text style={styles.addButtonText}>{showForm ? 'Cancelar' : '+ Agregar'}</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder={intranetEnabled ? 'Buscar por patente o terminal…' : 'Buscar equipo…'}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="characters"
        />
      </View>

      {showForm && !intranetEnabled && (
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

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : isSearching ? (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>Sin resultados.</Text>}
          renderItem={({ item }) => <EquipmentCard item={item} />}
        />
      ) : (
        <FlatList
          data={terminalGroups}
          keyExtractor={(g) => g.terminal}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>Aún no hay equipos registrados.</Text>}
          renderItem={({ item }) => (
            <TerminalCard
              group={item}
              isExpanded={!!expanded[item.terminal]}
              onToggle={() => toggleExpanded(item.terminal)}
              unitLabel={intranetEnabled ? { singular: 'bus', plural: 'buses' } : { singular: 'equipo', plural: 'equipos' }}
            />
          )}
        />
      )}
    </View>
  );
}

function TerminalCard({
  group,
  isExpanded,
  onToggle,
  unitLabel,
}: {
  group: TerminalGroup;
  isExpanded: boolean;
  onToggle: () => void;
  unitLabel: { singular: string; plural: string };
}) {
  return (
    <View style={[styles.terminalCard, { borderLeftColor: group.accent }]}>
      <Pressable style={styles.terminalHeader} onPress={onToggle}>
        <View style={{ flex: 1 }}>
          <Text style={styles.terminalName}>{group.terminal}</Text>
          <Text style={styles.terminalMeta}>
            {group.equipment.length} {group.equipment.length === 1 ? unitLabel.singular : unitLabel.plural}
            {group.totalCases > 0 ? ` · ${group.totalCases} caso${group.totalCases === 1 ? '' : 's'}` : ''}
          </Text>
        </View>
        <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
      </Pressable>

      <View style={styles.statusPillRow}>
        {STATUS_ORDER.map((status) =>
          group.statusCounts[status] > 0 ? (
            <Badge
              key={status}
              label={`${STATUS_LABELS[status]}: ${group.statusCounts[status]}`}
              color={statusColors[status]}
            />
          ) : null,
        )}
        {group.totalCases === 0 && <Text style={styles.noCasesHint}>Sin casos activos</Text>}
      </View>

      {isExpanded && (
        <View style={styles.busList}>
          {group.equipment.map((eq) => (
            <View key={eq.id} style={styles.busRow}>
              <Text style={styles.busName}>{eq.name}</Text>
              <Text style={styles.busMeta}>
                {eq.type}
                {eq.brand ? ` · ${eq.brand}` : ''}
                {eq.model ? ` ${eq.model}` : ''}
              </Text>
            </View>
          ))}
        </View>
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
      <Text style={styles.cardMeta}>Terminal: {item.clientName}</Text>
      {item.serialNumber ? <Text style={styles.cardMeta}>N/S: {item.serialNumber}</Text> : null}
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
    paddingBottom: 8,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  addButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: { color: colors.primaryText, fontWeight: '600', fontSize: 13 },
  searchWrap: { paddingHorizontal: 14, paddingBottom: 10 },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: colors.surface,
  },
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

  terminalCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 5,
    marginBottom: 10,
    padding: 14,
    gap: 10,
  },
  terminalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  terminalName: { fontSize: 16, fontWeight: '800', color: colors.text },
  terminalMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 12, color: colors.textMuted },
  statusPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  noCasesHint: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  busList: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    gap: 8,
  },
  busRow: { gap: 1 },
  busName: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  busMeta: { fontSize: 12, color: colors.textMuted },
});
