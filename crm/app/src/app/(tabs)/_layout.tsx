import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '@/state/auth-context';
import { colors } from '@/constants/colors';
import { fontFamily } from '@/constants/typography';
import {
  CasesIcon,
  EquipmentIcon,
  ProfileIcon,
  ReportsIcon,
  TechniciansIcon,
  UsersIcon,
} from '@/components/tab-icons';

export default function TabsLayout() {
  const { user, isLoading, module } = useAuth();

  if (!isLoading && !user) {
    return <Redirect href="/login" />;
  }
  if (!isLoading && !module) {
    return <Redirect href="/module-select" />;
  }

  const isAdmin = user?.role === 'admin';
  const canSeeReports = user?.role === 'admin' || user?.role === 'operator';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fontFamily.semibold, fontSize: 11 },
        tabBarStyle: { borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fontFamily.bold },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Casos',
          tabBarIcon: ({ color }) => <CasesIcon color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="equipment"
        options={{
          title: 'Equipos',
          tabBarIcon: ({ color }) => <EquipmentIcon color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reportes',
          href: canSeeReports ? undefined : null,
          tabBarIcon: ({ color }) => <ReportsIcon color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="technicians"
        options={{
          title: 'Técnicos',
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ color }) => <TechniciansIcon color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="users"
        options={{
          title: 'Usuarios',
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ color }) => <UsersIcon color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color }) => <ProfileIcon color={color as string} />,
        }}
      />
    </Tabs>
  );
}
