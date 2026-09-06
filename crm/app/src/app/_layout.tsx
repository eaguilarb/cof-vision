import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '@/state/auth-context';

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
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
