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
  /** Ausente cuando la vista usa un dibujo vectorial (`vector`) en vez de una imagen. */
  source?: ImageSourcePropType;
  /** Vista genérica dibujada en código (sin foto) — ver generic-bus-illustration.tsx. */
  vector?: 'front' | 'rear';
  aspectRatio: number;
  zones: ZoneRect[];
  ppuMask: { left: number; top: number; width: number; height: number };
}

export interface BusModelConfig {
  id: string;
  /** Nombre mostrado en el selector cuando hay más de un modelo cargado. */
  displayName: string;
  /**
   * Recibe Equipment.model ya en mayúsculas y SIN ningún espacio/guión
   * (ver `compact` más abajo) — comparar así es inmune a que la intranet
   * mande el código con espacios sueltos ("O 500 UA") o sin ellos
   * ("O500UA"), y no depende de que incluya el fabricante (nunca lo hace).
   */
  matches: (modeloCompacto: string) => boolean;
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
function lateral(id: string, side: 'derecho' | 'izquierdo', n: number, rect: Omit<ZoneRect, 'id' | 'categoria' | 'label'>): ZoneRect {
  return { id, categoria: 'vidrio_lateral', label: `Vidrio lateral ${side} ${n}`, ...rect };
}

function corredera(id: string, side: 'derecho' | 'izquierdo', n: number, rect: Omit<ZoneRect, 'id' | 'categoria' | 'label'>): ZoneRect {
  return { id, categoria: 'vidrio_corredera', label: `Vidrio corredera ${side} ${n}`, ...rect };
}

function puerta(id: string, letra: string, rect: Omit<ZoneRect, 'id' | 'categoria' | 'label'>): ZoneRect {
  return { id, categoria: 'vidrio_puertas', label: `Vidrio puerta ${letra}`, ...rect };
}

function parabrisas(id: string, n: number, rect: Omit<ZoneRect, 'id' | 'categoria' | 'label'>): ZoneRect {
  return { id, categoria: 'parabrisas', label: `Parabrisas ${n}`, ...rect };
}

const lunaTrasera = (rect: Omit<ZoneRect, 'id' | 'categoria' | 'label'>): ZoneRect => ({
  id: 'luna_trasera',
  categoria: 'luna_trasera',
  label: 'Luneta trasera',
  ...rect,
});

/**
 * FOTON EBUS U12 SC — numeración calcada de la ficha técnica del
 * fabricante: vidrio lateral derecho 1-6, corredera derecho -1 a -8,
 * puertas A-D (puerta delantera) y E-H (puerta trasera); vidrio lateral
 * izquierdo 7-15, corredera izquierdo -9 a -20; parabrisas 1-2; luneta
 * trasera. La posición "5" no aparece impresa en la ficha (queda tapada
 * por el gráfico "100% eléctrico") pero existe según el patrón de
 * numeración — igual que el 4, no tiene corredera propia salvo la
 * pareja -8/-7 que le corresponde.
 */
const FOTON_U12: BusModelConfig = {
  id: 'foton_ebus_u12_sc',
  displayName: 'Foton eBus U12 SC',
  matches: (m) => m.includes('U12'),
  views: {
    derecho: {
      source: require('../../assets/images/bus-diagrams/foton-u12/derecho.png'),
      aspectRatio: 496 / 144,
      ppuMask: { left: 45, top: 62, width: 20, height: 12 },
      zones: [
        lateral('lat_6', 'derecho', 6, { left: 4, top: 26, width: 6, height: 16 }),
        corredera('cor_-8', 'derecho', -8, { left: 16.5, top: 26, width: 4.5, height: 8 }),
        corredera('cor_-7', 'derecho', -7, { left: 21, top: 26, width: 4.5, height: 8 }),
        lateral('lat_5', 'derecho', 5, { left: 16.5, top: 35, width: 9, height: 23 }),
        corredera('cor_-6', 'derecho', -6, { left: 27, top: 26, width: 4.5, height: 8 }),
        corredera('cor_-5', 'derecho', -5, { left: 31.5, top: 26, width: 4.5, height: 8 }),
        lateral('lat_4', 'derecho', 4, { left: 27, top: 35, width: 9, height: 23 }),
        puerta('puerta_e', 'E', { left: 35.7, top: 35, width: 4.2, height: 20 }),
        puerta('puerta_f', 'F', { left: 40.7, top: 35, width: 4.2, height: 20 }),
        puerta('puerta_g', 'G', { left: 35.7, top: 57, width: 4.2, height: 20 }),
        puerta('puerta_h', 'H', { left: 40.7, top: 57, width: 4.2, height: 20 }),
        corredera('cor_-4', 'derecho', -4, { left: 46.2, top: 26, width: 4.8, height: 8 }),
        corredera('cor_-3', 'derecho', -3, { left: 51, top: 26, width: 4.8, height: 8 }),
        lateral('lat_3', 'derecho', 3, { left: 46.2, top: 35, width: 9.6, height: 23 }),
        corredera('cor_-2', 'derecho', -2, { left: 57.1, top: 26, width: 4.8, height: 8 }),
        corredera('cor_-1', 'derecho', -1, { left: 61.9, top: 26, width: 4.8, height: 8 }),
        lateral('lat_2', 'derecho', 2, { left: 57.1, top: 35, width: 9.6, height: 23 }),
        lateral('lat_1', 'derecho', 1, { left: 67.7, top: 35, width: 11.1, height: 23 }),
        puerta('puerta_a', 'A', { left: 80.8, top: 35, width: 4.3, height: 20 }),
        puerta('puerta_b', 'B', { left: 85.7, top: 35, width: 4.2, height: 20 }),
        puerta('puerta_c', 'C', { left: 80.8, top: 57, width: 4.3, height: 20 }),
        puerta('puerta_d', 'D', { left: 85.7, top: 57, width: 4.2, height: 20 }),
      ],
    },
    izquierdo: {
      source: require('../../assets/images/bus-diagrams/foton-u12/izquierdo.png'),
      aspectRatio: 464 / 137,
      ppuMask: { left: 45, top: 62, width: 20, height: 12 },
      zones: [
        lateral('lat_15', 'izquierdo', 15, { left: 4.1, top: 24, height: 28, width: 4.8 }),
        lateral('lat_14', 'izquierdo', 14, { left: 8.9, top: 24, height: 28, width: 4.9 }),
        corredera('cor_-20', 'izquierdo', -20, { left: 18.3, top: 26, width: 4.75, height: 8 }),
        corredera('cor_-19', 'izquierdo', -19, { left: 23.05, top: 26, width: 4.75, height: 8 }),
        lateral('lat_13', 'izquierdo', 13, { left: 18.3, top: 35, width: 9.5, height: 23 }),
        corredera('cor_-18', 'izquierdo', -18, { left: 29.5, top: 26, width: 5.2, height: 8 }),
        corredera('cor_-17', 'izquierdo', -17, { left: 34.7, top: 26, width: 5.2, height: 8 }),
        lateral('lat_12', 'izquierdo', 12, { left: 29.5, top: 35, width: 10.4, height: 23 }),
        corredera('cor_-16', 'izquierdo', -16, { left: 41.0, top: 26, width: 5.2, height: 8 }),
        corredera('cor_-15', 'izquierdo', -15, { left: 46.2, top: 26, width: 5.2, height: 8 }),
        lateral('lat_11', 'izquierdo', 11, { left: 41.0, top: 35, width: 10.4, height: 23 }),
        corredera('cor_-14', 'izquierdo', -14, { left: 52.6, top: 26, width: 5.05, height: 8 }),
        corredera('cor_-13', 'izquierdo', -13, { left: 57.65, top: 26, width: 5.05, height: 8 }),
        lateral('lat_10', 'izquierdo', 10, { left: 52.6, top: 35, width: 10.1, height: 23 }),
        corredera('cor_-12', 'izquierdo', -12, { left: 64.2, top: 26, width: 5.4, height: 8 }),
        corredera('cor_-11', 'izquierdo', -11, { left: 69.6, top: 26, width: 5.4, height: 8 }),
        lateral('lat_9', 'izquierdo', 9, { left: 64.2, top: 35, width: 10.8, height: 15 }),
        corredera('cor_-10', 'izquierdo', -10, { left: 76.7, top: 26, width: 5.4, height: 8 }),
        corredera('cor_-9', 'izquierdo', -9, { left: 82.1, top: 26, width: 5.4, height: 8 }),
        lateral('lat_8', 'izquierdo', 8, { left: 76.7, top: 35, width: 10.8, height: 15 }),
        lateral('lat_7', 'izquierdo', 7, { left: 90.0, top: 24, width: 5.0, height: 13 }),
      ],
    },
    frontal: {
      source: require('../../assets/images/bus-diagrams/foton-u12/frontal.png'),
      aspectRatio: 198 / 223,
      ppuMask: { left: 30, top: 65, width: 40, height: 10 },
      zones: [
        parabrisas('parabrisas_1', 1, { left: 8, top: 20, width: 42, height: 38 }),
        parabrisas('parabrisas_2', 2, { left: 50, top: 20, width: 42, height: 38 }),
      ],
    },
    trasero: {
      source: require('../../assets/images/bus-diagrams/foton-u12/trasero.png'),
      aspectRatio: 207 / 229,
      ppuMask: { left: 25, top: 42, width: 50, height: 11 },
      zones: [lunaTrasera({ left: 55, top: 7, width: 27, height: 14 })],
    },
  },
};

/**
 * Mercedes-Benz O500U (2019) — sin corredera visible en la ficha, así que
 * solo tiene vidrio lateral (numerado 1-6 derecho, 7-15 izquierdo) y
 * puertas A-D/E-H de un solo panel (no 2x2 como el Foton). Comparte el
 * mismo frontal/trasero que el O500UA (misma cabina Mercedes).
 *
 * `matches` acepta cualquier "O500U" que no sea articulado (UA) sin
 * exigir el "1930": la flota real trae el mismo código con distintos
 * números de correlativo/lote después ("O500U 1930", "O500U 1826 59",
 * etc.) para lo que es la misma carrocería — exigir el sufijo exacto
 * dejaría la mayoría de esos buses sin diagrama.
 */
const MB_O500U_1930: BusModelConfig = {
  id: 'mb_o500u_1930',
  displayName: 'Mercedes-Benz O500U 1930',
  matches: (m) => m.includes('O500U') && !m.includes('UA'),
  views: {
    derecho: {
      source: require('../../assets/images/bus-diagrams/mb-o500u-1930/derecho.png'),
      aspectRatio: 906 / 264,
      ppuMask: { left: 40, top: 88, width: 20, height: 9 },
      zones: [
        lateral('lat_6', 'derecho', 6, { left: 8.2, top: 36, width: 7.8, height: 31 }),
        lateral('lat_5', 'derecho', 5, { left: 16.6, top: 36, width: 9.6, height: 31 }),
        lateral('lat_4', 'derecho', 4, { left: 27.2, top: 36, width: 9.6, height: 31 }),
        puerta('puerta_e', 'E', { left: 39.0, top: 47, width: 2.6, height: 20 }),
        puerta('puerta_f', 'F', { left: 43.2, top: 47, width: 2.6, height: 20 }),
        puerta('puerta_g', 'G', { left: 39.0, top: 73, width: 2.6, height: 16 }),
        puerta('puerta_h', 'H', { left: 43.2, top: 73, width: 2.6, height: 16 }),
        lateral('lat_3', 'derecho', 3, { left: 48.5, top: 36, width: 9.4, height: 31 }),
        lateral('lat_2', 'derecho', 2, { left: 58.9, top: 36, width: 9.6, height: 31 }),
        lateral('lat_1', 'derecho', 1, { left: 69.4, top: 36, width: 6.6, height: 31 }),
        puerta('puerta_a', 'A', { left: 78.6, top: 47, width: 2.6, height: 20 }),
        puerta('puerta_b', 'B', { left: 82.8, top: 47, width: 2.6, height: 20 }),
        puerta('puerta_c', 'C', { left: 78.6, top: 73, width: 2.6, height: 16 }),
        puerta('puerta_d', 'D', { left: 82.8, top: 73, width: 2.6, height: 16 }),
      ],
    },
    izquierdo: {
      source: require('../../assets/images/bus-diagrams/mb-o500u-1930/izquierdo.png'),
      aspectRatio: 799 / 250,
      ppuMask: { left: 40, top: 88, width: 20, height: 9 },
      zones: [
        lateral('lat_15', 'izquierdo', 15, { left: 0, top: 26, width: 5.8, height: 32 }),
        lateral('lat_14', 'izquierdo', 14, { left: 9.0, top: 26, width: 8.5, height: 32 }),
        lateral('lat_13', 'izquierdo', 13, { left: 18.3, top: 26, width: 4.7, height: 32 }),
        lateral('lat_12', 'izquierdo', 12, { left: 30.8, top: 26, width: 7.5, height: 32 }),
        lateral('lat_11', 'izquierdo', 11, { left: 39.5, top: 26, width: 10.9, height: 32 }),
        lateral('lat_10', 'izquierdo', 10, { left: 51.3, top: 26, width: 10.4, height: 32 }),
        lateral('lat_9', 'izquierdo', 9, { left: 63.0, top: 26, width: 11.5, height: 32 }),
        lateral('lat_8', 'izquierdo', 8, { left: 75.7, top: 26, width: 10.9, height: 32 }),
        lateral('lat_7', 'izquierdo', 7, { left: 87.2, top: 26, width: 7.9, height: 32 }),
      ],
    },
    frontal: {
      source: require('../../assets/images/bus-diagrams/mb-o500u-1930/frontal.png'),
      aspectRatio: 303 / 296,
      ppuMask: { left: 30, top: 68, width: 40, height: 10 },
      zones: [
        parabrisas('parabrisas_1', 1, { left: 10, top: 15, width: 38, height: 40 }),
        parabrisas('parabrisas_2', 2, { left: 52, top: 15, width: 38, height: 40 }),
      ],
    },
    trasero: {
      source: require('../../assets/images/bus-diagrams/mb-o500u-1930/trasero.png'),
      aspectRatio: 248 / 297,
      ppuMask: { left: 25, top: 45, width: 50, height: 11 },
      zones: [lunaTrasera({ left: 55, top: 8, width: 25, height: 13 })],
    },
  },
};

/**
 * Mercedes-Benz O500UA 2836 (articulado) — la ficha no trae números
 * impresos, pero igual se numera vidrio por vidrio (no por tramo) para
 * poder identificar y llevar stock de cada uno, igual que el Foton U12:
 * vidrio lateral derecho 1-8, izquierdo 9-20, puertas A-F (3 puertas de
 * un solo panel cada lado, no 2x2). Mismo frontal/trasero que el O500U
 * (misma cabina).
 */
const MB_O500UA_2836: BusModelConfig = {
  id: 'mb_o500ua_2836',
  displayName: 'Mercedes-Benz O500UA 2836 (articulado)',
  matches: (m) => m.includes('O500UA') || m.includes('2836') || (m.includes('O500U') && m.includes('UA')),
  views: {
    derecho: {
      source: require('../../assets/images/bus-diagrams/mb-o500ua-2836/derecho.png'),
      aspectRatio: 1179 / 251,
      ppuMask: { left: 48, top: 88, width: 15, height: 9 },
      zones: [
        lateral('lat_8', 'derecho', 8, { left: 2.1, top: 33, width: 5.2, height: 30 }),
        lateral('lat_7', 'derecho', 7, { left: 7.7, top: 33, width: 6.0, height: 30 }),
        lateral('lat_6', 'derecho', 6, { left: 14.2, top: 33, width: 6.1, height: 30 }),
        lateral('lat_5', 'derecho', 5, { left: 20.6, top: 33, width: 6.1, height: 30 }),
        puerta('puerta_f', 'F', { left: 28.6, top: 35, width: 2.1, height: 30 }),
        puerta('puerta_e', 'E', { left: 31.9, top: 35, width: 2.1, height: 30 }),
        lateral('lat_4', 'derecho', 4, { left: 45.0, top: 33, width: 5.3, height: 30 }),
        lateral('lat_3', 'derecho', 3, { left: 50.9, top: 33, width: 6.4, height: 30 }),
        puerta('puerta_d', 'D', { left: 57.8, top: 35, width: 3.0, height: 30 }),
        puerta('puerta_c', 'C', { left: 62.3, top: 35, width: 2.0, height: 30 }),
        lateral('lat_2', 'derecho', 2, { left: 69.3, top: 33, width: 3.0, height: 30 }),
        lateral('lat_1', 'derecho', 1, { left: 73.0, top: 33, width: 13.3, height: 30 }),
        puerta('puerta_a', 'A', { left: 88.9, top: 35, width: 2.1, height: 30 }),
        puerta('puerta_b', 'B', { left: 92.2, top: 35, width: 2.1, height: 30 }),
      ],
    },
    izquierdo: {
      source: require('../../assets/images/bus-diagrams/mb-o500ua-2836/izquierdo.png'),
      aspectRatio: 1134 / 201,
      ppuMask: { left: 48, top: 82, width: 15, height: 11 },
      zones: [
        lateral('lat_20', 'izquierdo', 20, { left: 2.5, top: 22, width: 5.4, height: 30 }),
        lateral('lat_19', 'izquierdo', 19, { left: 10.3, top: 22, width: 4.3, height: 30 }),
        lateral('lat_18', 'izquierdo', 18, { left: 18.1, top: 22, width: 7.1, height: 30 }),
        lateral('lat_17', 'izquierdo', 17, { left: 25.7, top: 22, width: 7.2, height: 30 }),
        lateral('lat_16', 'izquierdo', 16, { left: 33.3, top: 22, width: 7.1, height: 30 }),
        lateral('lat_15', 'izquierdo', 15, { left: 40.7, top: 22, width: 7.1, height: 30 }),
        lateral('lat_14', 'izquierdo', 14, { left: 48.1, top: 22, width: 6.1, height: 30 }),
        lateral('lat_13', 'izquierdo', 13, { left: 64.2, top: 22, width: 9.3, height: 30 }),
        lateral('lat_12', 'izquierdo', 12, { left: 73.9, top: 22, width: 6.3, height: 30 }),
        lateral('lat_11', 'izquierdo', 11, { left: 80.5, top: 22, width: 6.5, height: 30 }),
        lateral('lat_10', 'izquierdo', 10, { left: 87.3, top: 22, width: 6.3, height: 30 }),
        lateral('lat_9', 'izquierdo', 9, { left: 94.2, top: 22, width: 3.9, height: 30 }),
      ],
    },
    frontal: {
      source: require('../../assets/images/bus-diagrams/mb-o500u-1930/frontal.png'),
      aspectRatio: 303 / 296,
      ppuMask: { left: 30, top: 68, width: 40, height: 10 },
      zones: [
        parabrisas('parabrisas_1', 1, { left: 10, top: 15, width: 38, height: 40 }),
        parabrisas('parabrisas_2', 2, { left: 52, top: 15, width: 38, height: 40 }),
      ],
    },
    trasero: {
      source: require('../../assets/images/bus-diagrams/mb-o500u-1930/trasero.png'),
      aspectRatio: 248 / 297,
      ppuMask: { left: 25, top: 45, width: 50, height: 11 },
      zones: [lunaTrasera({ left: 55, top: 8, width: 25, height: 13 })],
    },
  },
};

/**
 * Foton U10 — la ficha no trae números impresos, pero igual se numera
 * vidrio por vidrio (no por tramo) para poder identificar y llevar stock
 * de cada uno, igual que el Foton U12: vidrio lateral derecho 1-5,
 * izquierdo 6-13, puertas A-D (2 puertas de un solo panel cada lado).
 * Luneta trasera de ancho completo (a diferencia de los otros modelos,
 * que la tienen como ventana pequeña).
 */
const FOTON_U10: BusModelConfig = {
  id: 'foton_u10',
  displayName: 'Foton U10',
  matches: (m) => m.includes('U10'),
  views: {
    derecho: {
      source: require('../../assets/images/bus-diagrams/foton-u10/derecho.png'),
      aspectRatio: 787 / 280,
      ppuMask: { left: 42, top: 62, width: 16, height: 12 },
      zones: [
        lateral('lat_5', 'derecho', 5, { left: 11.4, top: 22, width: 8.7, height: 32 }),
        lateral('lat_4', 'derecho', 4, { left: 22.9, top: 22, width: 8.7, height: 32 }),
        puerta('puerta_d', 'D', { left: 34.1, top: 22, width: 3.3, height: 32 }),
        puerta('puerta_c', 'C', { left: 39.3, top: 22, width: 3.3, height: 32 }),
        lateral('lat_3', 'derecho', 3, { left: 44.7, top: 22, width: 8.7, height: 32 }),
        lateral('lat_2', 'derecho', 2, { left: 55.0, top: 22, width: 8.8, height: 32 }),
        lateral('lat_1', 'derecho', 1, { left: 65.2, top: 22, width: 4.6, height: 32 }),
        puerta('puerta_b', 'B', { left: 77.3, top: 22, width: 3.3, height: 32 }),
        puerta('puerta_a', 'A', { left: 82.5, top: 22, width: 3.3, height: 32 }),
      ],
    },
    izquierdo: {
      source: require('../../assets/images/bus-diagrams/foton-u10/izquierdo.png'),
      aspectRatio: 889 / 265,
      ppuMask: { left: 42, top: 62, width: 16, height: 12 },
      zones: [
        lateral('lat_13', 'izquierdo', 13, { left: 0, top: 22, width: 12.4, height: 32 }),
        lateral('lat_12', 'izquierdo', 12, { left: 15.1, top: 22, width: 6.3, height: 32 }),
        lateral('lat_11', 'izquierdo', 11, { left: 24.7, top: 22, width: 7.8, height: 32 }),
        lateral('lat_10', 'izquierdo', 10, { left: 33.7, top: 22, width: 7.8, height: 32 }),
        lateral('lat_9', 'izquierdo', 9, { left: 43.0, top: 22, width: 7.7, height: 32 }),
        lateral('lat_8', 'izquierdo', 8, { left: 52.3, top: 22, width: 7.7, height: 32 }),
        lateral('lat_7', 'izquierdo', 7, { left: 62.3, top: 22, width: 7.7, height: 32 }),
        lateral('lat_6', 'izquierdo', 6, { left: 72.4, top: 22, width: 7.7, height: 32 }),
      ],
    },
    frontal: {
      source: require('../../assets/images/bus-diagrams/foton-u10/frontal.png'),
      aspectRatio: 291 / 271,
      ppuMask: { left: 28, top: 66, width: 44, height: 10 },
      zones: [
        parabrisas('parabrisas_1', 1, { left: 8, top: 18, width: 42, height: 40 }),
        parabrisas('parabrisas_2', 2, { left: 50, top: 18, width: 42, height: 40 }),
      ],
    },
    trasero: {
      source: require('../../assets/images/bus-diagrams/foton-u10/trasero.png'),
      aspectRatio: 264 / 291,
      ppuMask: { left: 25, top: 46, width: 50, height: 11 },
      zones: [lunaTrasera({ left: 12, top: 25, width: 76, height: 20 })],
    },
  },
};

export const BUS_MODELS: BusModelConfig[] = [FOTON_U12, MB_O500U_1930, MB_O500UA_2836, FOTON_U10];

// La flota real (ver Equipment.model) no trae el fabricante — el campo
// "modelo" que devuelve la intranet es solo el código, ej. "EBUS U12 SC",
// "U12", "O 500 UA 2836 E6", "U 10" (a veces con espacios sueltos entre
// letras y números). Por eso `matches` recibe la versión "compacta" (sin
// ningún espacio) del código: comparar por substring ahí es inmune a que
// el código venga con o sin espacios, con o sin sufijos de fabricante.
function compact(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function findBusModel(modelo?: string | null): BusModelConfig | null {
  if (!modelo) return null;
  const c = compact(modelo);
  return BUS_MODELS.find((m) => m.matches(c)) ?? null;
}
