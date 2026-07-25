import { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { color, font, layout } from '../theme/tokens';
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
  scroll = true,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  label?: string;
  title?: string;
  /** Off when the contents scroll themselves — nested vertical scrollers
   *  fight each other for the gesture, and the wheels always lose. */
  scroll?: boolean;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Without this the keyboard covers the sheet — which is fatal for a
          sheet whose whole purpose is a search field. */}
      <KeyboardAvoidingView
        style={st.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={st.backdrop} onPress={onClose} />
        <View
          style={[
            st.sheet,
            // Android doesn't resize under edge-to-edge, so the sheet is
            // lifted by the measured keyboard height instead.
            { paddingBottom: insets.bottom + 20, marginBottom: Platform.OS === 'android' ? kb : 0 },
          ]}
        >
          <View style={st.handle} />
          {label ? <MonoLabel size={8.5} style={{ marginBottom: 6 }}>{label}</MonoLabel> : null}
          {title ? <Text style={st.title}>{title}</Text> : null}
          {scroll ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={{ flexGrow: 0 }}
            >
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </View>
      </KeyboardAvoidingView>
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
    // Overlay surface, hairline top, no shadow (§0.3 / §2).
    backgroundColor: color.slate2,
    borderTopWidth: 1,
    borderTopColor: color.hair,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 10,
    maxHeight: '85%',
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
