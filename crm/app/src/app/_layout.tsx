import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { registerForPushNotifications } from '@/notifications';
import { AuthProvider, useAuth } from '@/state/auth-context';

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
          <Stack.Screen name="case/[id]" options={{ headerShown: true, title: 'Caso' }} />
          <Stack.Screen
            name="case/new"
            options={{ headerShown: true, title: 'Nuevo caso', presentation: 'modal' }}
          />
        </Stack>
      </AuthProvider>
    </QueryClientProvider>
  );
}
