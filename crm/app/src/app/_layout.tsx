import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
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
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

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
