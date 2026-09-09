import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useReportSummary } from '@/api/hooks';
import { apiErrorMessage } from '@/api/client';
import { colors, statusColors } from '@/constants/colors';
import { STATUS_LABELS, type CaseStatus } from '@/api/types';
import { downloadExport } from '@/utils/download-export';
import { useAuth } from '@/state/auth-context';

const STATUS_ORDER = Object.keys(STATUS_LABELS) as CaseStatus[];
const TERMINAL_ACCENTS = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444'];

const RANGE_OPTIONS: { label: string; days: number | undefined }[] = [
  { label: 'Todo', days: undefined },
  { label: '7 días', days: 7 },
  { label: '30 días', days: 30 },
  { label: '90 días', days: 90 },
];

export default function ReportsScreen() {
  const { module } = useAuth();
  const partsLabel = module === 'glass' ? 'Vidrios reemplazados/reparados' : 'Repuestos y piezas utilizadas';
  const [days, setDays] = useState<number | undefined>(undefined);
  const summaryQuery = useReportSummary(days);
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>{module === 'glass' ? 'Reportes de Vidrios' : 'Reportes técnicos'}</Text>
      <View style={styles.rangeRow}>
        {RANGE_OPTIONS.map((opt) => (
          <Pressable
            key={opt.label}
            style={[styles.rangeChip, days === opt.days && styles.rangeChipActive]}
            onPress={() => setDays(opt.days)}
          >
            <Text style={[styles.rangeChipText, days === opt.days && styles.rangeChipTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {summaryQuery.isLoading || !summaryQuery.data ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <ReportBody data={summaryQuery.data} partsLabel={partsLabel} />
      )}

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

function ReportBody({
  data,
  partsLabel,
}: {
  data: NonNullable<ReturnType<typeof useReportSummary>['data']>;
  partsLabel: string;
}) {
  const maxStatusCount = Math.max(1, ...STATUS_ORDER.map((s) => data.byStatus[s]));
  const maxTerminalTotal = Math.max(1, ...data.byTerminal.map((t) => t.total));
  const maxTechAssigned = Math.max(1, ...data.byTechnician.map((t) => t.assigned));
  const maxPartsCount = Math.max(1, ...data.partsUsage.map((p) => p.count));

  return (
    <>
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

      <Text style={styles.sectionTitle}>Terminales con más casos</Text>
      <View style={styles.card}>
        {data.byTerminal.length === 0 ? (
          <Text style={styles.totalHint}>Sin casos en este período.</Text>
        ) : (
          data.byTerminal.map((t, i) => (
            <View key={t.terminal} style={styles.terminalBlock}>
              <View style={styles.barRow}>
                <Text style={styles.rankBadge}>#{i + 1}</Text>
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
          ))
        )}
      </View>

      <Text style={styles.sectionTitle}>Técnicos</Text>
      <View style={styles.card}>
        {data.byTechnician.length === 0 ? (
          <Text style={styles.totalHint}>Sin casos asignados en este período.</Text>
        ) : (
          data.byTechnician.map((t, i) => (
            <View key={t.technicianId} style={styles.terminalBlock}>
              <View style={styles.barRow}>
                <Text style={styles.barLabel} numberOfLines={1}>
                  {t.name}
                </Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${(t.assigned / maxTechAssigned) * 100}%`,
                        backgroundColor: TERMINAL_ACCENTS[i % TERMINAL_ACCENTS.length],
                      },
                    ]}
                  />
                </View>
                <Text style={styles.barValue}>{t.assigned}</Text>
              </View>
              <Text style={styles.terminalMeta}>
                {t.resolved} resueltos ({t.resolvedPct}%)
                {t.avgDaysToResolve != null ? ` · promedio ${t.avgDaysToResolve} días` : ''}
              </Text>
            </View>
          ))
        )}
      </View>

      <Text style={styles.sectionTitle}>{partsLabel}</Text>
      <View style={styles.card}>
        {data.partsUsage.length === 0 ? (
          <Text style={styles.totalHint}>Aún no hay casos cerrados con detalle de reparación.</Text>
        ) : (
          data.partsUsage.map((p, i) => (
            <View key={p.label} style={styles.barRow}>
              <Text style={styles.barLabel} numberOfLines={2}>
                {p.label}
              </Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${(p.count / maxPartsCount) * 100}%`,
                      backgroundColor: TERMINAL_ACCENTS[i % TERMINAL_ACCENTS.length],
                    },
                  ]}
                />
              </View>
              <Text style={styles.barValue}>{p.count}</Text>
            </View>
          ))
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 4 },
  pageTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 10 },
  rangeRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  rangeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rangeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  rangeChipText: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  rangeChipTextActive: { color: colors.primaryText },
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
  rankBadge: { fontSize: 12, fontWeight: '800', color: colors.textMuted, width: 22 },
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
