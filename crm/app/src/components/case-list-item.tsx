import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, priorityColors, statusColors } from '@/constants/colors';
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

export function CaseListItem({ item, technicians }: { item: Case; technicians: Technician[] }) {
  const router = useRouter();
  const technician = technicians.find((t) => t.id === item.assignedTechnicianId);

  return (
    <Pressable style={styles.card} onPress={() => router.push(`/case/${item.id}`)}>
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
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  code: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  client: {
    fontSize: 13,
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
    color: colors.textMuted,
    maxWidth: '55%',
  },
  age: {
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
});
