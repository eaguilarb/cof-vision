import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { RedBusIllustration, RED_BUS_ASPECT_RATIO } from '@/components/red-bus-illustration';

/**
 * Escena decorativa para la pantalla de login: cielo con degradado, un
 * camino y un bus articulado RED cruzando en loop infinito. El recorrido
 * arranca y termina totalmente fuera de pantalla para que el reinicio del
 * loop sea invisible (no hay "salto" del bus).
 */
export function AnimatedBusScene({ height = 190 }: { height?: number }) {
  const { width } = useWindowDimensions();
  const busWidth = Math.min(width * 0.62, 420);
  const busHeight = busWidth / RED_BUS_ASPECT_RATIO;

  const drive = useRef(new Animated.Value(0)).current;
  const bounce = useRef(new Animated.Value(0)).current;
  const cloud1 = useRef(new Animated.Value(0)).current;
  const cloud2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const driveLoop = Animated.loop(
      Animated.timing(drive, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }),
    );
    const bounceLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: 1, duration: 220, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0, duration: 220, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    const cloudLoop1 = Animated.loop(
      Animated.timing(cloud1, { toValue: 1, duration: 22000, easing: Easing.linear, useNativeDriver: true }),
    );
    const cloudLoop2 = Animated.loop(
      Animated.timing(cloud2, { toValue: 1, duration: 30000, easing: Easing.linear, useNativeDriver: true }),
    );
    driveLoop.start();
    bounceLoop.start();
    cloudLoop1.start();
    cloudLoop2.start();
    return () => {
      driveLoop.stop();
      bounceLoop.stop();
      cloudLoop1.stop();
      cloudLoop2.stop();
    };
  }, [drive, bounce, cloud1, cloud2]);

  const translateX = drive.interpolate({ inputRange: [0, 1], outputRange: [-busWidth - 20, width + 20] });
  const translateY = bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -2.5] });
  const cloud1X = cloud1.interpolate({ inputRange: [0, 1], outputRange: [-80, width + 80] });
  const cloud2X = cloud2.interpolate({ inputRange: [0, 1], outputRange: [width + 60, -60] });

  return (
    <View style={[styles.wrap, { height }]}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#bfe0fb" />
            <Stop offset="1" stopColor="#eef6fd" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#sky)" />
      </Svg>

      <Animated.View
        style={[styles.cloud, { top: height * 0.16, width: 64, height: 22, transform: [{ translateX: cloud1X }] }]}
      />
      <Animated.View
        style={[styles.cloud, { top: height * 0.32, width: 46, height: 16, transform: [{ translateX: cloud2X }] }]}
      />

      <View style={[styles.road, { height: height * 0.24 }]}>
        <View style={styles.roadDashRow}>
          {Array.from({ length: 14 }).map((_, i) => (
            <View key={i} style={styles.roadDash} />
          ))}
        </View>
      </View>

      <Animated.View
        style={[
          styles.bus,
          {
            width: busWidth,
            height: busHeight,
            bottom: height * 0.2,
            transform: [{ translateX }, { translateY }],
          },
        ]}
      >
        <RedBusIllustration width={busWidth} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', overflow: 'hidden', backgroundColor: '#eef6fd' },
  cloud: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 999,
  },
  road: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#3a3f47',
    justifyContent: 'center',
  },
  roadDashRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12 },
  roadDash: { width: 22, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.6)' },
  bus: { position: 'absolute', left: 0 },
});
