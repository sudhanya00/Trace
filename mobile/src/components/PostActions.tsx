import { Feather, Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../lib/auth';
import { tick } from '../lib/haptics';
import { likePost, Post, repost, unlikePost } from '../lib/db';
import { color, font } from '../theme/tokens';

/**
 * The row under a post: reply, repost, like, share.
 *
 * Like state is held locally and flipped on tap, then written — a like that
 * waits for the server feels broken. The write is idempotent on both sides
 * (insert/delete of one row), so a failed call just reverts.
 */
export function PostActions({
  post,
  onReply,
  onChanged,
  compact = false,
}: {
  post: Post;
  onReply?: () => void;
  onChanged?: () => void;
  compact?: boolean;
}) {
  const { session } = useAuth();
  const [liked, setLiked] = useState(post.i_liked);
  const [likes, setLikes] = useState(post.like_count);
  const [reposted, setReposted] = useState(false);

  const size = compact ? 15 : 17;

  const toggleLike = async () => {
    if (!session) return;
    const next = !liked;
    if (next) tick(); // a like is a deliberate tap; a soft one only
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    try {
      if (next) await likePost(session.user.id, post.id);
      else await unlikePost(session.user.id, post.id);
      onChanged?.();
    } catch {
      setLiked(!next); // put it back; the server disagreed
      setLikes((n) => n + (next ? -1 : 1));
    }
  };

  const doRepost = () => {
    if (!session || reposted) return;
    Alert.alert('Repost this?', `It goes out to your followers under @${post.handle}'s name.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Repost',
        onPress: async () => {
          try {
            await repost(session.user.id, post.id);
            setReposted(true);
            onChanged?.();
          } catch (e) {
            Alert.alert('Could not repost', (e as Error).message);
          }
        },
      },
    ]);
  };

  const share = async () => {
    const text = post.body?.trim()
      ? `"${post.body.trim()}" — @${post.handle} on TRACE`
      : `@${post.handle} on TRACE`;
    try {
      await Share.share({ message: text });
    } catch {
      // Sharing is best-effort; a dismissed sheet is not an error worth a dialog.
      if (await Sharing.isAvailableAsync().catch(() => false)) return;
    }
  };

  return (
    <View style={[st.row, compact && { gap: 18 }]}>
      <Action
        icon="message-circle"
        size={size}
        label={post.comment_count > 0 ? String(post.comment_count) : undefined}
        onPress={onReply}
      />
      <Action
        icon="repeat"
        size={size}
        onPress={doRepost}
        tint={reposted ? color.gpsGood : undefined}
      />
      {/* §0.1.3: a like goes white and filled, not yellow — the bold count is
          signal enough. Ionicons gives a real filled heart. */}
      <Pressable onPress={toggleLike} hitSlop={14} style={st.action}>
        <Ionicons
          name={liked ? 'heart' : 'heart-outline'}
          size={size + 1}
          color={liked ? color.white : color.dim}
        />
        {likes > 0 ? (
          <Text
            style={[st.count, liked && { color: color.white, fontFamily: font.bodyBold }]}
            allowFontScaling={false}
          >
            {likes}
          </Text>
        ) : null}
      </Pressable>
      <Action icon="share-2" size={size} onPress={share} />
    </View>
  );
}

function Action({
  icon,
  size,
  label,
  onPress,
  tint,
  filled = false,
}: {
  icon: keyof typeof Feather.glyphMap;
  size: number;
  label?: string;
  onPress?: () => void;
  tint?: string;
  filled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={14} style={st.action} disabled={!onPress}>
      <Feather
        name={icon}
        size={size}
        color={tint ?? color.dim}
        {...(filled ? { style: { opacity: 1 } } : {})}
      />
      {label ? (
        <Text style={[st.count, tint ? { color: tint } : null]} allowFontScaling={false}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 26, marginTop: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingVertical: 4 },
  count: { fontFamily: font.mono, fontSize: 10, color: color.dim, fontVariant: ['tabular-nums'] },
});
