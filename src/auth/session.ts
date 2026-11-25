import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { AuthSession } from '@/types/expense';

const SESSION_KEY = 'auth_session_v2';
const LEGACY_SESSION_KEY = 'auth_session_v1';
const listeners = new Set<(session: AuthSession | null) => void>();

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function saveAuthSession(session: AuthSession): Promise<void> {
  await setItem(SESSION_KEY, JSON.stringify(session));
  listeners.forEach((listener) => listener(session));
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  const raw = await getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as AuthSession;
    if (
      !session.accessToken ||
      !session.refreshToken ||
      !session.accessExpiresAt ||
      !session.refreshExpiresAt
    ) {
      return null;
    }
    if (Date.now() >= session.refreshExpiresAt) {
      await clearAuthSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function clearAuthSession(): Promise<void> {
  await deleteItem(SESSION_KEY);
  await deleteItem(LEGACY_SESSION_KEY);
  listeners.forEach((listener) => listener(null));
}

export function subscribeAuthSession(
  listener: (session: AuthSession | null) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function decodeJwtExpiry(idToken: string): number {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return Date.now() + 3600_000;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const json = globalThis.atob(normalized + pad);
    const parsed = JSON.parse(json) as { exp?: number };
    if (parsed.exp) return parsed.exp * 1000;
  } catch {
    // fall through
  }
  return Date.now() + 3600_000;
}
