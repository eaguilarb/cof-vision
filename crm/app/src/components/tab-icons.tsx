import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * Iconos de línea para la barra de pestañas — reemplazan los emojis
 * (🗂️🖥️📊🧑‍🔧🛡️👤) que se veían inconsistentes entre plataformas y
 * anticuados. Trazo uniforme, sin dependencias de fuentes/assets.
 */
interface IconProps {
  color: string;
  size?: number;
}

const STROKE_WIDTH = 1.8;

function iconProps(color: string) {
  return {
    stroke: color,
    strokeWidth: STROKE_WIDTH,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
}

export function CasesIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 7.5a2 2 0 0 1 2-2h3.2l1.4 1.8H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7.5Z" {...iconProps(color)} />
    </Svg>
  );
}

export function EquipmentIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={3.5} y={5} width={17} height={11} rx={1.6} {...iconProps(color)} />
      <Path d="M9 20h6M12 16v4" {...iconProps(color)} />
    </Svg>
  );
}

export function ReportsIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 19V10M12 19V5M19 19v-6" {...iconProps(color)} />
    </Svg>
  );
}

export function TechniciansIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M14.7 6.3a3 3 0 0 1-3.9 3.9L6 15v3h3l4.8-4.8a3 3 0 0 1 3.9-3.9L20 7l-3-3-2.3 2.3Z"
        {...iconProps(color)}
      />
    </Svg>
  );
}

export function UsersIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3.5 5.5 6v5.2c0 4.1 2.8 7 6.5 9.3 3.7-2.3 6.5-5.2 6.5-9.3V6L12 3.5Z" {...iconProps(color)} />
    </Svg>
  );
}

export function ProfileIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={8.5} r={3.3} {...iconProps(color)} />
      <Path d="M5.5 20c1.2-3.3 3.8-5 6.5-5s5.3 1.7 6.5 5" {...iconProps(color)} />
    </Svg>
  );
}
