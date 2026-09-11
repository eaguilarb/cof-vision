import { useState, type ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

/**
 * Botón/tarjeta presionable con feedback físico real (Reanimated, no el
 * `Animated` clásico) — se encoge 3% al tocar, como cualquier app nativa
 * seria. Sigue la receta de animate-expo: transición CSS de Reanimated,
 * sin gesto ni shared value porque el toque no es continuo.
 */
export function PressableScale({
  onPress,
  disabled,
  style,
  children,
}: {
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      hitSlop={8}
      pressRetentionOffset={16}
    >
      <Animated.View
        style={[
          style,
          {
            transform: [{ scale: pressed ? 0.97 : 1 }],
            transitionProperty: 'transform',
            transitionDuration: '120ms',
            transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
          } as StyleProp<ViewStyle>,
          disabled && { opacity: 0.7 },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}
