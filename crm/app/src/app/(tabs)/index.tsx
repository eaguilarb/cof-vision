import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCases, useTechnicians } from '@/api/hooks';
import { STATUS_LABELS, type Case, type CaseStatus, type Technician } from '@/api/types';
import { useAuth } from '@/state/auth-context';
import { colors, statusColors } from '@/constants/colors';
import { fontFamily } from '@/constants/typography';
import { CaseListItem } from '@/components/case-list-item';
import { Badge } from '@/components/badge';
import { StatusDonut } from '@/components/status-donut';
import { PressableScale } from '@/components/pressable-scale';

const STATUS_ORDER = Object.keys(STATUS_LABELS) as CaseStatus[];
const TERMINAL_ACCENTS = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444'];

type StatusFilter = CaseStatus | 'all';

interface TerminalGroup {
  terminal: string;
  accent: string;
  cases: Case[];
  counts: Record<CaseStatus, number>;
}

export default function CasesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [onlyMine, setOnlyMine] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [terminalFilter, setTerminalFilter] = useState<Record<string, StatusFilter>>({});

  // Trae todos los casos (sin filtrar por estado) para poder desglosarlos
  // por terminal y contar cada estado nosotros mismos.
  const casesQuery = useCases({ mine: onlyMine });
  const techniciansQuery = useTechnicians();

  const isLoading = casesQuery.isLoading || techniciansQuery.isLoading;
  const allCases = useMemo(() => casesQuery.data ?? [], [casesQuery.data]);
  const total = allCases.length;

  const statusCounts = useMemo(() => {
    const counts: Record<CaseStatus, number> = { open: 0, assigned: 0, in_progress: 0, resolved: 0 };
    for (const c of allCases) counts[c.status] += 1;
    return counts;
  }, [allCases]);

  const heroEnter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isLoading) {
      Animated.timing(heroEnter, {
        toValue: 1,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [isLoading, heroEnter]);
  const heroStyle = {
    opacity: heroEnter,
    transform: [{ translateY: heroEnter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  };

  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return allCases.filter(
      (c) =>
        c.code.toLowerCase().includes(query) ||
        c.title.toLowerCase().includes(query) ||
        c.clientName.toLowerCase().includes(query) ||
        c.equipmentId.toLowerCase().includes(query),
    );
  }, [allCases, search]);

  const terminalGroups = useMemo<TerminalGroup[]>(() => {
    const groups = new Map<string, TerminalGroup>();
    for (const c of allCases) {
      const terminal = c.clientName || 'Sin terminal';
      if (!groups.has(terminal)) {
        groups.set(terminal, {
          terminal,
          accent: TERMINAL_ACCENTS[groups.size % TERMINAL_ACCENTS.length],
          cases: [],
          counts: { open: 0, assigned: 0, in_progress: 0, resolved: 0 },
        });
      }
      const group = groups.get(terminal)!;
      group.cases.push(c);
      group.counts[c.status] += 1;
    }
    return Array.from(groups.values()).sort((a, b) => b.cases.length - a.cases.length);
  }, [allCases]);

  function toggleExpanded(terminal: string) {
    setExpanded((prev) => ({ ...prev, [terminal]: !prev[terminal] }));
  }

  function setFilterFor(terminal: string, value: StatusFilter) {
    setTerminalFilter((prev) => ({ ...prev, [terminal]: value }));
    setExpanded((prev) => ({ ...prev, [terminal]: true }));
  }

  const isSearching = search.trim().length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Casos</Text>
        {!isLoading && (
          <Text style={styles.headerCount}>
            {total} {total === 1 ? 'caso' : 'casos'}
          </Text>
        )}
      </View>

      {!isLoading && total > 0 && (
        <Animated.View style={[styles.heroCard, heroStyle]}>
          <StatusDonut
            total={total}
            segments={STATUS_ORDER.map((s) => ({ key: s, value: statusCounts[s], color: statusColors[s] }))}
          />
          <View style={styles.heroLegend}>
            {STATUS_ORDER.map((s) => (
              <View key={s} style={styles.heroLegendRow}>
                <View style={[styles.heroDot, { backgroundColor: statusColors[s] }]} />
                <Text style={styles.heroLegendLabel}>{STATUS_LABELS[s]}</Text>
                <Text style={[styles.heroLegendValue, { color: statusColors[s] }]}>{statusCounts[s]}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      )}

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por código, patente o terminal…"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="characters"
        />
      </View>

      {user?.role === 'technician' && (
        <Pressable
          style={[styles.mineToggle, onlyMine && styles.mineToggleActive]}
          onPress={() => setOnlyMine((v) => !v)}
        >
          <Text style={[styles.mineToggleText, onlyMine && styles.mineToggleTextActive]}>
            {onlyMine ? '✓ Solo mis casos' : 'Solo mis casos'}
          </Text>
        </Pressable>
      )}

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : isSearching ? (
        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>Sin resultados para "{search}".</Text>}
          renderItem={({ item }) => (
            <CaseListItem item={item} technicians={techniciansQuery.data ?? []} />
          )}
        />
      ) : (
        <FlatList
          data={terminalGroups}
          keyExtractor={(g) => g.terminal}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={casesQuery.isFetching} onRefresh={casesQuery.refetch} />
          }
          ListEmptyComponent={<Text style={styles.empty}>Aún no hay casos.</Text>}
          renderItem={({ item, index }) => (
            <TerminalCasesCard
              index={index}
              group={item}
              isExpanded={!!expanded[item.terminal]}
              onToggle={() => toggleExpanded(item.terminal)}
              filter={terminalFilter[item.terminal] ?? 'all'}
              onFilterChange={(v) => setFilterFor(item.terminal, v)}
              technicians={techniciansQuery.data ?? []}
            />
          )}
        />
      )}

      <PressableScale style={styles.fab} onPress={() => router.push('/case/new')}>
        <Text style={styles.fabText}>+ Nuevo caso</Text>
      </PressableScale>
    </View>
  );
}

function TerminalCasesCard({
  group,
  isExpanded,
  onToggle,
  filter,
  onFilterChange,
  technicians,
  index,
}: {
  group: TerminalGroup;
  isExpanded: boolean;
  onToggle: () => void;
  filter: StatusFilter;
  onFilterChange: (v: StatusFilter) => void;
  technicians: Technician[];
  index: number;
}) {
  const filteredCases = filter === 'all' ? group.cases : group.cases.filter((c) => c.status === filter);

  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 380,
      delay: Math.min(index, 6) * 55,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter, index]);
  const enterStyle = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
  };

  return (
    <Animated.View style={[styles.terminalCard, { borderLeftColor: group.accent }, enterStyle]}>
      <Pressable style={styles.terminalHeader} onPress={onToggle} hitSlop={6}>
        <View style={{ flex: 1 }}>
          <Text style={styles.terminalName}>{group.terminal}</Text>
          <Text style={styles.terminalMeta}>
            {group.cases.length} caso{group.cases.length === 1 ? '' : 's'}
          </Text>
        </View>
        <View style={styles.expandButton}>
          <Text style={styles.expandButtonText}>{isExpanded ? 'Ocultar' : 'Ver casos'}</Text>
          <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
        </View>
      </Pressable>

      <View style={styles.statusPillRow}>
        {STATUS_ORDER.map((status) =>
          group.counts[status] > 0 ? (
            <Pressable key={status} onPress={() => onFilterChange(filter === status ? 'all' : status)}>
              <Badge
                label={`${STATUS_LABELS[status]}: ${group.counts[status]}`}
                color={statusColors[status]}
              />
            </Pressable>
          ) : null,
        )}
      </View>

      {isExpanded && (
        <>
          <View style={styles.miniChipRow}>
            <Pressable
              style={[styles.miniChip, filter === 'all' && styles.miniChipActive]}
              onPress={() => onFilterChange('all')}
            >
              <Text style={[styles.miniChipText, filter === 'all' && styles.miniChipTextActive]}>Todos</Text>
            </Pressable>
            {STATUS_ORDER.map((status) => (
              <Pressable
                key={status}
                style={[styles.miniChip, filter === status && styles.miniChipActive]}
                onPress={() => onFilterChange(status)}
              >
                <Text style={[styles.miniChipText, filter === status && styles.miniChipTextActive]}>
                  {STATUS_LABELS[status]}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.terminalCaseList}>
            {filteredCases.length === 0 ? (
              <Text style={styles.noCasesHint}>Sin casos con este filtro.</Text>
            ) : (
              filteredCases.map((c) => <CaseListItem key={c.id} item={c} technicians={technicians} />)
            )}
          </View>
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 6,
    backgroundColor: colors.surface,
  },
  headerTitle: { fontSize: 20, fontFamily: fontFamily.extrabold, color: colors.text, letterSpacing: -0.3 },
  headerCount: { fontSize: 13, fontFamily: fontFamily.semibold, color: colors.textMuted },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    backgroundColor: colors.surface,
    marginHorizontal: 14,
    marginTop: 4,
    marginBottom: 4,
    padding: 18,
    borderRadius: 20,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 3,
  },
  heroLegend: { flex: 1, gap: 9 },
  heroLegendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroDot: { width: 9, height: 9, borderRadius: 5 },
  heroLegendLabel: { flex: 1, fontSize: 12.5, fontFamily: fontFamily.semibold, color: colors.text },
  heroLegendValue: { fontSize: 13, fontFamily: fontFamily.extrabold },
  searchWrap: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4, backgroundColor: colors.surface },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fontFamily.regular,
    backgroundColor: colors.background,
  },
  mineToggle: {
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.background,
  },
  mineToggleActive: { backgroundColor: colors.primary },
  mineToggleText: { fontSize: 13, fontFamily: fontFamily.semibold, color: colors.text },
  mineToggleTextActive: { color: colors.primaryText },
  listContent: {
    padding: 14,
    paddingBottom: 90,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 40,
  },
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
  statusPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  miniChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  miniChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.background,
  },
  miniChipActive: { backgroundColor: colors.primary },
  miniChipText: { fontSize: 12, fontFamily: fontFamily.semibold, color: colors.text },
  miniChipTextActive: { color: colors.primaryText },
  terminalCaseList: { gap: 0 },
  noCasesHint: { fontSize: 12, fontFamily: fontFamily.medium, color: colors.textMuted, fontStyle: 'italic' },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 20,
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 999,
    elevation: 6,
    shadowColor: colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  fabText: {
    color: colors.primaryText,
    fontFamily: fontFamily.bold,
    fontSize: 14,
  },
});
