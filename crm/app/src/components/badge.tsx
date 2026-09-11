import { StyleSheet, Text, View } from 'react-native';
import { fontFamily } from '@/constants/typography';

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.container, { backgroundColor: `${color}1a` }]}>
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontFamily: fontFamily.semibold,
  },
});
