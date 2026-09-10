import type { ImageSourcePropType } from 'react-native';

export type ViewSide = 'derecho' | 'izquierdo' | 'frontal' | 'trasero';

export interface GlassZone {
  id: string;
  categoria: string;
  label: string;
}

export interface ZoneRect extends GlassZone {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewConfig {
  source: ImageSourcePropType;
  aspectRatio: number;
  zones: ZoneRect[];
  ppuMask: { left: number; top: number; width: number; height: number };
}

export interface BusModelConfig {
  id: string;
  /** Nombre mostrado en el selector cuando hay más de un modelo cargado. */
  displayName: string;
  /** Compara contra Equipment.model (el string libre que trae la flota real). */
  matches: (modelo: string) => boolean;
  views: Record<ViewSide, ViewConfig>;
}

/**
 * Diagramas específicos por modelo de bus — cada modelo tiene su propia
 * numeración de vidrios (vidrio lateral derecho 1-N, izquierdo N+1-M,
 * corredera, puertas por letra, parabrisas, luneta trasera), calcada de la
 * ficha técnica real del fabricante en vez de una posición aproximada.
 *
 * Se completa incrementalmente: al bus cuyo `Equipment.model` no matchee
 * ningún modelo de aquí, `bus-glass-diagram.tsx` le muestra el diagrama
 * genérico estándar/articulado (con categorías generales, sin numeración
 * por modelo) — así no hay que tener todos los modelos cargados para que
 * el diagrama funcione.
 */
export const BUS_MODELS: BusModelConfig[] = [];

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export function findBusModel(modelo?: string | null): BusModelConfig | null {
  if (!modelo) return null;
  const norm = normalize(modelo);
  return BUS_MODELS.find((m) => m.matches(norm)) ?? null;
}
