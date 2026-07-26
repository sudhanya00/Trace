import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * The height the keyboard currently occupies, or 0.
 *
 * KeyboardAvoidingView is not enough on Android here. It was configured with
 * `behavior={undefined}`, which relies on the window itself resizing under
 * adjustResize — and with edge-to-edge (default since SDK 54) the window does
 * NOT resize, the insets change instead. So the chat input sat behind the
 * keyboard with nothing to push it up.
 *
 * Reading the height directly and padding by it works under both models. The
 * Expo guide's richer answer is react-native-keyboard-controller, which
 * animates frame-by-frame — worth adopting if this ever feels a step behind,
 * but it pulls in Reanimated and a native rebuild for a fix this size.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS reports Will* early enough to move with the animation; Android only
    // fires Did*, so each platform gets the earliest event it actually has.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
