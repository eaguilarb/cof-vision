import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/constants/colors';
import { findBusModel, type GlassZone, type ViewConfig, type ViewSide, type ZoneRect } from '@/data/bus-models';
import {
  GenericBusFront,
  GenericBusRear,
  GENERIC_FRONT_ASPECT_RATIO,
  GENERIC_REAR_ASPECT_RATIO,
} from './generic-bus-illustration';

export type BusBodyType = 'estandar' | 'articulado';
export type { GlassZone };

// Posiciones en % sobre la ficha técnica oficial (RED Metropolitana de
// Movilidad) — imágenes reales recortadas, no un dibujo aproximado. Cada
// lado/vista tiene su propia imagen y sus propias zonas; el lado
// izquierdo se obtiene reflejando las coordenadas del derecho porque el
// diseño oficial es simétrico. La PPU impresa en la imagen se tapa y se
// reemplaza por la patente real del bus seleccionado.
const STD_WINDOW_BAND_RIGHT = { top: 10, height: 48 };
const STD_ZONES_RIGHT: Omit<ZoneRect, 'top' | 'height'>[] = [
  { id: 'lateral_trasero', categoria: 'vidrio_lateral', label: 'Vidrio lateral trasero', left: 4.9, width: 27.6 },
  { id: 'puerta_trasera', categoria: 'vidrio_puertas', label: 'Vidrio puerta trasera', left: 36.9, width: 4.1 },
  { id: 'lateral_medio', categoria: 'vidrio_lateral', label: 'Vidrio lateral medio', left: 41.0, width: 28.5 },
  { id: 'puerta_delantera', categoria: 'vidrio_puertas', label: 'Vidrio puerta delantera', left: 69.6, width: 10.3 },
  { id: 'lateral_delantero', categoria: 'vidrio_lateral', label: 'Vidrio lateral delantero', left: 80.0, width: 14.0 },
  { id: 'parabrisas', categoria: 'parabrisas', label: 'Parabrisas (lateral)', left: 94.2, width: 5.8 },
];

const ART_WINDOW_BAND_RIGHT = { top: 12, height: 46 };
const ART_ZONES_RIGHT: Omit<ZoneRect, 'top' | 'height'>[] = [
  { id: 'lateral_trasero1', categoria: 'vidrio_lateral', label: 'Vidrio lateral trasero (1er cuerpo)', left: 4.1, width: 24.4 },
  { id: 'puerta_trasera1', categoria: 'vidrio_puertas', label: 'Vidrio puerta trasera (1er cuerpo)', left: 28.6, width: 9.8 },
  { id: 'lateral_trasero2', categoria: 'vidrio_lateral', label: 'Vidrio lateral trasero (2do cuerpo)', left: 50.1, width: 14.4 },
  { id: 'puerta_delantera2', categoria: 'vidrio_puertas', label: 'Vidrio puerta delantera (2do cuerpo)', left: 70.0, width: 4.8 },
  { id: 'lateral_delantero2', categoria: 'vidrio_lateral', label: 'Vidrio lateral delantero (2do cuerpo)', left: 74.8, width: 8.4 },
  { id: 'lateral_frontal', categoria: 'vidrio_lateral', label: 'Vidrio lateral frontal', left: 91.2, width: 5.8 },
  { id: 'parabrisas', categoria: 'parabrisas', label: 'Parabrisas (lateral)', left: 97.0, width: 3.0 },
];

function mirrorZones(zones: Omit<ZoneRect, 'top' | 'height'>[], band: { top: number; height: number }): ZoneRect[] {
  return zones.map((z) => ({
    ...z,
    left: 100 - z.left - z.width,
    top: band.top,
    height: band.height,
  }));
}

function withBand(zones: Omit<ZoneRect, 'top' | 'height'>[], band: { top: number; height: number }): ZoneRect[] {
  return zones.map((z) => ({ ...z, top: band.top, height: band.height }));
}

const CONFIGS: Record<BusBodyType, Record<ViewSide, ViewConfig>> = {
  estandar: {
    derecho: {
      source: require('../../assets/images/bus-diagrams/bus-standard.png'),
      aspectRatio: 769 / 202,
      zones: withBand(STD_ZONES_RIGHT, STD_WINDOW_BAND_RIGHT),
      ppuMask: { left: 5, top: 64, width: 23, height: 10 },
    },
    izquierdo: {
      // Volteo horizontal exacto de la imagen del costado derecho — mismo
      // dibujo, mismas proporciones verticales, así que la franja de
      // ventanas y la máscara de PPU quedan igual, solo el eje X se refleja.
      source: require('../../assets/images/bus-diagrams/bus-standard-left.png'),
      aspectRatio: 769 / 202,
      zones: mirrorZones(STD_ZONES_RIGHT, STD_WINDOW_BAND_RIGHT),
      ppuMask: { left: 72, top: 64, width: 23, height: 10 },
    },
    frontal: {
      vector: 'front',
      aspectRatio: GENERIC_FRONT_ASPECT_RATIO,
      zones: [{ id: 'parabrisas', categoria: 'parabrisas', label: 'Parabrisas delantero', left: 17, top: 31, width: 66, height: 41 }],
      ppuMask: { left: 27, top: 79, width: 46, height: 11 },
    },
    trasero: {
      vector: 'rear',
      aspectRatio: GENERIC_REAR_ASPECT_RATIO,
      zones: [{ id: 'luna_trasera', categoria: 'luna_trasera', label: 'Luna trasera', left: 21, top: 28, width: 58, height: 28 }],
      ppuMask: { left: 18, top: 79, width: 63, height: 11 },
    },
  },
  articulado: {
    derecho: {
      source: require('../../assets/images/bus-diagrams/bus-articulated.png'),
      aspectRatio: 1118 / 190,
      zones: withBand(ART_ZONES_RIGHT, ART_WINDOW_BAND_RIGHT),
      ppuMask: { left: 29.5, top: 61, width: 10, height: 10.5 },
    },
    izquierdo: {
      source: require('../../assets/images/bus-diagrams/bus-articulated-left.png'),
      aspectRatio: 1118 / 190,
      zones: mirrorZones(ART_ZONES_RIGHT, ART_WINDOW_BAND_RIGHT),
      ppuMask: { left: 60.5, top: 61, width: 10, height: 10.5 },
    },
    frontal: {
      vector: 'front',
      aspectRatio: GENERIC_FRONT_ASPECT_RATIO,
      zones: [{ id: 'parabrisas', categoria: 'parabrisas', label: 'Parabrisas delantero', left: 17, top: 31, width: 66, height: 41 }],
      ppuMask: { left: 27, top: 79, width: 46, height: 11 },
    },
    trasero: {
      vector: 'rear',
      aspectRatio: GENERIC_REAR_ASPECT_RATIO,
      zones: [{ id: 'luna_trasera', categoria: 'luna_trasera', label: 'Luna trasera', left: 21, top: 28, width: 58, height: 28 }],
      ppuMask: { left: 18, top: 79, width: 63, height: 11 },
    },
  },
};

const VIEW_ORDER: ViewSide[] = ['derecho', 'frontal', 'izquierdo', 'trasero'];
const VIEW_LABELS: Record<ViewSide, string> = {
  derecho: 'Costado derecho',
  izquierdo: 'Costado izquierdo',
  frontal: 'Frontal',
  trasero: 'Trasero',
};

export function BusGlassDiagram({
  onSelectZone,
  ppu,
  busModel,
}: {
  onSelectZone: (zone: GlassZone) => void;
  ppu?: string | null;
  /** Equipment.model del bus seleccionado — si matchea un modelo cargado
   * en bus-models.ts, se usa su diagrama con numeración específica en vez
   * del genérico estándar/articulado. */
  busModel?: string | null;
}) {
  const [busType, setBusType] = useState<BusBodyType>('estandar');
  const [viewIndex, setViewIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shellWidth, setShellWidth] = useState(0);

  const matchedModel = findBusModel(busModel);

  useEffect(() => {
    setSelectedId(null);
  }, [busModel]);

  const view = VIEW_ORDER[viewIndex];
  const config = matchedModel ? matchedModel.views[view] : CONFIGS[busType][view];

  function rotate(dir: 1 | -1) {
    setViewIndex((i) => (i + dir + VIEW_ORDER.length) % VIEW_ORDER.length);
    setSelectedId(null);
  }

  function handlePress(zone: ZoneRect) {
    setSelectedId(zone.id);
    onSelectZone({ id: zone.id, categoria: zone.categoria, label: zone.label });
  }

  return (
    <View style={styles.wrap}>
      {matchedModel ? (
        <Text style={styles.modelBadge}>Modelo detectado: {matchedModel.displayName}</Text>
      ) : (
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
      )}

      <View style={styles.rotateRow}>
        <Pressable style={styles.rotateBtn} onPress={() => rotate(-1)} hitSlop={8}>
          <Text style={styles.rotateBtnText}>‹</Text>
        </Pressable>
        <Text style={styles.viewLabel}>{VIEW_LABELS[view]}</Text>
        <Pressable style={styles.rotateBtn} onPress={() => rotate(1)} hitSlop={8}>
          <Text style={styles.rotateBtnText}>›</Text>
        </Pressable>
      </View>

      <View
        style={[styles.busShell, { aspectRatio: config.aspectRatio }]}
        onLayout={(e) => setShellWidth(e.nativeEvent.layout.width)}
      >
        {config.vector === 'front' ? (
          <View style={StyleSheet.absoluteFill}>
            <GenericBusFront width={shellWidth} />
          </View>
        ) : config.vector === 'rear' ? (
          <View style={StyleSheet.absoluteFill}>
            <GenericBusRear width={shellWidth} />
          </View>
        ) : (
          <Image
            source={config.source}
            style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
            resizeMode="contain"
          />
        )}

        {config.zones.map((zone) => (
          <Pressable
            key={zone.id}
            onPress={() => handlePress(zone)}
            style={[
              styles.zone,
              {
                left: `${zone.left}%`,
                width: `${zone.width}%`,
                top: `${zone.top}%`,
                height: `${zone.height}%`,
              },
              selectedId === zone.id && styles.zoneSelected,
            ]}
          />
        ))}

        {ppu ? (
          <View
            style={[
              styles.ppuMask,
              {
                left: `${config.ppuMask.left}%`,
                top: `${config.ppuMask.top}%`,
                width: `${config.ppuMask.width}%`,
                height: `${config.ppuMask.height}%`,
              },
            ]}
          >
            <Text style={styles.ppuText} numberOfLines={1} adjustsFontSizeToFit>
              {ppu}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.hint}>
        Usa ‹ › para girar el bus y ver el otro costado, el frente o la parte trasera. Toca el vidrio dañado — se
        completa la categoría automáticamente.
      </Text>

      {selectedId && (
        <View style={styles.selectedBadge}>
          <Text style={styles.selectedBadgeText}>
            Zona elegida: {config.zones.find((z) => z.id === selectedId)?.label}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, width: '100%', maxWidth: 460, alignSelf: 'center' },
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
  modelBadge: { fontSize: 12, fontWeight: '700', color: colors.primary },
  rotateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  rotateBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotateBtnText: { fontSize: 20, fontWeight: '800', color: colors.primary, lineHeight: 22 },
  viewLabel: { fontSize: 13, fontWeight: '800', color: colors.text, minWidth: 130, textAlign: 'center' },
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
    backgroundColor: '#f4f4f0',
    borderWidth: 1.5,
    borderColor: '#1c1c1c',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
  },
  ppuText: { color: '#111', fontWeight: '800', letterSpacing: 0.5 },
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
