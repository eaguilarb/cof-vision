import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { colors } from '@/constants/colors';
import { fontFamily } from '@/constants/typography';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface DonutSegment {
  key: string;
  value: number;
  color: string;
}

/**
 * Gráfico de dona animado (sin dependencias externas, react-native-svg
 * puro) para mostrar la distribución de casos por estado con color. El
 * trazo de cada segmento crece desde 0 al montar el componente.
 */
export function StatusDonut({
  segments,
  total,
  size = 108,
  strokeWidth = 14,
}: {
  segments: DonutSegment[];
  total: number;
  size?: number;
  strokeWidth?: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 900, useNativeDriver: false }).start();
  }, [progress, total]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let cumulative = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const fraction = total > 0 ? s.value / total : 0;
      const start = cumulative;
      cumulative += fraction;
      return { ...s, start, fraction };
    });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${center}, ${center}`}>
          <Circle cx={center} cy={center} r={radius} stroke="#eef1f5" strokeWidth={strokeWidth} fill="none" />
          {arcs.map((arc) => {
            const arcLength = arc.fraction * circumference;
            const dashArray = progress.interpolate({
              inputRange: [0, 1],
              outputRange: [`0 ${circumference}`, `${arcLength} ${circumference}`],
            });
            return (
              <AnimatedCircle
                key={arc.key}
                cx={center}
                cy={center}
                r={radius}
                stroke={arc.color}
                strokeWidth={strokeWidth}
                strokeDasharray={dashArray}
                strokeDashoffset={-arc.start * circumference}
                strokeLinecap="round"
                fill="none"
              />
            );
          })}
        </G>
      </Svg>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={styles.centerLabel}>
          <Text style={styles.centerValue}>{total}</Text>
          <Text style={styles.centerCaption}>{total === 1 ? 'caso' : 'casos'}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centerLabel: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerValue: { fontSize: 22, fontFamily: fontFamily.extrabold, color: colors.text },
  centerCaption: { fontSize: 10, fontFamily: fontFamily.medium, color: colors.textMuted, marginTop: -2 },
});
