import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { showAlert } from '../src/components/Dialog';
import { DiscoverCard } from '../src/components/DiscoverCard';
import { MonoLabel } from '../src/components/ui';
import { useAuth } from '../src/lib/auth';
import { askRideAI, DiscoveredRoute, RideAiTurn } from '../src/lib/db';
import { useKeyboardHeight } from '../src/lib/useKeyboardHeight';
import { color, font, layout } from '../src/theme/tokens';

/** One exchange as the screen shows it: what was asked, what came back. */
type Exchange = {
  question: string;
  reply?: string;
  routes?: DiscoveredRoute[];
};

/**
 * Ride AI.
 *
 * Not streamed. The edge function is on generateContent, which returns a whole
 * answer, and React Native's fetch does not give you a readable body to stream
 * anyway without reaching for expo/fetch. Turns here are short — a sentence or
 * three plus some cards — so the wait is a second or two rather than the long
 * silent crawl streaming exists to fix. When the function moves to the
 * Interactions API this is the place to revisit.
 *
 * The cards under each answer are rendered from the tool results, not parsed
 * out of the model's prose. That is deliberate: the system prompt tells the
 * model not to soften a warning, but an instruction is not an enforcement, and
 * a rider should see that a pass is gated whether or not the sentence above
 * mentioned it.
 */
export default function RideAI() {
  const { profile } = useAuth();
  const [draft, setDraft] = useState('');
  const [thread, setThread] = useState<Exchange[]>([]);
  const [contents, setContents] = useState<RideAiTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const kb = useKeyboardHeight();

  const where = profile?.home_region;
  const openers = [
    where ? `Where should I ride in ${where} this weekend?` : 'Where should I ride this weekend?',
    'I have one day and an adv. What’s worth it?',
    'Somewhere quiet, nothing technical.',
  ];

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setDraft('');
    setBusy(true);
    setThread((t) => [...t, { question }]);
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));

    // The whole conversation goes up each turn — generateContent is stateless,
    // and the function hands back the history to send next time.
    const next: RideAiTurn[] = [...contents, { role: 'user', parts: [{ text: question }] }];

    try {
      const res = await askRideAI(next);
      setContents(res.contents);
      setThread((t) =>
        t.map((x, i) => (i === t.length - 1 ? { ...x, reply: res.reply, routes: res.routes } : x))
      );
    } catch (e) {
      // Drop the question rather than leave it hanging unanswered — the rider
      // can see it failed and ask again, instead of scrolling past a stump.
      setThread((t) => t.slice(0, -1));
      setDraft(question);
      showAlert('Could not ask', (e as Error).message);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
    }
  };

  return (
    <KeyboardAvoidingView
      style={st.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={st.head}>
        <View style={{ flex: 1 }}>
          <MonoLabel size={9.5} style={{ letterSpacing: 2.3 }}>
            Ride AI
          </MonoLabel>
          <Text style={st.h1}>Where to</Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 8 }}>
          <Text style={st.back}>Back</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={st.thread}
        keyboardShouldPersistTaps="handled"
      >
        {thread.length === 0 ? (
          <View>
            <Text style={st.intro}>
              Ask where to ride. Answers come from roads riders here have actually ridden, weighed
              against what you’ve ridden yourself.
            </Text>
            <MonoLabel size={8.5} style={{ marginTop: 26, marginBottom: 10 }}>
              Try
            </MonoLabel>
            {openers.map((o) => (
              <Pressable key={o} onPress={() => ask(o)} style={st.opener}>
                <Text style={st.openerText}>{o}</Text>
                <Feather name="arrow-up-right" size={14} color={color.dim} />
              </Pressable>
            ))}
          </View>
        ) : (
          thread.map((x, i) => (
            <View key={i} style={{ marginBottom: 26 }}>
              <View style={st.question}>
                <Text style={st.questionText}>{x.question}</Text>
              </View>

              {x.reply === undefined ? (
                <View style={st.thinking}>
                  <ActivityIndicator size="small" color={color.trace} />
                  <Text style={st.thinkingText}>Looking at what’s been ridden…</Text>
                </View>
              ) : (
                <>
                  {x.reply ? <Text style={st.reply}>{x.reply}</Text> : null}
                  {x.routes && x.routes.length > 0 && (
                    <View style={{ marginTop: 14 }}>
                      {x.routes.map((r) => (
                        <DiscoverCard key={r.route_id} route={r} />
                      ))}
                    </View>
                  )}
                </>
              )}
            </View>
          ))
        )}
      </ScrollView>

      <View style={[st.bar, { paddingBottom: 14 + (Platform.OS === 'android' ? kb : 0) }]}>
        <TextInput
          style={st.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Where should I ride?"
          placeholderTextColor={color.dim}
          multiline
          maxLength={500}
          editable={!busy}
        />
        <Pressable
          onPress={() => ask(draft)}
          disabled={!draft.trim() || busy}
          style={[st.send, (!draft.trim() || busy) && { opacity: 0.4 }]}
        >
          <Feather name="arrow-up" size={18} color="#151100" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 70,
  },
  h1: {
    fontFamily: font.display,
    fontSize: 38,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 6,
    lineHeight: 40,
  },
  back: { fontFamily: font.bodyMedium, fontSize: 14, color: color.steel },
  thread: { paddingHorizontal: layout.screenPadding, paddingTop: 24, paddingBottom: 30 },
  intro: { fontFamily: font.body, fontSize: 14, color: color.steel, lineHeight: 21 },
  opener: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: color.hair,
    paddingVertical: 14,
  },
  openerText: { flex: 1, fontFamily: font.body, fontSize: 13.5, color: color.white },
  question: { alignSelf: 'flex-end', maxWidth: '86%', marginBottom: 14 },
  questionText: {
    fontFamily: font.bodyMedium,
    fontSize: 14.5,
    color: color.white,
    textAlign: 'right',
    lineHeight: 21,
  },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  thinkingText: { fontFamily: font.body, fontSize: 12.5, color: color.dim },
  reply: { fontFamily: font.body, fontSize: 14.5, color: '#C6CBCE', lineHeight: 22 },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: color.hair,
    backgroundColor: color.void,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    fontFamily: font.body,
    fontSize: 14.5,
    color: color.white,
    backgroundColor: color.slate,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: color.signal,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
