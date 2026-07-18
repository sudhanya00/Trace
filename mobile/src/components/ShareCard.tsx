import { forwardRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, G, Line, LinearGradient as SvgGrad, Path, Polyline, Stop } from 'react-native-svg';

import { color, font } from '../theme/tokens';
import { projectSegmentsToBox } from './TrackBed';

/**
 * The story card: what a ride looks like on an Instagram story or WhatsApp
 * status. Rendered offscreen at 360×640 and captured at 3× for a crisp
 * 1080×1920 PNG. No speed on this surface, ever — the amended rule is
 * private-only, and this card is the definition of public.
 */

export type ShareCardData = {
  title: string;
  dateStr: string;
  distanceKm: number;
  durationStr: string;
  elevGainM: number | null;
  stops: number | null;
  segments: [number, number][][];
  photoUri: string | null;
};

const CW = 360;
const CH = 640;
const MAP_H = 330;

export const ShareCard = forwardRef<View, { data: ShareCardData }>(function ShareCard(
  { data },
  ref
) {
  const projected = projectSegmentsToBox(data.segments, CW, MAP_H, 0.18);

  return (
    <View ref={ref} collapsable={false} style={st.card}>
      {/* upper region: the rider's photo, or the contour bed */}
      <View style={st.mapWrap}>
        {data.photoUri && <Image source={{ uri: data.photoUri }} style={st.photo} resizeMode="cover" />}
        <Svg width={CW} height={MAP_H} viewBox={`0 0 ${CW} ${MAP_H}`}>
          <Defs>
            <SvgGrad id="strk" x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor="#FFD60A" stopOpacity="0.35" />
              <Stop offset="0.55" stopColor="#FFDE47" stopOpacity="0.85" />
              <Stop offset="1" stopColor="#FFF1A6" stopOpacity="1" />
            </SvgGrad>
          </Defs>
          {!data.photoUri && (
            <G stroke="#222829" strokeWidth={1} fill="none" opacity={0.9}>
              <Path d="M-20 60 C 70 40, 150 90, 230 62 S 360 20, 420 46" />
              <Path d="M-20 120 C 80 96, 160 150, 240 118 S 366 70, 420 98" />
              <Path d="M-20 180 C 66 158, 158 208, 236 178 S 358 130, 420 158" />
              <Path d="M-20 240 C 88 216, 150 266, 244 236 S 352 190, 420 216" />
              <Path d="M-20 300 C 74 278, 162 324, 238 296 S 360 250, 420 276" />
            </G>
          )}
          {projected.map((seg, i) => (
            <Polyline
              key={`s${i}`}
              points={seg.map(([x, y]) => `${x},${y}`).join(' ')}
              stroke="url(#strk)"
              strokeWidth={3.6}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {projected.slice(1).map((seg, i) => {
            const prev = projected[i];
            return (
              <Line
                key={`g${i}`}
                x1={prev[prev.length - 1][0]}
                y1={prev[prev.length - 1][1]}
                x2={seg[0][0]}
                y2={seg[0][1]}
                stroke={color.signal}
                strokeWidth={2.2}
                strokeDasharray="3 7"
                strokeLinecap="round"
                opacity={0.55}
              />
            );
          })}
        </Svg>
        {/* scrim into the numbers */}
        <View style={st.scrim} />
      </View>

      <View style={st.body}>
        <Text style={st.eyebrow}>{data.dateStr.toUpperCase()}</Text>
        <Text style={st.title} numberOfLines={2}>
          {data.title}
        </Text>

        <View style={st.odoRow}>
          <Text style={st.distance} allowFontScaling={false}>
            {data.distanceKm.toFixed(1)}
          </Text>
          <Text style={st.unit}>km</Text>
        </View>

        <View style={st.strip}>
          <Cell label="DURATION" value={data.durationStr} />
          {data.elevGainM != null && data.elevGainM > 0 && (
            <Cell label="CLIMBED" value={`${Math.round(data.elevGainM)} m`} />
          )}
          {data.stops != null && data.stops > 0 && <Cell label="STOPS" value={String(data.stops)} />}
        </View>
      </View>

      <View style={st.footer}>
        <Text style={st.wordmark}>TRACE</Text>
        <Text style={st.tagline}>RIDE. TRACE. BELONG.</Text>
      </View>
    </View>
  );
});

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginRight: 26 }}>
      <Text style={st.cellLabel}>{label}</Text>
      <Text style={st.cellValue} allowFontScaling={false}>
        {value}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  card: { width: CW, height: CH, backgroundColor: color.void, overflow: 'hidden' },
  mapWrap: { width: CW, height: MAP_H },
  photo: { position: 'absolute', top: 0, left: 0, width: CW, height: MAP_H, opacity: 0.85 },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 110,
    backgroundColor: 'transparent',
    borderBottomWidth: 110,
    borderBottomColor: 'rgba(0,0,0,0.92)',
  },
  body: { flex: 1, paddingHorizontal: 28, paddingTop: 6 },
  eyebrow: { fontFamily: font.mono, fontSize: 9, letterSpacing: 2, color: color.steel },
  title: {
    fontFamily: font.display,
    fontSize: 26,
    lineHeight: 28,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  odoRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 14 },
  distance: {
    fontFamily: font.display,
    fontSize: 84,
    lineHeight: 86,
    color: color.white,
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontFamily: font.displaySemi,
    fontSize: 22,
    color: color.steel,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginLeft: 8,
    marginBottom: 12,
  },
  strip: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: color.hair,
    marginTop: 16,
    paddingTop: 14,
  },
  cellLabel: { fontFamily: font.mono, fontSize: 8.5, letterSpacing: 1.5, color: color.steel },
  cellValue: {
    fontFamily: font.displaySemi,
    fontSize: 24,
    color: color.white,
    fontVariant: ['tabular-nums'],
    marginTop: 5,
  },
  footer: {
    paddingHorizontal: 28,
    paddingBottom: 24,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  wordmark: { fontFamily: font.display, fontSize: 22, letterSpacing: 2, color: color.white },
  tagline: { fontFamily: font.mono, fontSize: 8, letterSpacing: 2, color: color.dim },
});
