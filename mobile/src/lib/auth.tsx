import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

import { getProfile, Profile } from './db';
import { supabase } from './supabase';

const PROFILE_CACHE_KEY = 'trace_profile_cache';

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  /** True until the stored session AND the profile row have both resolved. */
  loading: boolean;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  // Profile state remembers WHO it was resolved for. This kills the cold-start
  // race for good: the frame where a session exists but its profile fetch
  // hasn't begun reads as loading — never as "no profile". That misread was
  // the kill-and-reopen lockout.
  const [profileState, setProfileState] = useState<{ uid: string | null; profile: Profile | null }>(
    { uid: null, profile: null }
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionResolved(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setSessionResolved(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId) {
      setProfileState({ uid: null, profile: null });
      return;
    }
    let alive = true;
    // A failed fetch is NOT "no profile" — only a successful query gets to say
    // whether the profile exists; failures retry with backoff while the token
    // refresh catches up, then fall back to the cached profile (offline
    // riders keep their app; recording works offline by design).
    let attempt = 0;
    const load = () => {
      getProfile(userId)
        .then((p) => {
          if (!alive) return;
          setProfileState({ uid: userId, profile: p });
          if (p) AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p)).catch(() => {});
          else AsyncStorage.removeItem(PROFILE_CACHE_KEY).catch(() => {});
        })
        .catch(async () => {
          if (!alive) return;
          attempt += 1;
          if (attempt <= 4) {
            setTimeout(load, Math.min(8000, 500 * 2 ** attempt));
            return;
          }
          try {
            const cached = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
            if (alive && cached) {
              const parsed = JSON.parse(cached) as Profile;
              if (parsed.id === userId) {
                setProfileState({ uid: userId, profile: parsed });
                return;
              }
            }
          } catch {
            /* fall through */
          }
          // Server unreachable AND no cache: resolve as no-profile so a truly
          // fresh account can still onboard.
          if (alive) setProfileState({ uid: userId, profile: null });
        });
    };
    load();
    return () => {
      alive = false;
    };
  }, [userId]);

  const refreshProfile = async () => {
    if (!userId) return;
    const p = await getProfile(userId);
    setProfileState({ uid: userId, profile: p });
    if (p) AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p)).catch(() => {});
  };

  // Resolved-for-the-current-user or it doesn't count: the value AND the
  // loading flag both key off uid, so no render can ever read a stale or
  // not-yet-started resolution as "this user has no profile".
  const profile = profileState.uid === userId ? profileState.profile : null;
  const profileSettled = userId === null || profileState.uid === userId;

  return (
    <AuthContext.Provider
      value={{ session, profile, loading: !sessionResolved || !profileSettled, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
