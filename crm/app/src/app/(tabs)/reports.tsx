import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useReportSummary } from '@/api/hooks';
import { apiErrorMessage } from '@/api/client';
import { colors, statusColors } from '@/constants/colors';
import { STATUS_LABELS, type CaseStatus } from '@/api/types';
import { downloadExport } from '@/utils/download-export';

const STATUS_ORDER = Object.keys(STATUS_LABELS) as CaseStatus[];
const TERMINAL_ACCENTS = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444'];

export default function ReportsScreen() {
  const summaryQuery = useReportSummary();
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(format: 'xlsx' | 'pdf') {
    setError(null);
    setExporting(format);
    try {
      await downloadExport(format);
    } catch (err) {
      setError(apiErrorMessage(err, 'No se pudo generar la exportación'));
    } finally {
      setExporting(null);
    }
  }

  if (summaryQuery.isLoading || !summaryQuery.data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const data = summaryQuery.data;
  const maxStatusCount = Math.max(1, ...STATUS_ORDER.map((s) => data.byStatus[s]));
  const maxTerminalTotal = Math.max(1, ...data.byTerminal.map((t) => t.total));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Casos por estado</Text>
      <View style={styles.card}>
        {STATUS_ORDER.map((status) => {
          const count = data.byStatus[status];
          return (
            <View key={status} style={styles.barRow}>
              <Text style={styles.barLabel}>{STATUS_LABELS[status]}</Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${(count / maxStatusCount) * 100}%`, backgroundColor: statusColors[status] },
                  ]}
                />
              </View>
              <Text style={styles.barValue}>{count}</Text>
            </View>
          );
        })}
        <Text style={styles.totalHint}>{data.totalCases} casos en total</Text>
      </View>

      <Text style={styles.sectionTitle}>Casos por terminal</Text>
      <View style={styles.card}>
        {data.byTerminal.map((t, i) => (
          <View key={t.terminal} style={styles.terminalBlock}>
            <View style={styles.barRow}>
              <Text style={styles.barLabel} numberOfLines={1}>
                {t.terminal}
              </Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${(t.total / maxTerminalTotal) * 100}%`,
                      backgroundColor: TERMINAL_ACCENTS[i % TERMINAL_ACCENTS.length],
                    },
                  ]}
                />
              </View>
              <Text style={styles.barValue}>{t.total}</Text>
            </View>
            <Text style={styles.terminalMeta}>
              {t.resolvedPct}% resuelto
              {t.avgDaysToResolve != null ? ` · promedio ${t.avgDaysToResolve} días para resolver` : ''}
            </Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Exportar</Text>
      <View style={[styles.card, { flexDirection: 'row', gap: 10 }]}>
        <Pressable
          style={[styles.exportButton, { opacity: exporting ? 0.6 : 1 }]}
          onPress={() => handleExport('xlsx')}
          disabled={!!exporting}
        >
          {exporting === 'xlsx' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.exportButtonText}>📊 Excel</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.exportButton, { opacity: exporting ? 0.6 : 1 }]}
          onPress={() => handleExport('pdf')}
          disabled={!!exporting}
        >
          {exporting === 'pdf' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.exportButtonText}>📄 PDF</Text>
          )}
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 18, marginBottom: 8 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { width: 92, fontSize: 12, color: colors.text, fontWeight: '600' },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5 },
  barValue: { width: 30, fontSize: 12, fontWeight: '700', color: colors.text, textAlign: 'right' },
  totalHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  terminalBlock: { gap: 4 },
  terminalMeta: { fontSize: 11, color: colors.textMuted, marginLeft: 100 },
  exportButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  exportButtonText: { color: '#fff', fontWeight: '700' },
  error: { color: colors.danger, marginTop: 12, fontSize: 13 },
});
