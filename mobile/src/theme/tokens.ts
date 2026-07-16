/**
 * §8 design tokens — extracted from trace_prototype.html, the source of truth.
 *
 * The signal rule: `signal` blue means LIVE or ACTIVE and nothing else.
 * Recording indicator, active bike tag, current position, in-progress track,
 * primary action. Never decoration. Warnings are amber, never blue.
 * GPS status stays green — signal-light language doesn't bend to brand color.
 */
export const color = {
  void: '#0B0D0E', // base background
  slate: '#14181A', // card / panel
  slate2: '#1C2224', // raised control
  white: '#E8EAEA', // primary text, data
  signal: '#2E7DFF', // LIVE/ACTIVE ONLY
  signalDown: '#1748A6', // button travel shadow under signal
  amber: '#F5A623', // warnings only
  moss: '#3F5570', // dormant / secondary state
  steel: '#8A9196', // labels, captions, units
  hair: 'rgba(232,234,234,0.10)', // dividers
  gpsGood: '#7BC47F', // GPS status green — universal signal language
  dim: '#5b6266', // inactive tab text, footnotes
} as const;

/**
 * Loaded in the root layout via @expo-google-fonts. Use these family names,
 * never raw strings, so a font swap is one edit — which is exactly what
 * happened on 2026-07-16: Barlow Condensed/Archivo → Chakra Petch/Saira
 * (user decision — angular moto-dashboard identity over generic condensed).
 */
export const font = {
  display: 'ChakraPetch_700Bold',
  displaySemi: 'ChakraPetch_600SemiBold',
  displayMedium: 'ChakraPetch_500Medium',
  body: 'Saira_400Regular',
  bodyMedium: 'Saira_500Medium',
  bodySemi: 'Saira_600SemiBold',
  bodyBold: 'Saira_700Bold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
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
