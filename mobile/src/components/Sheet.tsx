import { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, font, layout, shadow } from '../theme/tokens';
import { MonoLabel } from './ui';

/**
 * Bottom sheet: the modal shape phones taught everyone. Glass over a dimmed
 * world, a grab handle, tap-outside to dismiss. Used for the create menu and
 * for the questions a planned ride puts to whoever joins it.
 */
export function Sheet({
  visible,
  onClose,
  label,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  label?: string;
  title?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={st.root}>
        <Pressable style={st.backdrop} onPress={onClose} />
        <View style={[st.sheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={st.handle} />
          {label ? <MonoLabel size={8.5} style={{ marginBottom: 6 }}>{label}</MonoLabel> : null}
          {title ? <Text style={st.title}>{title}</Text> : null}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ flexGrow: 0 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  sheet: {
    backgroundColor: color.glassStrong,
    borderTopWidth: 1,
    borderTopColor: color.glassBorder,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 10,
    maxHeight: '85%',
    boxShadow: shadow.float,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.hair,
    marginBottom: 16,
  },
  title: {
    fontFamily: font.display,
    fontSize: 26,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 28,
    marginBottom: 16,
  },
});
