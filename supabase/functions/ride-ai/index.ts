/**
 * ride-ai — the discovery planner.
 *
 * A rider lands somewhere they don't know and asks where to ride. This is the
 * conversational front for that, and it is deliberately the LAST thing built:
 * discover_routes already answers the question on its own (20260726001000), and
 * if that ranked list weren't worth reading, a model on top would be decorating
 * a hole.
 *
 * Server-side for the same four reasons the geo function lists, plus a fifth
 * that matters more here: the tools below run AS THE RIDER, with their own JWT
 * forwarded to PostgREST. The model never holds a service key and never gets a
 * privileged path — its reach is bounded by exactly the RLS everything else in
 * the app runs on. A prompt injection that talks it into asking for somebody
 * else's rides gets the same empty result a malicious client would.
 *
 * WHY generateContent AND NOT THE INTERACTIONS API
 * Google's newer Interactions API would carry conversation state server-side
 * (previous_interaction_id) and cache better for it, but it is Beta and their
 * own guidance is to stay on generateContent for stable production. This ships
 * in a store app. Revisit when it goes GA — the swap is contained to this file.
 *
 * Secrets (`supabase secrets set`, never in the repo):
 *   GEMINI_API_KEY
 */

import { GoogleGenAI, Type } from 'npm:@google/genai@^2.13.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

/**
 * Flash-Lite: the cheapest tier that still does multi-step tool calling well,
 * which is the only capability this feature actually leans on. Measured
 * workload is ~4,100 input and ~470 output tokens per rider turn — about
 * $1.80 per thousand turns here.
 *
 * NOT SET, deliberately:
 *   temperature   Gemini 3.5 removed these, same as the current Anthropic and
 *   top_p/top_k   OpenAI flagships. Steer with the prompt instead.
 *   thinkingLevel left at the model default ("medium" as of 3.5). Lowering it
 *                 to "low" or "minimal" is the first cost and latency knob to
 *                 reach for — but the exact config shape for generateContent
 *                 (config.thinkingConfig.thinkingLevel vs config.thinkingLevel)
 *                 is not something to guess at: a wrong field either 400s or,
 *                 worse, silently does nothing. Verify against the installed
 *                 SDK before setting it.
 */
const MODEL = 'gemini-3.5-flash-lite';
const MAX_TOOL_ROUNDS = 6;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Per-rider throttle, on the path that costs money.
 *
 * Same shape as the geo function's: generous enough to refuse abuse and not
 * use. In-memory and therefore per-instance — a floor on protection, not a
 * guarantee; a durable counter belongs in Postgres when it matters.
 */
const TURN_LIMIT = 20;
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function throttle(userId: string): void {
  const now = Date.now();
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  }
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= TURN_LIMIT) throw new Error('slow down');
  recent.push(now);
  hits.set(userId, recent);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** Who's calling. The anon key alone isn't enough — we want the actual rider. */
async function callerId(auth: string | null): Promise<string> {
  if (!auth) return '';
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY ?? '' },
  });
  if (!res.ok) return '';
  return (await res.json())?.id ?? '';
}

/**
 * Call a Postgres function with the RIDER'S authorization, not ours.
 *
 * This is the security boundary of the whole feature, and it is the one part
 * that would survive any provider swap unchanged. Both tools go through here,
 * so auth.uid() inside discover_routes and rider_profile resolves to the person
 * chatting — the model cannot widen its own reach by asking differently.
 */
async function rpc(name: string, args: unknown, auth: string): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY ?? '',
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args ?? {}),
  });
  if (!res.ok) throw new Error(`${name} ${res.status}: ${await res.text()}`);
  return await res.json();
}

/**
 * Two tools, both read-only.
 *
 * There is deliberately no write tool yet: turning a suggestion into a planned
 * ride is step 6 and belongs behind an explicit tap in the UI, not behind a
 * model deciding it has understood. Descriptions say WHEN to call, not just
 * what the tool does — that trigger condition is what moves call rate.
 */
const FUNCTIONS = [
  {
    name: 'search_roads',
    description:
      'Roads near a place that riders on TRACE have actually shared, already ranked for the rider asking and already carrying provenance and safety warnings. Call this FIRST whenever the rider names a place, asks where to ride, or asks about a road — before answering from your own knowledge. Returns real routes; the geometry is not yours to invent.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        region: {
          type: Type.STRING,
          description: 'Region, state or city the rider asked about, e.g. "Himachal".',
        },
        when: {
          type: Type.STRING,
          description:
            'ISO 8601 date the rider is planning for. Season is decided against this, not against today.',
        },
      },
      required: [],
    },
  },
  {
    name: 'rider_profile',
    description:
      'What this rider has actually ridden: longest day, highest altitude reached, surfaces, bikes in the garage, months they ride. Call this before suggesting anything demanding, so a recommendation matches what they have done rather than what they might claim. Takes no arguments — it only ever describes the person you are talking to.',
    parameters: { type: Type.OBJECT, properties: {}, required: [] },
  },
];

/**
 * The system instruction.
 *
 * Provider-independent by design — this survived the move off the Anthropic
 * draft untouched, which is the clearest evidence the model really does sit in
 * the thinnest layer of the architecture.
 */
const SYSTEM = `You are Ride AI inside TRACE, an app for motorcycle riders. A rider is asking where to ride — usually somewhere they don't know well.

WHAT YOU ARE FOR
Discovery, not flattery. Someone has landed in a city or is planning a trip and wants to know what roads are there and which of them suit them. You are useful because you can see two things a general chatbot cannot: what riders on TRACE have actually ridden, and what this particular rider has actually done.

HOW TO ANSWER
Call search_roads before answering any question about a place. Call rider_profile before recommending anything demanding. Prefer roads the tools return over roads you merely know about — the tool results are real, current, and carry warnings computed against the rider's own history.

You may name a road the tools did not return, when you genuinely know the area and nothing came back. Say plainly that nobody on TRACE has ridden it, and never describe its surface, condition, or whether it is open as though you know — you do not.

NEVER INVENT A ROUTE
You do not draw lines on maps. You name roads; the app owns geometry. Never produce coordinates, distances, or elevation figures the tools did not give you. If you don't know how long something is, say so rather than estimating — a fabricated distance in this app is a fabricated odometer reading.

NEVER TALK ABOUT SPEED
No pace, no lap times, no "you could do it in two hours if you push". Riders here measure distance covered and roads explored. If a rider asks how fast a road can be ridden, answer in terms of how long it takes at a relaxed pace, and don't encourage otherwise.

WARNINGS ARE NOT YOURS TO SOFTEN
Tool results carry warning codes decided by the app against real columns: high passes, seasonal closures, no signal, roads harder or higher than anything this rider has finished. Repeat them plainly. Never reassure a rider past one, never omit one because it complicates a nice suggestion, and never invent one that wasn't returned.

VOICE
Sentence case. Plain verbs. Short. State what is true and what it costs — "Kunzum La is 4,590 m and usually gated until June" — and stop. No exclamation marks, no "Great question", no emoji. Never apologise for what the data doesn't cover; just say what is and isn't known. Empty results are an invitation, not a failure: if nobody has ridden a place yet, say that and point out they could be the first to map it.`;

/** A `parts` array the API will accept, from whatever the client sent. */
type Content = { role: 'user' | 'model'; parts: unknown[] };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // Auth before configuration, deliberately. A stranger should be told they
    // are a stranger, not told what we have failed to configure — and it means
    // the refusal path can be exercised without a key present.
    const auth = req.headers.get('Authorization');
    const userId = await callerId(auth);
    if (!userId) throw new Error('unauthenticated');

    const body = await req.json();
    const history: Content[] = Array.isArray(body?.contents) ? body.contents : [];
    if (history.length === 0) return json({ error: 'need at least one message' }, 400);

    throttle(userId);

    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const config = {
      systemInstruction: SYSTEM,
      tools: [{ functionDeclarations: FUNCTIONS }],
    };

    // generateContent is stateless, so the whole conversation goes up each
    // round. Bounded at six rounds: the model has two read-only tools and any
    // honest answer needs one or two calls, so a seventh means it is looping.
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: history,
        config,
      });

      const calls = response.functionCalls ?? [];
      if (calls.length === 0) {
        return json({ reply: response.text ?? '', contents: history });
      }

      // Append the model's turn before the results, or the ids have nothing to
      // pair with and the next request is rejected.
      const modelTurn = response.candidates?.[0]?.content;
      if (modelTurn) history.push(modelTurn as Content);

      const parts: unknown[] = [];
      for (const call of calls) {
        let result: unknown;
        try {
          result =
            call.name === 'search_roads'
              ? await rpc(
                  'discover_routes',
                  {
                    p_region: (call.args as { region?: string })?.region ?? null,
                    p_when: (call.args as { when?: string })?.when ?? null,
                    p_limit: 12,
                  },
                  auth!
                )
              : await rpc('rider_profile', {}, auth!);
        } catch (e) {
          // Hand the failure back rather than dropping it — a missing response
          // for a call id is rejected outright, and the model can say "I
          // couldn't look that up" far better than a 500 can.
          result = { error: `lookup failed: ${(e as Error).message}` };
        }
        parts.push({
          functionResponse: {
            // Both `name` and `id` are required and must match the call —
            // Gemini 3.5 made the id mandatory, and omitting it is a 400.
            name: call.name,
            id: call.id,
            response: { result },
          },
        });
      }
      history.push({ role: 'user', parts });
    }

    return json({ error: `gave up after ${MAX_TOOL_ROUNDS} tool rounds` }, 500);
  } catch (e) {
    const message = (e as Error).message ?? 'ride-ai failed';
    const status = message === 'unauthenticated' ? 401 : message === 'slow down' ? 429 : 500;
    return json({ error: message }, status);
  }
});
