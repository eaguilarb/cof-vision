import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import { registerForPushNotifications } from '@/notifications';
import { AuthProvider, useAuth } from '@/state/auth-context';
import { colors } from '@/constants/colors';

/**
 * Botón de "volver"/"cerrar" del header propio, en vez del ícono que trae
 * por defecto expo-router — ese ícono se sirve desde un asset dentro de
 * node_modules, y el despliegue en Vercel excluye cualquier archivo bajo
 * una carpeta con ese nombre (la misma causa de la caída con la tipografía).
 */
function HeaderBack({ label }: { label: string }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
      hitSlop={10}
      style={{ paddingRight: 12, paddingVertical: 4 }}
    >
      <Text style={{ fontSize: 22, color: colors.primary, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const queryClient = new QueryClient();

SplashScreen.preventAutoHideAsync().catch(() => {});

function PushNotificationsRegistrar() {
  const { user } = useAuth();

  useEffect(() => {
    if (user) registerForPushNotifications();
  }, [user]);

  return null;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular: require('../../assets/fonts/PlusJakartaSans-Regular.ttf'),
    PlusJakartaSans_500Medium: require('../../assets/fonts/PlusJakartaSans-Medium.ttf'),
    PlusJakartaSans_600SemiBold: require('../../assets/fonts/PlusJakartaSans-SemiBold.ttf'),
    PlusJakartaSans_700Bold: require('../../assets/fonts/PlusJakartaSans-Bold.ttf'),
    PlusJakartaSans_800ExtraBold: require('../../assets/fonts/PlusJakartaSans-ExtraBold.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  // Nunca bloquear el arranque de la app por la tipografía: si por
  // cualquier motivo la fuente no carga (o falla), se sigue con la
  // fuente del sistema en vez de dejar la pantalla en blanco para
  // siempre — un fallo aquí no debe tumbar toda la app.
  if (!fontsLoaded && !fontError) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PushNotificationsRegistrar />
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="module-select" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="case/[id]"
            options={{ headerShown: true, title: 'Caso', headerLeft: () => <HeaderBack label="‹" /> }}
          />
          <Stack.Screen
            name="case/new"
            options={{
              headerShown: true,
              title: 'Nuevo caso',
              presentation: 'modal',
              headerLeft: () => <HeaderBack label="✕" />,
            }}
          />
        </Stack>
      </AuthProvider>
    </QueryClientProvider>
  );
}
