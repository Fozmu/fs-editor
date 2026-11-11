import { create } from 'zustand';
import { CLOUD } from './config';

/** Minimal Supabase Auth (GoTrue) client: email + password, session kept in localStorage. */

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** ms epoch */
  expiresAt: number;
  userId: string;
  email: string;
}

const KEY = 'fs-cloud-session';

function load(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Session | null;
    return s?.refreshToken ? s : null;
  } catch {
    return null;
  }
}

function persist(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const useAuth = create<{ session: Session | null }>(() => ({ session: load() }));

const setSession = (s: Session | null) => {
  persist(s);
  useAuth.setState({ session: s });
};

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  user: { id: string; email?: string };
}

async function gotrue<T>(path: string, body: unknown, token?: string): Promise<T> {
  const r = await fetch(`${CLOUD.supabaseUrl}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: CLOUD.anonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = data as { msg?: string; message?: string; error_description?: string; error?: string };
    throw new Error(d.msg || d.message || d.error_description || d.error || `Sign-in service error (${r.status})`);
  }
  return data as T;
}

const toSession = (t: TokenResponse): Session => ({
  accessToken: t.access_token,
  refreshToken: t.refresh_token,
  expiresAt: t.expires_at ? t.expires_at * 1000 : Date.now() + t.expires_in * 1000,
  userId: t.user.id,
  email: t.user.email ?? '',
});

export async function signIn(email: string, password: string) {
  setSession(toSession(await gotrue<TokenResponse>('token?grant_type=password', { email, password })));
}

/** Returns true when signed in right away, false when Supabase sent a confirmation email first. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const r = await gotrue<Partial<TokenResponse>>('signup', { email, password });
  if (r.access_token) {
    setSession(toSession(r as TokenResponse));
    return true;
  }
  return false;
}

export async function resetPassword(email: string) {
  await gotrue('recover', { email });
}

export async function signOut() {
  const s = useAuth.getState().session;
  setSession(null);
  if (s) await gotrue('logout', {}, s.accessToken).catch(() => {});
}

let refreshing: Promise<Session> | null = null;

/** A valid access token, refreshed when close to expiry. Throws when signed out. */
export async function accessToken(): Promise<string> {
  const s = useAuth.getState().session;
  if (!s) throw new Error('Sign in to use the cloud');
  if (s.expiresAt - Date.now() > 60_000) return s.accessToken;
  refreshing ??= gotrue<TokenResponse>('token?grant_type=refresh_token', { refresh_token: s.refreshToken })
    .then((t) => {
      const ns = toSession(t);
      setSession(ns);
      return ns;
    })
    .catch((e) => {
      setSession(null);
      throw new Error('Session expired, sign in again (' + (e as Error).message + ')');
    })
    .finally(() => (refreshing = null));
  return (await refreshing).accessToken;
}
