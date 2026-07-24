import * as Haptics from 'expo-haptics';

/**
 * Haptics (§4), one thin surface so intent stays readable at the call site and
 * the whole thing is trivial to mute. The rule that matters: feedback marks a
 * deliberate act — a primary tap, a tab change, a ride saved. Never on scroll,
 * never on every list row, never on passive state changes.
 *
 * Every call is fire-and-forget and swallows its own error: a device without a
 * motor, or with haptics disabled in settings, must never throw into a flow.
 */

/** A primary action fired — start/finish/post/send. */
export function tapPrimary() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** A lighter tick — tab change, toggle, selection. */
export function tick() {
  Haptics.selectionAsync().catch(() => {});
}

/** Something completed and mattered — a ride saved, a report sent. */
export function success() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** A weightier single knock — reserved for a real moment (a route matched). */
export function impact() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Something was refused or went wrong, where the user should feel it. */
export function warn() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
