import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/constants/colors';

export type BusBodyType = 'estandar' | 'articulado';

export interface GlassZone {
  id: string;
  categoria: string;
  label: string;
}

interface ZoneRect extends GlassZone {
  left: number;
  width: number;
}

// Posiciones en % sobre la ficha técnica oficial (RED Metropolitana de
// Movilidad) — imágenes reales recortadas, no un dibujo aproximado. Las
// franjas cubren el área de ventanas/puertas de cada imagen; la PPU
// impresa en la imagen ("FL XV 13") se tapa y se reemplaza por la patente
// real del bus seleccionado.
const WINDOW_BAND = { top: 10, height: 48 };

const STANDARD_ZONES: ZoneRect[] = [
  { id: 'parabrisas', categoria: 'parabrisas', label: 'Parabrisas delantero', left: 0, width: 9 },
  { id: 'lateral1', categoria: 'vidrio_lateral', label: 'Vidrio lateral delantero', left: 9, width: 14 },
  { id: 'puerta1', categoria: 'vidrio_puertas', label: 'Vidrio puerta delantera', left: 23, width: 7 },
  { id: 'lateral2', categoria: 'vidrio_lateral', label: 'Vidrio lateral medio', left: 30, width: 40 },
  { id: 'puerta2', categoria: 'vidrio_puertas', label: 'Vidrio puerta trasera', left: 70, width: 22 },
];

const ARTICULATED_ZONES: ZoneRect[] = [
  { id: 'lateral1', categoria: 'vidrio_lateral', label: 'Vidrio lateral delantero (1er cuerpo)', left: 0, width: 20 },
  { id: 'puerta1', categoria: 'vidrio_puertas', label: 'Vidrio puerta delantera', left: 20, width: 8 },
  { id: 'lateral2', categoria: 'vidrio_lateral', label: 'Vidrio lateral medio (1er cuerpo)', left: 37, width: 23 },
  { id: 'lateral3', categoria: 'vidrio_lateral', label: 'Vidrio lateral medio (2do cuerpo)', left: 60, width: 23 },
  { id: 'puerta2', categoria: 'vidrio_puertas', label: 'Vidrio puerta trasera', left: 83, width: 15 },
];

const PPU_MASK: Record<BusBodyType, { left: number; top: number; width: number; height: number }> = {
  estandar: { left: 5, top: 64, width: 23, height: 10 },
  articulado: { left: 29.5, top: 61, width: 10, height: 10.5 },
};

const IMAGES: Record<BusBodyType, { source: number; aspectRatio: number }> = {
  estandar: { source: require('../../assets/images/bus-diagrams/bus-standard.png'), aspectRatio: 769 / 202 },
  articulado: { source: require('../../assets/images/bus-diagrams/bus-articulated.png'), aspectRatio: 1118 / 190 },
};

export function BusGlassDiagram({
  onSelectZone,
  ppu,
}: {
  onSelectZone: (zone: GlassZone) => void;
  ppu?: string | null;
}) {
  const [busType, setBusType] = useState<BusBodyType>('estandar');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const zones = busType === 'articulado' ? ARTICULATED_ZONES : STANDARD_ZONES;
  const image = IMAGES[busType];
  const mask = PPU_MASK[busType];

  function handlePress(zone: ZoneRect) {
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

      <View style={[styles.busShell, { aspectRatio: image.aspectRatio }]}>
        <Image
          source={image.source}
          style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
          resizeMode="contain"
        />

        {zones.map((zone) => (
          <Pressable
            key={zone.id}
            onPress={() => handlePress(zone)}
            style={[
              styles.zone,
              {
                left: `${zone.left}%`,
                width: `${zone.width}%`,
                top: `${WINDOW_BAND.top}%`,
                height: `${WINDOW_BAND.height}%`,
              },
              selectedId === zone.id && styles.zoneSelected,
            ]}
          />
        ))}

        <View
          style={[
            styles.ppuMask,
            {
              left: `${mask.left}%`,
              top: `${mask.top}%`,
              width: `${mask.width}%`,
              height: `${mask.height}%`,
            },
          ]}
        >
          <Text style={styles.ppuText} numberOfLines={1} adjustsFontSizeToFit>
            {ppu || '—'}
          </Text>
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

const PLATE_RED = '#bc2c34';

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
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
  },
  zone: { position: 'absolute' },
  zoneSelected: { backgroundColor: 'rgba(37, 99, 235, 0.45)', borderRadius: 4 },
  ppuMask: {
    position: 'absolute',
    backgroundColor: PLATE_RED,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 2,
  },
  ppuText: { color: '#fff', fontWeight: '800', letterSpacing: 0.5 },
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
