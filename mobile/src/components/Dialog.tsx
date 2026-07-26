import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { color, font, radius, status, surface } from '../theme/tokens';

/**
 * The app's own dialogs.
 *
 * Stock Alert.alert draws the OS dialog — grey card, teal buttons, system
 * font — which lands in the middle of a black-and-yellow app looking like it
 * belongs to something else. Every confirmation in TRACE is a moment where
 * the rider is deciding whether to lose a ride or leave a crew; that is a
 * poor moment to look unfinished.
 *
 * Deliberately the same signature as Alert.alert, so call sites read
 * identically and the swap carries no behavioural risk:
 *
 *   showAlert('Delete this ride?', 'This cannot be undone.', [
 *     { text: 'Keep it', style: 'cancel' },
 *     { text: 'Delete', style: 'destructive', onPress: doIt },
 *   ]);
 */

export type DialogButton = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

type DialogRequest = {
  title: string;
  message?: string;
  buttons: DialogButton[];
};

let emit: ((req: DialogRequest) => void) | null = null;

/** Drop-in for Alert.alert. Defaults to a single OK, exactly as it does. */
export function showAlert(title: string, message?: string, buttons?: DialogButton[]): void {
  const req: DialogRequest = {
    title,
    message,
    buttons: buttons?.length ? buttons : [{ text: 'OK' }],
  };
  // No host mounted (a test, or a very early crash) — fail loudly in dev
  // rather than swallowing a message the rider was meant to read.
  if (!emit) {
    console.warn(`[dialog] ${title}${message ? ` — ${message}` : ''}`);
    return;
  }
  emit(req);
}

/** Mounted once, at the root. Everything else calls showAlert(). */
export function DialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([]);

  useEffect(() => {
    emit = (req) => setQueue((q) => [...q, req]);
    return () => {
      emit = null;
    };
  }, []);

  const current = queue[0];
  const dismiss = (btn?: DialogButton) => {
    setQueue((q) => q.slice(1));
    // After the frame, so the dialog is gone before whatever this triggers —
    // navigation or another dialog — begins.
    if (btn?.onPress) setTimeout(btn.onPress, 0);
  };

  if (!current) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => dismiss(current.buttons.find((b) => b.style === 'cancel'))}
    >
      <View style={st.scrim}>
        <View style={st.card}>
          <Text style={st.title}>{current.title}</Text>
          {current.message ? <Text style={st.message}>{current.message}</Text> : null}

          <View style={st.buttons}>
            {current.buttons.map((b, i) => (
              <Pressable
                key={`${b.text}-${i}`}
                onPress={() => dismiss(b)}
                style={({ pressed }) => [st.btn, pressed && { backgroundColor: surface.overlay }]}
              >
                <Text
                  style={[
                    st.btnText,
                    b.style === 'destructive' && { color: status.danger },
                    b.style === 'cancel' && { color: color.steel },
                  ]}
                >
                  {b.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: surface.overlay,
    borderWidth: 1,
    borderColor: surface.stroke,
    borderRadius: radius.card,
    paddingTop: 22,
    paddingHorizontal: 22,
    paddingBottom: 8,
  },
  title: {
    fontFamily: font.displaySemi,
    fontSize: 19,
    color: color.white,
    lineHeight: 24,
  },
  message: {
    fontFamily: font.body,
    fontSize: 14,
    color: color.steel,
    lineHeight: 20,
    marginTop: 10,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    marginTop: 18,
  },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    minHeight: 44, // §5 hit target
    justifyContent: 'center',
  },
  btnText: {
    fontFamily: font.bodySemi,
    fontSize: 14,
    color: color.white,
    letterSpacing: 0.2,
  },
});
