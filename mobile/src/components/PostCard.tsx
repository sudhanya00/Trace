import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GeoJson, multiLineCoords, Post } from '../lib/db';
import { color, font, layout } from '../theme/tokens';
import { Avatar } from './Avatar';
import { PostActions } from './PostActions';
import { TrackThumb } from './TrackThumb';

function ago(iso: string): string {
  const m = Math.floor((Date.now() - +new Date(iso)) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

/**
 * One post, wherever it appears. Three shapes share this card because they are
 * the same object: a plain post, a repost of one, and a ride put on the feed.
 */
export function PostCard({
  post,
  rideGeom,
  onChanged,
}: {
  post: Post;
  rideGeom?: GeoJson | null;
  onChanged?: () => void;
}) {
  const open = () => router.push(`/post/${post.id}`);
  const segments = rideGeom ? multiLineCoords(rideGeom) : [];

  return (
    <Pressable onPress={open}>
      {({ pressed }) => (
        <View style={[st.post, pressed && { backgroundColor: color.slate }]}>
          <View style={{ flexDirection: 'row', gap: 11 }}>
            <Pressable onPress={() => router.push(`/rider/${post.profile_id}`)} hitSlop={6}>
              <Avatar url={post.avatar_url} handle={post.handle} size={36} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={st.author}>@{post.handle}</Text>
                <Text style={st.when}>{ago(post.created_at)}</Text>
              </View>

              {post.body?.trim() ? (
                <Text style={st.body} numberOfLines={6}>
                  {post.body}
                </Text>
              ) : null}

              {/* A ride, put on the feed: its real shape, its real distance. */}
              {post.ride_id && (
                <Pressable
                  onPress={() => router.push(`/ride/${post.ride_id}`)}
                  style={st.rideCard}
                >
                  <TrackThumb id={post.ride_id ?? undefined} segments={segments} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.rideKm} allowFontScaling={false}>
                      {Number(post.ride_distance_km ?? 0).toFixed(1)}
                      <Text style={st.rideUnit}> km</Text>
                    </Text>
                    <Text style={st.rideHint}>Ride · tap to open</Text>
                  </View>
                </Pressable>
              )}

              {/* A repost carries the original inside it, quoted. */}
              {post.repost_of && (
                <Pressable
                  onPress={() => router.push(`/post/${post.repost_of}`)}
                  style={st.quote}
                >
                  <Text style={st.quoteAuthor}>@{post.repost_handle}</Text>
                  <Text style={st.quoteBody} numberOfLines={4}>
                    {post.repost_body}
                  </Text>
                </Pressable>
              )}

              <PostActions post={post} onReply={open} onChanged={onChanged} compact />
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

const st = StyleSheet.create({
  post: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: color.hair,
  },
  author: { fontFamily: font.bodySemi, fontSize: 13.5, color: color.white },
  when: { fontFamily: font.mono, fontSize: 8.5, color: color.dim },
  body: { fontFamily: font.body, fontSize: 14.5, color: '#C6CBCE', lineHeight: 21, marginTop: 5 },
  rideCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: color.glassBorder,
    borderRadius: 12,
    backgroundColor: color.glass,
  },
  rideKm: {
    fontFamily: font.displaySemi,
    fontSize: 24,
    color: color.white,
    fontVariant: ['tabular-nums'],
  },
  rideUnit: { fontFamily: font.displayMedium, fontSize: 11, color: color.steel },
  rideHint: { fontFamily: font.mono, fontSize: 8.5, letterSpacing: 1.2, color: color.dim, marginTop: 4 },
  quote: {
    marginTop: 10,
    padding: 11,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
  },
  quoteAuthor: { fontFamily: font.bodySemi, fontSize: 12, color: color.steel },
  quoteBody: { fontFamily: font.body, fontSize: 13, color: color.steel, lineHeight: 19, marginTop: 4 },
});
