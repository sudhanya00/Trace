import { File, Paths } from 'expo-file-system';
import { showAlert } from '../../src/components/Dialog';
import * as Sharing from 'expo-sharing';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PushButton } from '../../src/components/PushButton';
import { RideMap } from '../../src/components/RideMap';
import { DataCell, Field, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import {
  addConditionReport,
  addRouteComment,
  ConditionReport,
  deleteRouteComment,
  flagComment,
  deleteRoute,
  getRoute,
  Profile,
  Route,
  routeLine,
  routeConditions,
  routeThread,
  ThreadComment,
} from '../../src/lib/db';
import { supabase } from '../../src/lib/supabase';
import { googleMapsDirectionsUrl, toGpx } from '../../src/lib/gpx';
import { color, font, layout } from '../../src/theme/tokens';

const STATUS_META = {
  clear: { label: 'CLEAR', tint: color.gpsGood },
  caution: { label: 'CAUTION', tint: color.amber },
  blocked: { label: 'BLOCKED', tint: '#E05B4C' },
} as const;

function daysAgo(iso: string): string {
  const d = Math.floor((Date.now() - +new Date(iso)) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

/**
 * Route detail (§9): map, stats, author, and the Navigate handoff (§10).
 * Geometry is always the privacy-clipped public representation — the owner
 * sees their route exactly as other riders will.
 */
export default function RouteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [route, setRoute] = useState<Route | null>(null);
  const [segments, setSegments] = useState<[number, number][][] | null>(null);
  const [author, setAuthor] = useState<Profile | null>(null);
  const [thread, setThread] = useState<ThreadComment[]>([]);
  const [conditions, setConditions] = useState<ConditionReport[]>([]);
  const [comment, setComment] = useState('');
  const [conditionNote, setConditionNote] = useState('');
  const [reporting, setReporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadTalk = useCallback(() => {
    if (!id) return;
    routeThread(id).then(setThread).catch(() => {});
    routeConditions(id).then(setConditions).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      const r = await getRoute(id).catch(() => null);
      if (!r || !alive) return;
      setRoute(r);
      // routeLine, not publicRouteSegments. A PLANNED route stores its
      // waypoints and no geometry — we never keep Google's line — so reading
      // stored geom alone hands back nothing, the map draws nothing, and both
      // the GPX export and the Maps hand-off sit permanently disabled. The
      // follow screen already went through routeLine for exactly this reason;
      // this screen was the one that didn't.
      routeLine(r.id).then((s) => alive && setSegments(s)).catch(() => {});
      supabase
        .from('profiles')
        .select('*')
        .eq('id', r.profile_id)
        .maybeSingle()
        .then(({ data }) => alive && setAuthor(data));
    })();
    loadTalk();
    return () => {
      alive = false;
    };
  }, [id, loadTalk]);

  const postComment = async () => {
    if (!session || !id || !comment.trim()) return;
    try {
      await addRouteComment(session.user.id, id, comment.trim());
      setComment('');
      loadTalk();
    } catch (e) {
      showAlert('Could not post', (e as Error).message);
    }
  };

  const postCondition = async (status: ConditionReport['status']) => {
    if (!session || !id) return;
    try {
      await addConditionReport(session.user.id, id, status, conditionNote.trim() || null);
      setConditionNote('');
      setReporting(false);
      loadTalk();
    } catch (e) {
      showAlert('Could not report', (e as Error).message);
    }
  };

  const onCommentLongPress = (c: ThreadComment) => {
    if (!session) return;
    if (c.profile_id === session.user.id) {
      showAlert('Delete your comment?', undefined, [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteRouteComment(c.id).catch(() => {});
            loadTalk();
          },
        },
      ]);
    } else {
      showAlert('Flag this comment?', 'Sends it to us for review.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Flag',
          onPress: () => flagComment(session.user.id, c.id).catch(() => {}),
        },
      ]);
    }
  };

  if (!route) return <View style={st.root} />;

  const latestCondition = conditions[0] ?? null;

  const navigate = async () => {
    if (!segments?.length) return;
    try {
      const gpx = toGpx(route.name, segments);
      const file = new File(Paths.cache, `${route.name.replace(/[^\w\- ]/g, '').trim() || 'route'}.gpx`);
      if (file.exists) file.delete();
      file.create();
      file.write(gpx);
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/gpx+xml',
        dialogTitle: 'Navigate with…',
      });
    } catch (e) {
      showAlert('Could not export', (e as Error).message);
    }
  };

  const confirmDelete = () => {
    if (!route) return;
    showAlert(
      `Delete ${route.name}?`,
      'It stops appearing anywhere — for you and for everyone else. Rides you have already recorded on this road are untouched.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteRoute(route.id);
              router.back();
            } catch (e) {
              setDeleting(false);
              showAlert('Could not delete', (e as Error).message);
            }
          },
        },
      ]
    );
  };

  const openGoogleMaps = () => {
    if (!segments?.length) return;
    const url = googleMapsDirectionsUrl(segments);
    if (url) Linking.openURL(url);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <ScrollView style={st.root} contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
      {route.photo_url && (
        <Image source={{ uri: route.photo_url }} style={st.photo} resizeMode="cover" />
      )}

      <MonoLabel size={9.5}>
        {author ? `@${author.handle.toUpperCase()}` : 'ROUTE'}
        {route.terrain_tags?.length ? ` — ${route.terrain_tags.join(' · ').toUpperCase()}` : ''}
      </MonoLabel>
      <Text style={st.h1}>{route.name}</Text>
      {route.description ? <Text style={st.desc}>{route.description}</Text> : null}

      {segments && segments.length > 0 && <RideMap segments={segments} style={{ marginTop: 20 }} />}

      <View style={st.strip}>
        <DataCell first label="Distance" value={Number(route.distance_km).toFixed(1)} unit="km" />
        <DataCell
          label="Shared"
          value={new Date(route.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        />
      </View>

      {/* Follow in-app: the road drawn, your position on it, nothing spoken.
          Still no turn-by-turn (§6) — that's a different product. */}
      <PushButton
        label="Follow this route"
        onPress={() => router.push(`/route/follow?id=${route.id}`)}
        height={64}
        style={{ marginTop: 26 }}
      />

      {/* §10: the handoff, for riders who want spoken directions. */}
      <PushButton
        label="Export for navigation"
        variant="secondary"
        onPress={navigate}
        disabled={!segments?.length}
        style={{ marginTop: 12 }}
      />
      <Pressable onPress={openGoogleMaps} style={st.gmapsRow} disabled={!segments?.length}>
        <Text style={st.gmapsText}>Open waypoints in Google Maps →</Text>
      </Pressable>

      {/* conditions — route trust stays fresh or it rots */}
      <MonoLabel size={9} style={{ marginTop: 28, marginBottom: 10 }}>
        Conditions
      </MonoLabel>
      {latestCondition ? (
        <View style={st.condRow}>
          <Text style={[st.condChip, { color: STATUS_META[latestCondition.status].tint, borderColor: color.hair }]}>
            {STATUS_META[latestCondition.status].label}
          </Text>
          <Text style={st.condText}>
            @{latestCondition.handle}
            {latestCondition.rode_it ? ' · rode it' : ''} · {daysAgo(latestCondition.created_at)}
            {latestCondition.note ? ` — ${latestCondition.note}` : ''}
          </Text>
        </View>
      ) : (
        <Text style={st.condEmpty}>No reports yet — last verified: never.</Text>
      )}
      {!reporting ? (
        <Pressable onPress={() => setReporting(true)} style={{ marginTop: 10 }}>
          <Text style={st.gmapsText}>Report conditions →</Text>
        </Pressable>
      ) : (
        <View style={{ marginTop: 12 }}>
          <Field
            label="What's it like out there? (optional)"
            value={conditionNote}
            onChangeText={setConditionNote}
            placeholder="Loose gravel after the bridge"
            autoCapitalize="sentences"
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            {(Object.keys(STATUS_META) as ConditionReport['status'][]).map((s) => (
              <Pressable key={s} onPress={() => postCondition(s)} style={st.condBtn}>
                <Text style={[st.condChip, { color: STATUS_META[s].tint, borderWidth: 0, paddingHorizontal: 0 }]}>
                  {STATUS_META[s].label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* the thread — riders who rode it carry the badge */}
      <MonoLabel size={9} style={{ marginTop: 30, marginBottom: 6 }}>
        Thread
      </MonoLabel>
      {thread.length === 0 && (
        <Text style={st.condEmpty}>Ask the road a question — riders who've been answer.</Text>
      )}
      {thread.map((c) => (
        <Pressable key={c.id} onLongPress={() => onCommentLongPress(c)}>
          <View style={st.commentRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Text style={st.commentAuthor}>@{c.handle}</Text>
              {c.rode_it && <Text style={st.rodeIt}>RODE IT</Text>}
              <Text style={st.commentWhen}>{daysAgo(c.created_at)}</Text>
            </View>
            <Text style={st.commentBody}>{c.body}</Text>
          </View>
        </Pressable>
      ))}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, alignItems: 'flex-end' }}>
        <Field
          label="Add to the thread"
          value={comment}
          onChangeText={setComment}
          placeholder="Anyone ridden this in October?"
          autoCapitalize="sentences"
          style={{ flex: 1 }}
        />
        <Pressable
          onPress={postComment}
          disabled={!comment.trim()}
          style={[st.postBtn, !comment.trim() && { opacity: 0.4 }]}
        >
          <Text style={st.postBtnText}>POST</Text>
        </Pressable>
      </View>

      {/* Only the owner's, and kept away from the rest of the actions — this
          is the one control on the screen that cannot be undone. */}
      {session?.user.id === route.profile_id && (
        <Pressable onPress={confirmDelete} style={st.delete} disabled={deleting}>
          <Text style={st.deleteText}>{deleting ? 'Deleting…' : 'Delete this route'}</Text>
        </Pressable>
      )}

      <Pressable onPress={() => router.back()} style={st.back}>
        <Text style={st.backText}>Back</Text>
      </Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 72, paddingBottom: 60 },
  photo: {
    width: '100%',
    height: 190,
    borderRadius: layout.cardRadius,
    marginBottom: 18,
    backgroundColor: color.slate,
  },
  h1: {
    fontFamily: font.display,
    fontSize: 34,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 7,
    lineHeight: 36,
  },
  desc: { fontFamily: font.body, fontSize: 13.5, color: '#B9C0C3', lineHeight: 20, marginTop: 10 },
  strip: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.hair,
    marginTop: 20,
  },
  gmapsRow: { alignSelf: 'center', marginTop: 16, padding: 8 },
  gmapsText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },

  condRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  condChip: {
    fontFamily: font.mono,
    fontSize: 8,
    letterSpacing: 1.2,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 3.5,
  },
  condText: { flex: 1, fontFamily: font.body, fontSize: 12, color: color.steel, lineHeight: 17 },
  condEmpty: { fontFamily: font.body, fontSize: 12, color: color.dim },
  condBtn: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: color.slate2,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 8,
    paddingVertical: 12,
  },

  commentRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.hair },
  commentAuthor: { fontFamily: font.bodySemi, fontSize: 12.5, color: color.white },
  rodeIt: {
    fontFamily: font.mono,
    fontSize: 7,
    letterSpacing: 1,
    color: color.moss,
    borderWidth: 1,
    borderColor: 'rgba(63,85,112,.5)',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1.5,
  },
  commentWhen: { fontFamily: font.mono, fontSize: 8.5, color: color.dim },
  commentBody: { fontFamily: font.body, fontSize: 13, color: '#C6CBCE', lineHeight: 19, marginTop: 5 },
  postBtn: {
    backgroundColor: color.signal,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  postBtnText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: '#F2F7FF' },
  delete: { alignSelf: 'center', marginTop: 30, padding: 10 },
  deleteText: { fontFamily: font.bodyMedium, fontSize: 13, color: '#E05B4C' },
  back: { alignSelf: 'center', marginTop: 6, padding: 8 },
  backText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
