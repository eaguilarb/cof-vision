import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

const RED = '#c8202e';
const RED_DARK = '#9c1622';
const BODY = '#f7f8fa';
const SKIRT = '#c7ccd1';
const CHARCOAL = '#2b2e33';
const WHEEL_HUB = '#8b9096';

/**
 * Reemplazo vectorial de los bosquejos genéricos frontal/trasero
 * (bus-front.png / bus-rear.png) — esos PNG traían ruido/manchas de un
 * "recorte y despintado" anterior sobre la ficha técnica real y se veían
 * rotos. Un dibujo propio, plano y limpio, no tiene ese riesgo. Se usan
 * solo cuando el modelo del bus no coincide con ninguno de los 4
 * modelos con ficha propia (bus-models.ts) — la mayoría del parque sí
 * tiene su diagrama específico y no pasa por aquí.
 */
export const GENERIC_FRONT_ASPECT_RATIO = 260 / 225;
export const GENERIC_REAR_ASPECT_RATIO = 190 / 225;

export function GenericBusFront({ width }: { width: number }) {
  const height = width / GENERIC_FRONT_ASPECT_RATIO;
  const vbW = 260;
  const vbH = 225;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${vbW} ${vbH}`}>
      <Defs>
        <LinearGradient id="frontGlass" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#8fc2e3" />
          <Stop offset="1" stopColor="#4a7a9c" />
        </LinearGradient>
      </Defs>

      {/* Carrocería */}
      <Rect x={22} y={38} width={216} height={172} rx={26} fill={BODY} />
      {/* Techo rojo */}
      <Rect x={22} y={30} width={216} height={24} rx={12} fill={RED} />
      {/* Faldón inferior */}
      <Rect x={22} y={178} width={216} height={32} rx={10} fill={SKIRT} />
      {/* Parachoques rojo */}
      <Rect x={22} y={168} width={216} height={14} fill={RED} />

      {/* Parabrisas (una sola luna dividida al medio) */}
      <Rect x={44} y={70} width={172} height={92} rx={10} fill="url(#frontGlass)" />
      <Rect x={126} y={70} width={8} height={92} fill={CHARCOAL} />

      {/* Espejos */}
      <Rect x={10} y={78} width={14} height={28} rx={5} fill={CHARCOAL} />
      <Rect x={236} y={78} width={14} height={28} rx={5} fill={CHARCOAL} />

      {/* Faros */}
      <Circle cx={52} cy={186} r={11} fill="#ffe08a" />
      <Circle cx={208} cy={186} r={11} fill="#ffe08a" />

      {/* Ruedas */}
      <Circle cx={64} cy={210} r={17} fill={CHARCOAL} />
      <Circle cx={64} cy={210} r={7.5} fill={WHEEL_HUB} />
      <Circle cx={196} cy={210} r={17} fill={CHARCOAL} />
      <Circle cx={196} cy={210} r={7.5} fill={WHEEL_HUB} />
    </Svg>
  );
}

export function GenericBusRear({ width }: { width: number }) {
  const height = width / GENERIC_REAR_ASPECT_RATIO;
  const vbW = 190;
  const vbH = 225;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${vbW} ${vbH}`}>
      <Defs>
        <LinearGradient id="rearGlass" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#8fc2e3" />
          <Stop offset="1" stopColor="#4a7a9c" />
        </LinearGradient>
      </Defs>

      {/* Carrocería */}
      <Rect x={12} y={38} width={166} height={172} rx={22} fill={BODY} />
      {/* Techo rojo */}
      <Rect x={12} y={30} width={166} height={24} rx={12} fill={RED} />
      {/* Faldón inferior */}
      <Rect x={12} y={178} width={166} height={32} rx={10} fill={SKIRT} />
      {/* Parachoques rojo */}
      <Rect x={12} y={168} width={166} height={14} fill={RED} />

      {/* Luneta trasera */}
      <Rect x={40} y={64} width={110} height={62} rx={8} fill="url(#rearGlass)" />

      {/* Luces traseras */}
      <Rect x={20} y={150} width={16} height={26} rx={6} fill={RED_DARK} />
      <Rect x={154} y={150} width={16} height={26} rx={6} fill={RED_DARK} />

      {/* Ruedas */}
      <Circle cx={48} cy={210} r={17} fill={CHARCOAL} />
      <Circle cx={48} cy={210} r={7.5} fill={WHEEL_HUB} />
      <Circle cx={142} cy={210} r={17} fill={CHARCOAL} />
      <Circle cx={142} cy={210} r={7.5} fill={WHEEL_HUB} />
    </Svg>
  );
}
