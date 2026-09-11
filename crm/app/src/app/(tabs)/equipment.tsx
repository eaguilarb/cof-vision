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
import { fontFamily } from '@/constants/typography';
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
  resolvedPct: number;
  operationalCount: number;
  nonOperationalCount: number;
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
          resolvedPct: 0,
          operationalCount: 0,
          nonOperationalCount: 0,
        });
      }
      const group = groups.get(terminal)!;
      group.equipment.push(eq);
      if (eq.operational === false) group.nonOperationalCount += 1;
      else group.operationalCount += 1;
      for (const status of casesByEquipmentId.get(eq.id) ?? []) {
        group.statusCounts[status] += 1;
        group.totalCases += 1;
      }
    }

    for (const group of groups.values()) {
      group.resolvedPct =
        group.totalCases > 0 ? Math.round((group.statusCounts.resolved / group.totalCases) * 100) : 0;
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

  const fleetStatus = useMemo(() => {
    const list = equipmentQuery.data ?? [];
    const nonOperational = list.filter((eq) => eq.operational === false).length;
    return { total: list.length, operational: list.length - nonOperational, nonOperational };
  }, [equipmentQuery.data]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>{intranetEnabled ? 'Flota' : 'Equipos registrados'}</Text>
          {!isLoading && (
            <Text style={styles.headerCount}>
              {equipmentQuery.data?.length ?? 0} {intranetEnabled ? 'buses' : 'equipos'} ·{' '}
              {casesQuery.data?.length ?? 0} casos
            </Text>
          )}
        </View>
        {!intranetEnabled && (
          <Pressable style={styles.addButton} onPress={() => setShowForm((v) => !v)}>
            <Text style={styles.addButtonText}>{showForm ? 'Cancelar' : '+ Agregar'}</Text>
          </Pressable>
        )}
      </View>

      {!isLoading && fleetStatus.total > 0 && (
        <View style={styles.fleetStatusRow}>
          <View style={[styles.fleetStatusCard, { backgroundColor: `${colors.success}12` }]}>
            <Text style={[styles.fleetStatusCount, { color: colors.success }]}>{fleetStatus.operational}</Text>
            <Text style={styles.fleetStatusLabel}>Operativos</Text>
          </View>
          <View style={[styles.fleetStatusCard, { backgroundColor: `${colors.danger}12` }]}>
            <Text style={[styles.fleetStatusCount, { color: colors.danger }]}>{fleetStatus.nonOperational}</Text>
            <Text style={styles.fleetStatusLabel}>No operativos</Text>
          </View>
        </View>
      )}

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
      <Pressable style={styles.terminalHeader} onPress={onToggle} hitSlop={6}>
        <View style={{ flex: 1 }}>
          <Text style={styles.terminalName}>{group.terminal}</Text>
          <Text style={styles.terminalMeta}>
            {group.equipment.length} {group.equipment.length === 1 ? unitLabel.singular : unitLabel.plural}
            {group.totalCases > 0 ? ` · ${group.totalCases} caso${group.totalCases === 1 ? '' : 's'}` : ''}
            {group.nonOperationalCount > 0
              ? ` · ${group.nonOperationalCount} no operativo${group.nonOperationalCount === 1 ? '' : 's'}`
              : ''}
          </Text>
        </View>
        <View style={styles.expandButton}>
          <Text style={styles.expandButtonText}>{isExpanded ? 'Ocultar' : 'Ver buses'}</Text>
          <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
        </View>
      </Pressable>

      {group.totalCases > 0 && (
        <View style={styles.performanceRow}>
          <View style={styles.performanceBarTrack}>
            <View
              style={[
                styles.performanceBarFill,
                { width: `${group.resolvedPct}%`, backgroundColor: group.accent },
              ]}
            />
          </View>
          <Text style={[styles.performancePct, { color: group.accent }]}>{group.resolvedPct}% resuelto</Text>
        </View>
      )}

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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={styles.busName}>{eq.name}</Text>
                {eq.estandar && <Badge label={eq.estandar} color={eq.estandar === 'TS' ? '#f97316' : '#0ea5e9'} />}
                {eq.operational === false && <Badge label="No operativo" color={colors.danger} />}
              </View>
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
  headerTitle: { fontSize: 20, fontFamily: fontFamily.extrabold, color: colors.text, letterSpacing: -0.3 },
  headerCount: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: fontFamily.semibold },
  addButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  addButtonText: { color: colors.primaryText, fontFamily: fontFamily.semibold, fontSize: 13 },
  fleetStatusRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingBottom: 10 },
  fleetStatusCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  fleetStatusCount: { fontSize: 22, fontFamily: fontFamily.extrabold },
  fleetStatusLabel: { fontSize: 11, color: colors.textMuted, fontFamily: fontFamily.semibold, marginTop: 2 },
  searchWrap: { paddingHorizontal: 14, paddingBottom: 10 },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fontFamily.regular,
    backgroundColor: colors.surface,
  },
  form: {
    backgroundColor: colors.surface,
    marginHorizontal: 14,
    marginBottom: 10,
    padding: 14,
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
  listContent: { padding: 14, paddingTop: 0, gap: 10 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    gap: 3,
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

  terminalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderLeftWidth: 4,
    marginBottom: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  terminalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  terminalName: { fontSize: 16, fontFamily: fontFamily.bold, color: colors.text },
  terminalMeta: { fontSize: 12, fontFamily: fontFamily.medium, color: colors.textMuted, marginTop: 2 },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.background,
  },
  expandButtonText: { fontSize: 12, fontFamily: fontFamily.semibold, color: colors.primary },
  chevron: { fontSize: 11, color: colors.primary },
  performanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  performanceBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  performanceBarFill: { height: '100%', borderRadius: 4 },
  performancePct: { fontSize: 12, fontFamily: fontFamily.bold, minWidth: 78, textAlign: 'right' },
  statusPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  noCasesHint: { fontSize: 12, fontFamily: fontFamily.medium, color: colors.textMuted, fontStyle: 'italic' },
  busList: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    gap: 8,
  },
  busRow: { gap: 1 },
  busName: { fontSize: 13.5, fontFamily: fontFamily.bold, color: colors.text },
  busMeta: { fontSize: 12, fontFamily: fontFamily.regular, color: colors.textMuted },
});
