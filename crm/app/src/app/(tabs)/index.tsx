import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCases, useTechnicians } from '@/api/hooks';
import { STATUS_LABELS, type CaseStatus } from '@/api/types';
import { useAuth } from '@/state/auth-context';
import { colors } from '@/constants/colors';
import { CaseListItem } from '@/components/case-list-item';

const STATUS_FILTERS: Array<{ label: string; value: CaseStatus | undefined }> = [
  { label: 'Todos', value: undefined },
  ...(Object.entries(STATUS_LABELS) as [CaseStatus, string][]).map(([value, label]) => ({
    label,
    value,
  })),
];

export default function CasesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [status, setStatus] = useState<CaseStatus | undefined>(undefined);
  const [onlyMine, setOnlyMine] = useState(false);

  const casesQuery = useCases({ status, mine: onlyMine });
  const techniciansQuery = useTechnicians();

  const isLoading = casesQuery.isLoading || techniciansQuery.isLoading;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filters}
        contentContainerStyle={styles.filtersContent}
      >
        {STATUS_FILTERS.map((f) => (
          <Pressable
            key={f.label}
            style={[styles.filterChip, status === f.value && styles.filterChipActive]}
            onPress={() => setStatus(f.value)}
          >
            <Text style={[styles.filterText, status === f.value && styles.filterTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
        {user?.role === 'technician' && (
          <Pressable
            style={[styles.filterChip, onlyMine && styles.filterChipActive]}
            onPress={() => setOnlyMine((v) => !v)}
          >
            <Text style={[styles.filterText, onlyMine && styles.filterTextActive]}>
              Solo mis casos
            </Text>
          </Pressable>
        )}
      </ScrollView>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={casesQuery.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={casesQuery.isFetching} onRefresh={casesQuery.refetch} />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No hay casos con estos filtros.</Text>
          }
          renderItem={({ item }) => (
            <CaseListItem item={item} technicians={techniciansQuery.data ?? []} />
          )}
        />
      )}

      <Pressable style={styles.fab} onPress={() => router.push('/case/new')}>
        <Text style={styles.fabText}>+ Nuevo caso</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  filters: {
    maxHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  filtersContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
  },
  filterTextActive: {
    color: colors.primaryText,
  },
  listContent: {
    padding: 14,
    paddingBottom: 90,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 40,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 20,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 999,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  fabText: {
    color: colors.primaryText,
    fontWeight: '700',
  },
});
