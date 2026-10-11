import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

export default function Placeholder({ title, emoji, nota }: { title: string; emoji: string; nota: string }) {
  return (
    <View style={s.container}>
      <Text style={s.emoji}>{emoji}</Text>
      <Text style={s.title}>{title}</Text>
      <Text style={s.nota}>{nota}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emoji: { fontSize: 44, marginBottom: 12 },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  nota: { color: theme.colors.textDim, fontSize: 14, textAlign: 'center' },
});
