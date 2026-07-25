/**
 * §8 design tokens — the single source of truth. No component may hardcode a
 * hex value; if a colour is worth using it is worth naming here.
 *
 * Design overhaul (2026-07-22, "adopt fully"): OLED-first surfaces, strict
 * colour discipline, one signature element (the living trace). The rules that
 * make it premium instead of merely dark:
 *
 *   - accent.action (yellow) appears AT MOST ONCE per screen: the single
 *     primary action. Never on nav, tabs, likes, badges, or borders.
 *   - accent.trace is reserved for route geometry and its glow. Nothing else
 *     glows.
 *   - Elevation on black is a lighter surface + a hairline, never a shadow —
 *     shadows are invisible on #000.
 *
 * The old flat names (void/slate/signal/…) survive as a compatibility layer
 * mapped onto the new palette, so every screen moved onto the new colours in
 * one commit; screens migrate to the semantic names as they are refactored.
 */

// ── Surfaces — OLED-first ────────────────────────────────────────────────
export const surface = {
  base: '#000000', // true black: OLED, battery, night rides
  raised: '#101010', // cards, sheets — content objects get containment
  overlay: '#1A1A1A', // modals, pickers
  stroke: '#262626', // hairline borders and dividers (elevation lives here)
} as const;

// ── Text — a warm white, never pure #FFF ─────────────────────────────────
export const text = {
  primary: '#F5F5F2',
  secondary: '#9A9A96',
  // Bumped from #5C5C58 after the §5 audit: on surface.raised the old value
  // was 2.83:1, under even the 3:1 large-text floor. #6E6E68 is 3.71:1 on
  // raised, 4.09:1 on base — passes, and still reads as de-emphasised.
  tertiary: '#6E6E68', // timestamps, metadata, inactive nav
  disabled: '#3A3A38',
} as const;

// ── Brand ────────────────────────────────────────────────────────────────
export const accent = {
  action: '#FFD400', // the one primary action per screen
  trace: '#FFC933', // route geometry + its glow — the signature, slightly warmer
  traceDim: '#8A6D1A', // trace at rest, ghosted placeholders, converging-lines art
} as const;

// ── Semantic ──────────────────────────────────────────────────────────────
export const status = {
  warning: '#FF9F1C', // GPS degraded, road status
  danger: '#FF4D4D', // delete, errors, closed routes
  success: '#6BCB77', // sparingly: match confirmed, download complete, GPS good
} as const;

/** 4-pt grid. The only spacing values allowed; screen gutter is `gutter`. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
  gutter: 20,
} as const;

export const radius = {
  card: 16,
  chip: 10,
  button: 16, // primary
  buttonSecondary: 12,
  thumb: 12, // map thumbnails inside cards
} as const;

/**
 * Type scale (dp) and roles. Font selection stays free (Manrope); numbers use
 * tabular lining figures everywhere — mixed-width digits in a stat or a
 * ticking odometer are an instant premium killer, so `type.numeric` consumers
 * must set `fontVariant: ['tabular-nums']`.
 */
export const scale = {
  d1: 34,
  d2: 28,
  d3: 22,
  body: 17,
  bodySm: 15,
  meta: 13,
  eyebrow: 11,
} as const;

/**
 * Backwards-compatible palette. Every key here maps to a token above; nothing
 * carries a bespoke hex. Screens still read these until refactored onto the
 * semantic names.
 */
export const color = {
  void: surface.base,
  slate: surface.raised,
  slate2: surface.overlay,
  white: text.primary,
  signal: accent.action,
  signalDown: '#8A7000', // primary-button plinth (travel shadow under the face)
  amber: status.warning,
  danger: status.danger,
  success: status.success,
  moss: '#3F5570', // dormant / secondary state — outside the semantic ramp
  steel: text.secondary,
  hair: surface.stroke,
  gpsGood: status.success,
  dim: text.tertiary,
  disabled: text.disabled,
  trace: accent.trace,
  traceDim: accent.traceDim,
  // Glass survives only until the nav is de-glowed (§2.4); no new glass.
  glass: 'rgba(255,255,255,0.04)',
  glassBorder: surface.stroke,
  glassStrong: 'rgba(16,16,16,0.86)',
} as const;

/**
 * Elevation is a lighter surface plus a hairline, not a drop shadow. These
 * keys remain so consumers compile through the refactor; they resolve to no
 * shadow, because a shadow on #000 is invisible and shipping it is a tell.
 */
export const shadow = {
  card: undefined as unknown as string,
  float: undefined as unknown as string,
  signalGlow: undefined as unknown as string,
} as const;

/**
 * Loaded in the root layout via @expo-google-fonts. Manrope, one family — the
 * weights do the talking. "mono" keys render Manrope semibold, tracked and
 * uppercased by the label components. Type roles (display/body/numeric) point
 * here so a future face swap is one edit.
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
  // Numeric role: same face, but consumers MUST pair it with tabular-nums.
  numeric: 'Manrope_700Bold',
} as const;

/** Layout constants (§8 layout patterns). Gutter tightened to the 4-pt grid. */
export const layout = {
  screenPadding: space.gutter,
  cardRadius: radius.card,
  /** Record screen and any in-ride control: minimum touch target (§8 ergonomics). */
  rideTouchTarget: 64,
  /**
   * The record button. Still generous for gloved hands, but trimmed from 76
   * once the map arrived — the screen's most useful surface shouldn't lose
   * space to a button that was already comfortably over the touch minimum.
   */
  recordButtonHeight: 62,
} as const;

/**
 * Mono label style values (§8): always uppercase, letter-spaced, tertiary.
 * Eyebrow labels are 11dp with wide tracking.
 */
export const monoLabel = {
  fontFamily: font.mono,
  color: text.secondary,
  fontSize: 9,
  letterSpacing: 1.6,
  textTransform: 'uppercase' as const,
};

/**
 * Motion. Durations in ms; RN Animated consumers pair these with Easing.
 * Odometer values kept — the mechanical roll is a §8 signature.
 * Reduced-motion (§0.4) is honoured at the consumer: trace draw-on → fade,
 * count-ups → final value.
 */
export const motion = {
  // New system
  standardMs: 220, // nav, sheets, state changes — cubic-bezier(0.2,0,0,1)
  quickMs: 120, // presses, toggles — ease-out
  traceMs: 750, // trace draw-on only — ease-in-out
  labelRisePx: 2, // nav label rise on tab change
  // Odometer (mechanical, settles rather than eases)
  odometerDigitMs: 580,
  odometerStaggerMs: 85,
  recordingPulseMs: 1600,
  buttonTravelMs: 70,
  buttonTravelPx: 5,
} as const;
