import Svg, { Circle, Defs, Ellipse, LinearGradient, Line, Rect, Stop } from 'react-native-svg';

const VB_WIDTH = 640;
const VB_HEIGHT = 180;
export const RED_BUS_ASPECT_RATIO = VB_WIDTH / VB_HEIGHT;

const RED = '#c8202e';
const RED_DARK = '#9c1622';
const BODY = '#f7f8fa';
const SKIRT = '#c7ccd1';
const CHARCOAL = '#2b2e33';
const WHEEL_HUB = '#8b9096';

interface Window {
  x: number;
  w: number;
}

// Ventanas a cada lado de la articulación (hueco central reservado al fuelle).
const LEFT_WINDOWS: Window[] = [
  { x: 34, w: 46 },
  { x: 86, w: 46 },
  { x: 146, w: 30 }, // puerta
  { x: 182, w: 46 },
  { x: 234, w: 46 },
];
const RIGHT_WINDOWS: Window[] = [
  { x: 366, w: 46 },
  { x: 418, w: 30 }, // puerta
  { x: 454, w: 46 },
  { x: 506, w: 46 },
  { x: 558, w: 40 },
];
const WHEEL_X = [96, 258, 398, 548];

/**
 * Ilustración vectorial (no una foto/recorte) de un bus articulado estilo
 * RED Movilidad — dibujada a mano con formas planas para verse nítida a
 * cualquier tamaño y no depender de un raster de baja resolución.
 */
export function RedBusIllustration({ width }: { width: number }) {
  const height = width / RED_BUS_ASPECT_RATIO;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}>
      <Defs>
        <LinearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7fb8dd" />
          <Stop offset="1" stopColor="#3f6f92" />
        </LinearGradient>
        <LinearGradient id="bodyShade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#ffffff" />
          <Stop offset="1" stopColor={BODY} />
        </LinearGradient>
      </Defs>

      <Ellipse cx={VB_WIDTH / 2} cy={168} rx={280} ry={7} fill="rgba(15,23,42,0.16)" />

      {/* Carrocería */}
      <Rect x={16} y={46} width={608} height={78} rx={14} fill="url(#bodyShade)" />
      {/* Techo (franja roja) */}
      <Rect x={16} y={38} width={608} height={16} rx={8} fill={RED} />
      {/* Faldón inferior */}
      <Rect x={16} y={112} width={608} height={16} rx={6} fill={SKIRT} />
      {/* Franja roja bajo ventanas */}
      <Rect x={16} y={100} width={608} height={10} fill={RED} />

      {/* Fuelle articulado (centro) */}
      <Rect x={292} y={46} width={56} height={78} fill={CHARCOAL} />
      {Array.from({ length: 6 }).map((_, i) => (
        <Line
          key={i}
          x1={298 + i * 9}
          y1={46}
          x2={298 + i * 9 + 14}
          y2={124}
          stroke="rgba(255,255,255,0.22)"
          strokeWidth={2}
        />
      ))}

      {/* Ventanas cuerpo delantero y trasero */}
      {[...LEFT_WINDOWS, ...RIGHT_WINDOWS].map((win, i) => (
        <Rect key={i} x={win.x} y={54} width={win.w} height={34} rx={6} fill="url(#glass)" />
      ))}

      {/* Parabrisas delantero (extremo derecho, redondeado) */}
      <Rect x={588} y={54} width={26} height={34} rx={8} fill="url(#glass)" />
      {/* Luneta trasera (extremo izquierdo) */}
      <Rect x={20} y={54} width={22} height={34} rx={8} fill="url(#glass)" />

      {/* Espejo retrovisor */}
      <Rect x={612} y={50} width={12} height={5} rx={2} fill={CHARCOAL} />

      {/* Ruedas */}
      {WHEEL_X.map((x, i) => (
        <Circle key={`tire-${i}`} cx={x} cy={128} r={20} fill={CHARCOAL} />
      ))}
      {WHEEL_X.map((x, i) => (
        <Circle key={`hub-${i}`} cx={x} cy={128} r={9} fill={WHEEL_HUB} />
      ))}

      {/* Luz delantera / trasera */}
      <Rect x={608} y={92} width={8} height={6} rx={2} fill="#ffe08a" />
      <Rect x={24} y={92} width={8} height={6} rx={2} fill={RED_DARK} />
    </Svg>
  );
}
