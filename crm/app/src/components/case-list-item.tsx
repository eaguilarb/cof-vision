import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { colors, priorityColors, statusColors } from '@/constants/colors';
import { fontFamily } from '@/constants/typography';
import { PRIORITY_LABELS, STATUS_LABELS, type Case, type Technician } from '@/api/types';
import { Badge } from './badge';

function plural(n: number): string {
  return n === 1 ? 'día' : 'días';
}

function ageLabel(item: Case): string {
  if (item.status === 'resolved') {
    return item.resolvedInDays === 0
      ? 'Resuelto hoy'
      : `Resuelto en ${item.resolvedInDays} ${plural(item.resolvedInDays!)}`;
  }
  return item.daysOpen === 0 ? 'Abierto hoy' : `${item.daysOpen} ${plural(item.daysOpen)} abierto`;
}

/**
 * Acción revelada al deslizar la tarjeta hacia la izquierda — atajo
 * directo al caso, con el color de su prioridad. Sigue la receta de
 * animate-expo: `Swipeable` de gesture-handler (ya resuelve umbral,
 * overshoot y física en el hilo de UI), nada armado a mano.
 */
function RightAction({
  progress,
  color,
  onPress,
}: {
  progress: SharedValue<number>;
  color: string;
  onPress: () => void;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.get(), [0, 1], [72, 0], Extrapolation.CLAMP) }],
  }));
  return (
    <Animated.View style={[styles.swipeActionWrap, style]}>
      <Pressable style={[styles.swipeAction, { backgroundColor: color }]} onPress={onPress}>
        <Text style={styles.swipeActionText}>Ver{'\n'}caso</Text>
      </Pressable>
    </Animated.View>
  );
}

export function CaseListItem({ item, technicians }: { item: Case; technicians: Technician[] }) {
  const router = useRouter();
  const swipeRef = useRef<SwipeableMethods>(null);
  const technician = technicians.find((t) => t.id === item.assignedTechnicianId);

  function goToCase() {
    swipeRef.current?.close();
    router.push(`/case/${item.id}`);
  }

  return (
    <Swipeable
      ref={swipeRef}
      containerStyle={styles.swipeContainer}
      friction={1.6}
      rightThreshold={44}
      overshootRight={false}
      renderRightActions={(progress) => (
        <RightAction progress={progress} color={priorityColors[item.priority]} onPress={goToCase} />
      )}
    >
      <Pressable style={styles.card} onPress={goToCase}>
        <View style={styles.headerRow}>
          <Text style={styles.code}>{item.code}</Text>
          <Badge label={PRIORITY_LABELS[item.priority]} color={priorityColors[item.priority]} />
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.client} numberOfLines={1}>
          {item.clientName}
        </Text>
        <View style={styles.footerRow}>
          <Badge label={STATUS_LABELS[item.status]} color={statusColors[item.status]} />
          <Text style={styles.technician} numberOfLines={1}>
            {technician ? technician.name : 'Sin asignar'}
          </Text>
        </View>
        <Text style={styles.age}>{ageLabel(item)}</Text>
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  swipeContainer: { marginBottom: 10 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 6,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  code: {
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: fontFamily.semibold,
  },
  title: {
    fontSize: 16,
    fontFamily: fontFamily.bold,
    color: colors.text,
  },
  client: {
    fontSize: 13,
    fontFamily: fontFamily.medium,
    color: colors.textMuted,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  technician: {
    fontSize: 13,
    fontFamily: fontFamily.medium,
    color: colors.textMuted,
    maxWidth: '55%',
  },
  age: {
    fontSize: 11,
    fontFamily: fontFamily.medium,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  swipeActionWrap: { width: 72, marginLeft: 8 },
  swipeAction: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeActionText: {
    color: '#fff',
    fontFamily: fontFamily.bold,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 15,
  },
});
