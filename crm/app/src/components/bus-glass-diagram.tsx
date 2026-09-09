import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/constants/colors';

export type BusBodyType = 'estandar' | 'articulado';

export interface GlassZone {
  id: string;
  categoria: string;
  label: string;
}

interface ZoneSpec extends GlassZone {
  kind: 'windshield' | 'window' | 'door' | 'rear' | 'joint';
  flex: number;
}

const STANDARD_ZONES: ZoneSpec[] = [
  { id: 'parabrisas', categoria: 'parabrisas', label: 'Parabrisas delantero', kind: 'windshield', flex: 1.1 },
  { id: 'puerta1', categoria: 'vidrio_puertas', label: 'Vidrio puerta delantera', kind: 'door', flex: 0.6 },
  { id: 'lateral1', categoria: 'vidrio_lateral', label: 'Vidrio lateral delantero', kind: 'window', flex: 1.3 },
  { id: 'lateral2', categoria: 'vidrio_lateral', label: 'Vidrio lateral medio', kind: 'window', flex: 1.3 },
  { id: 'puerta2', categoria: 'vidrio_puertas', label: 'Vidrio puerta trasera', kind: 'door', flex: 0.6 },
  { id: 'lateral3', categoria: 'vidrio_lateral', label: 'Vidrio lateral trasero', kind: 'window', flex: 1.3 },
  { id: 'luna_trasera', categoria: 'luna_trasera', label: 'Luna trasera', kind: 'rear', flex: 0.9 },
];

const ARTICULATED_ZONES: ZoneSpec[] = [
  { id: 'parabrisas', categoria: 'parabrisas', label: 'Parabrisas delantero', kind: 'windshield', flex: 1.0 },
  { id: 'puerta1', categoria: 'vidrio_puertas', label: 'Vidrio puerta delantera', kind: 'door', flex: 0.55 },
  { id: 'lateral1', categoria: 'vidrio_lateral', label: 'Vidrio lateral delantero', kind: 'window', flex: 1.05 },
  { id: 'lateral2', categoria: 'vidrio_lateral', label: 'Vidrio lateral medio (1er cuerpo)', kind: 'window', flex: 1.05 },
  { id: 'puerta2', categoria: 'vidrio_puertas', label: 'Vidrio puerta media', kind: 'door', flex: 0.55 },
  { id: 'fuelle', categoria: 'otro', label: 'Fuelle (no es vidrio)', kind: 'joint', flex: 0.55 },
  { id: 'lateral3', categoria: 'vidrio_lateral', label: 'Vidrio lateral medio (2do cuerpo)', kind: 'window', flex: 1.05 },
  { id: 'puerta3', categoria: 'vidrio_puertas', label: 'Vidrio puerta trasera', kind: 'door', flex: 0.55 },
  { id: 'lateral4', categoria: 'vidrio_lateral', label: 'Vidrio lateral trasero', kind: 'window', flex: 1.05 },
  { id: 'luna_trasera', categoria: 'luna_trasera', label: 'Luna trasera', kind: 'rear', flex: 0.8 },
];

const WHEEL_OFFSETS: Record<BusBodyType, `${number}%`[]> = {
  estandar: ['14%', '80%'],
  articulado: ['10%', '46%', '86%'],
};

export function BusGlassDiagram({ onSelectZone }: { onSelectZone: (zone: GlassZone) => void }) {
  const [busType, setBusType] = useState<BusBodyType>('estandar');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const zones = busType === 'articulado' ? ARTICULATED_ZONES : STANDARD_ZONES;

  function handlePress(zone: ZoneSpec) {
    if (zone.kind === 'joint') return;
    setSelectedId(zone.id);
    onSelectZone({ id: zone.id, categoria: zone.categoria, label: zone.label });
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.typeToggle}>
        {(['estandar', 'articulado'] as BusBodyType[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.typeChip, busType === t && styles.typeChipActive]}
            onPress={() => {
              setBusType(t);
              setSelectedId(null);
            }}
          >
            <Text style={[styles.typeChipText, busType === t && styles.typeChipTextActive]}>
              {t === 'estandar' ? 'Bus estándar' : 'Bus articulado'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.busShell}>
        <View style={styles.roofLine} />
        <View style={styles.body}>
          {zones.map((zone) => (
            <Pressable
              key={zone.id}
              disabled={zone.kind === 'joint'}
              onPress={() => handlePress(zone)}
              style={[
                styles.segment,
                { flex: zone.flex },
                zone.kind === 'windshield' && styles.windshieldSegment,
                zone.kind === 'rear' && styles.rearSegment,
                zone.kind === 'door' && styles.doorSegment,
                zone.kind === 'window' && styles.windowSegment,
                zone.kind === 'joint' && styles.jointSegment,
                selectedId === zone.id && styles.segmentSelected,
              ]}
            >
              {zone.kind === 'door' && <View style={styles.doorHandle} />}
              {zone.kind === 'joint' && (
                <>
                  <View style={styles.fuelleStripe} />
                  <View style={styles.fuelleStripe} />
                  <View style={styles.fuelleStripe} />
                </>
              )}
            </Pressable>
          ))}
        </View>
        <View style={styles.wheelRow}>
          {WHEEL_OFFSETS[busType].map((left, i) => (
            <View key={i} style={[styles.wheel, { left }]} />
          ))}
        </View>
      </View>

      <Text style={styles.hint}>
        Toca el vidrio dañado en el dibujo — se completa la categoría y la zona automáticamente.
      </Text>

      {selectedId && (
        <View style={styles.selectedBadge}>
          <Text style={styles.selectedBadgeText}>
            Zona elegida: {zones.find((z) => z.id === selectedId)?.label}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  typeToggle: { flexDirection: 'row', gap: 8 },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { fontSize: 12, color: colors.text, fontWeight: '600' },
  typeChipTextActive: { color: colors.primaryText },
  busShell: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: 14,
    paddingBottom: 22,
    paddingHorizontal: 10,
  },
  roofLine: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#94a3b8',
    marginBottom: 6,
    marginHorizontal: 4,
  },
  body: {
    flexDirection: 'row',
    height: 76,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#475569',
    backgroundColor: '#e2e8f0',
  },
  segment: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#475569',
  },
  windshieldSegment: { backgroundColor: '#bfe3f5', borderTopLeftRadius: 8, borderBottomLeftRadius: 8 },
  rearSegment: { backgroundColor: '#bfe3f5', borderTopRightRadius: 8, borderBottomRightRadius: 8, borderRightWidth: 0 },
  windowSegment: { backgroundColor: '#bfe3f5' },
  doorSegment: { backgroundColor: '#cbd5e1' },
  jointSegment: {
    backgroundColor: '#334155',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingHorizontal: 4,
  },
  fuelleStripe: { width: 3, height: '70%', backgroundColor: '#64748b', borderRadius: 2 },
  doorHandle: { width: 3, height: 22, borderRadius: 2, backgroundColor: '#64748b' },
  segmentSelected: { backgroundColor: colors.primary, opacity: 0.85 },
  wheelRow: { height: 0 },
  wheel: {
    position: 'absolute',
    bottom: -14,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: '#94a3b8',
  },
  hint: { fontSize: 11, color: colors.textMuted },
  selectedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  selectedBadgeText: { color: colors.primaryText, fontSize: 12, fontWeight: '700' },
});
