import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { User as SupabaseAuthUser } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import type { AppUser, UserRole } from '@/types/user';

/*
 * Real authentication, backed by Supabase Auth.
 *
 *  - The Supabase session (JWT) is the single source of truth. Nothing about
 *    the user's identity or role is stored by this app in sessionStorage /
 *    localStorage, so it cannot be forged from the browser console.
 *  - The role is read from the `profiles` table (RLS-protected; only an
 *    existing admin can change it).
 *  - MFA is real Supabase TOTP:
 *      * a user who has a verified TOTP factor must always verify a code;
 *      * an admin with no factor yet must enrol one (QR code) first.
 *    Until MFA is completed, `isAuthenticated` stays false and the app only
 *    shows the MFA screen.
 */

const VALID_ROLES: UserRole[] = ['admin', 'investigator', 'officer', 'analyst'];

interface AuthState {
  user: AppUser | null;
  pendingMfaUser: AppUser | null;
  mfaEnrollment: { qrCode: string; secret: string } | null;
  isAuthenticated: boolean;
  mfaRequired: boolean;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (
    email: string,
    password: string
  ) => Promise<{ success: boolean; requiresMfa: boolean; error?: string }>;
  verifyMfa: (code: string) => Promise<{ success: boolean; error?: string }>;
  cancelMfa: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadProfile(authUser: SupabaseAuthUser): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, role')
    .eq('id', authUser.id)
    .maybeSingle();

  if (error || !data) return null;
  if (!VALID_ROLES.includes(data.role as UserRole)) return null;

  return {
    id: data.id,
    name: data.name || authUser.email || 'User',
    email: data.email || authUser.email || '',
    role: data.role as UserRole,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [pendingMfaUser, setPendingMfaUser] = useState<AppUser | null>(null);
  const [mfaEnrollment, setMfaEnrollment] =
    useState<{ qrCode: string; secret: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // TOTP factor id we are currently verifying / enrolling.
  const factorIdRef = useRef<string | null>(null);

  const clearState = useCallback(() => {
    factorIdRef.current = null;
    setUser(null);
    setPendingMfaUser(null);
    setMfaEnrollment(null);
  }, []);

  /**
   * Given an existing Supabase session, decide whether the user is fully
   * signed in or still has to complete MFA. Returns what happened.
   */
  const resolveSession = useCallback(
    async (authUser: SupabaseAuthUser): Promise<{ status: 'ok' | 'mfa' | 'error'; error?: string }> => {
      const profile = await loadProfile(authUser);
      if (!profile) {
        await supabase.auth.signOut();
        clearState();
        return {
          status: 'error',
          error: 'Your account has no profile or role assigned. Contact an administrator.',
        };
      }

      const { data: aal, error: aalError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError || !aal) {
        await supabase.auth.signOut();
        clearState();
        return { status: 'error', error: 'Could not verify your security level. Please try again.' };
      }

      // Already verified in this session.
      if (aal.currentLevel === 'aal2') {
        setUser(profile);
        setPendingMfaUser(null);
        setMfaEnrollment(null);
        return { status: 'ok' };
      }

      // Has an enrolled factor -> must verify a code.
      if (aal.nextLevel === 'aal2') {
        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
        const factor = factors?.totp?.[0]; // `totp` only contains verified factors
        if (factorsError || !factor) {
          await supabase.auth.signOut();
          clearState();
          return { status: 'error', error: 'Could not load your authenticator. Please try again.' };
        }
        factorIdRef.current = factor.id;
        setUser(null);
        setMfaEnrollment(null);
        setPendingMfaUser(profile);
        return { status: 'mfa' };
      }

      // No factor yet. Admins must enrol one; everyone else goes straight in.
      if (profile.role === 'admin') {
        // Drop any half-finished (unverified) enrolments from earlier attempts.
        const { data: all } = await supabase.auth.mfa.listFactors();
        for (const f of all?.all ?? []) {
          if (f.factor_type === 'totp' && f.status === 'unverified') {
            await supabase.auth.mfa.unenroll({ factorId: f.id });
          }
        }

        const { data: enrol, error: enrolError } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: `CaseVault ${new Date().toISOString()}`,
        });
        if (enrolError || !enrol) {
          await supabase.auth.signOut();
          clearState();
          return { status: 'error', error: 'Could not start authenticator setup. Please try again.' };
        }
        factorIdRef.current = enrol.id;
        setUser(null);
        setMfaEnrollment({ qrCode: enrol.totp.qr_code, secret: enrol.totp.secret });
        setPendingMfaUser(profile);
        return { status: 'mfa' };
      }

      setUser(profile);
      setPendingMfaUser(null);
      setMfaEnrollment(null);
      return { status: 'ok' };
    },
    [clearState]
  );

  // Restore the real Supabase session on page load / refresh.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!cancelled && data.session?.user) {
          await resolveSession(data.session.user);
        }
      } catch (err) {
        console.error('Failed to restore session:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // Keep UI in sync if the session ends elsewhere (sign-out in another tab,
    // refresh token expired/revoked). Only synchronous work in this callback.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') clearState();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [resolveSession, clearState]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data.user) {
        // Same message for wrong email / wrong password (no user enumeration).
        return { success: false, requiresMfa: false, error: 'Invalid login credentials' };
      }

      const result = await resolveSession(data.user);
      if (result.status === 'error') {
        return { success: false, requiresMfa: false, error: result.error };
      }
      return { success: true, requiresMfa: result.status === 'mfa' };
    },
    [resolveSession]
  );

  const verifyMfa = useCallback(
    async (code: string) => {
      const factorId = factorIdRef.current;
      if (!factorId || !pendingMfaUser) {
        return { success: false, error: 'No verification in progress. Please sign in again.' };
      }

      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) {
        return { success: false, error: 'Invalid or expired code. Please try again.' };
      }

      // Session is now aal2 — complete sign-in.
      setUser(pendingMfaUser);
      setPendingMfaUser(null);
      setMfaEnrollment(null);
      factorIdRef.current = null;
      return { success: true };
    },
    [pendingMfaUser]
  );

  const cancelMfa = useCallback(async () => {
    // If enrolment was never confirmed, remove the dangling factor.
    const factorId = factorIdRef.current;
    if (factorId && mfaEnrollment) {
      await supabase.auth.mfa.unenroll({ factorId }).catch(() => {});
    }
    await supabase.auth.signOut();
    clearState();
  }, [mfaEnrollment, clearState]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    clearState();
  }, [clearState]);

  const value: AuthContextValue = {
    user,
    pendingMfaUser,
    mfaEnrollment,
    isAuthenticated: !!user,
    mfaRequired: !!pendingMfaUser,
    loading,
    login,
    verifyMfa,
    cancelMfa,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}
