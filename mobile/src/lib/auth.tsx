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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

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
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    let alive = true;
    setProfileLoading(true);
    // A failed fetch is NOT "no profile" — a cold start with an expired token
    // 401s here, and treating that as a fresh account marched existing users
    // back to the handle screen (the long-absence lockout bug). Only a
    // successful query gets to say whether the profile exists; failures retry
    // with backoff while the token refresh catches up.
    let attempt = 0;
    const load = () => {
      getProfile(userId)
        .then((p) => {
          if (!alive) return;
          setProfile(p);
          setProfileLoading(false);
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
          // Server unreachable: an offline rider with a cached profile still
          // gets their app (recording works offline by design). Only a rider
          // the server has never confirmed falls through to onboarding.
          try {
            const cached = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
            if (alive && cached) {
              const parsed = JSON.parse(cached) as Profile;
              if (parsed.id === userId) setProfile(parsed);
            }
          } catch {
            /* no cache — onboarding it is */
          }
          if (alive) setProfileLoading(false);
        });
    };
    load();
    return () => {
      alive = false;
    };
  }, [userId]);

  const refreshProfile = async () => {
    if (!userId) return;
    setProfile(await getProfile(userId));
  };

  return (
    <AuthContext.Provider
      value={{ session, profile, loading: !sessionResolved || profileLoading, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
