/**
 * §8 design tokens — extracted from trace_prototype.html, the source of truth.
 *
 * The signal rule: `signal` blue means LIVE or ACTIVE and nothing else.
 * Recording indicator, active bike tag, current position, in-progress track,
 * primary action. Never decoration. Warnings are amber, never blue.
 * GPS status stays green — signal-light language doesn't bend to brand color.
 */
export const color = {
  // Premium pass (2026-07-18): pitch black base, glass surfaces, soft depth.
  // Signal went YELLOW (user decision) — the rule is unchanged: signal means
  // live/active and nothing else. Warnings moved to orange so caution never
  // wears the signal color.
  void: '#000000', // base background — true black
  slate: '#0D0F12', // card / panel (over black)
  slate2: '#16191E', // raised control
  white: '#EDEFF1', // primary text, data
  signal: '#FFD60A', // LIVE/ACTIVE ONLY
  signalDown: '#9C7F00', // button travel shadow under signal
  amber: '#FF8A4C', // warnings only (orange — distinct from yellow signal)
  moss: '#3F5570', // dormant / secondary state
  steel: '#8F969C', // labels, captions, units
  hair: 'rgba(237,239,241,0.09)', // dividers
  gpsGood: '#7BC47F', // GPS status green — universal signal language
  dim: '#5D646B', // inactive tab text, footnotes
  // Glass system — used on floating chrome (tab bar, sheets), never on
  // dense content where blur hurts readability.
  glass: 'rgba(255,255,255,0.05)',
  glassBorder: 'rgba(255,255,255,0.09)',
  glassStrong: 'rgba(22,26,31,0.72)',
} as const;

/** Soft elevation for cards and floating chrome (boxShadow strings). */
export const shadow = {
  card: '0 8px 24px rgba(0, 0, 0, 0.55)',
  float: '0 12px 34px rgba(0, 0, 0, 0.65)',
  signalGlow: '0 6px 22px rgba(255, 214, 10, 0.38)',
} as const;

/**
 * Loaded in the root layout via @expo-google-fonts. Use these family names,
 * never raw strings, so a font swap is one edit — third swap (2026-07-18):
 * one-family Manrope system, the open-source analog of Uber Move. Premium
 * apps own a single family; the weights do the talking. "mono" keys stay for
 * compatibility but now render Manrope semibold, tracked and uppercased by
 * the label components.
 */
export const font = {
  display: 'Manrope_800ExtraBold',
  displaySemi: 'Manrope_700Bold',
  displayMedium: 'Manrope_600SemiBold',
  body: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodySemi: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
  mono: 'Manrope_600SemiBold',
  monoMedium: 'Manrope_600SemiBold',
  monoBold: 'Manrope_700Bold',
} as const;

/** Layout constants (§8 layout patterns). */
export const layout = {
  screenPadding: 26,
  cardRadius: 14,
  /** Record screen and any in-ride control: minimum touch target (§8 ergonomics). */
  rideTouchTarget: 64,
  /** The record button. Oversized on purpose — gloves at 3,000 m. Not a mistake. */
  recordButtonHeight: 76,
} as const;

/**
 * Mono label style values (§8): always uppercase, letter-spaced, steel.
 * RN letterSpacing is in px, not em: at ~9px mono, .14em–.24em ≈ 1.3–2.2px.
 */
export const monoLabel = {
  fontFamily: font.mono,
  color: color.steel,
  fontSize: 9,
  letterSpacing: 1.6,
  textTransform: 'uppercase' as const,
};

/** Odometer motion (§8): heavy, mechanical, settles rather than eases. */
export const motion = {
  odometerDigitMs: 580,
  odometerStaggerMs: 85,
  recordingPulseMs: 1600,
  buttonTravelMs: 70,
  buttonTravelPx: 5,
} as const;
