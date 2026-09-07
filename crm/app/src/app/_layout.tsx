import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { registerForPushNotifications } from '@/notifications';
import { AuthProvider, useAuth } from '@/state/auth-context';

const queryClient = new QueryClient();

function PushNotificationsRegistrar() {
  const { user } = useAuth();

  useEffect(() => {
    if (user) registerForPushNotifications();
  }, [user]);

  return null;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PushNotificationsRegistrar />
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
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
