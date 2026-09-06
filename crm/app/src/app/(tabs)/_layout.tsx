import { Redirect, Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useAuth } from '@/state/auth-context';
import { colors } from '@/constants/colors';

function TabIcon({ symbol }: { symbol: string }) {
  return <Text style={{ fontSize: 20 }}>{symbol}</Text>;
}

export default function TabsLayout() {
  const { user, isLoading } = useAuth();

  if (!isLoading && !user) {
    return <Redirect href="/login" />;
  }

  const isAdmin = user?.role === 'admin';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Casos',
          tabBarIcon: () => <TabIcon symbol="🗂️" />,
        }}
      />
      <Tabs.Screen
        name="equipment"
        options={{
          title: 'Equipos',
          tabBarIcon: () => <TabIcon symbol="🖥️" />,
        }}
      />
      <Tabs.Screen
        name="technicians"
        options={{
          title: 'Técnicos',
          href: isAdmin ? undefined : null,
          tabBarIcon: () => <TabIcon symbol="🧑‍🔧" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: () => <TabIcon symbol="👤" />,
        }}
      />
    </Tabs>
  );
}
