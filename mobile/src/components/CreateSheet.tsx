import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, font } from '../theme/tokens';
import { Sheet } from './Sheet';

/**
 * The + menu (co-founder decision 2026-07-21): two things a rider can put into
 * the world, named plainly. Tags used to live here as a taxonomy nobody asked
 * for; this is the choice that actually matters.
 */
const OPTIONS = [
  {
    key: 'post',
    icon: 'edit-3' as const,
    title: 'Post',
    sub: 'A thought, a question, a road worth warning people about',
    href: '/post/new',
  },
  {
    key: 'ride',
    icon: 'map' as const,
    title: 'Ride',
    sub: 'Plan one others can join — date, meetup, who it suits',
    href: '/invite/new',
  },
];

export function CreateSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const go = (href: string) => {
    onClose();
    router.push(href as never);
  };

  return (
    <Sheet visible={visible} onClose={onClose} label="Add to the feed" title="What's it going to be?">
      {OPTIONS.map((o) => (
        <Pressable key={o.key} onPress={() => go(o.href)}>
          {({ pressed }) => (
            <View style={[st.row, pressed && { backgroundColor: color.slate2 }]}>
              <View style={st.puck}>
                <Feather name={o.icon} size={19} color={color.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.title}>{o.title}</Text>
                <Text style={st.sub}>{o.sub}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={color.dim} />
            </View>
          )}
        </Pressable>
      ))}
    </Sheet>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: color.glassBorder,
    borderRadius: 14,
    backgroundColor: color.glass,
  },
  puck: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.slate2,
  },
  title: {
    fontFamily: font.display,
    fontSize: 19,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 21,
  },
  sub: { fontFamily: font.body, fontSize: 12, color: color.steel, marginTop: 4, lineHeight: 17 },
});
