import * as Google from 'expo-auth-session/providers/google';
import { exchangeCodeAsync, makeRedirectUri, type AuthSessionResult } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import {
  clearAuthSession,
  loadAuthSession,
  subscribeAuthSession,
} from '@/auth/session';
import {
  ApiError,
  createApplicationSession,
  revokeApplicationSession,
} from '@/services/api';
import type { AuthSession } from '@/types/expense';

WebBrowser.maybeCompleteAuthSession();

type AuthContextValue = {
  session: AuthSession | null;
  ready: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  configured: boolean;
  /** Exact URI to add under Google Cloud → Web client → Authorized redirect URIs */
  redirectUri: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function googleClientIds() {
  return {
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    clientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  };
}

function clientIdForPlatform(ids: ReturnType<typeof googleClientIds>): string | undefined {
  if (Platform.OS === 'ios') return ids.iosClientId || ids.clientId;
  if (Platform.OS === 'android') return ids.androidClientId || ids.clientId;
  return ids.webClientId || ids.clientId;
}

function clearWebAuthCallbackUrl(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const hash = window.location.hash;
  if (
    !hash ||
    (!hash.includes('id_token=') && !hash.includes('code=') && !hash.includes('error='))
  ) {
    return;
  }
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`
  );
}

async function establishSession(idToken: string): Promise<AuthSession> {
  const session = await createApplicationSession(idToken);
  if (!session.user.id) {
    throw new ApiError(503, 'API did not return a user. Redeploy the Worker authenticated API.');
  }
  return session;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finishingRef = useRef(false);
  const handledResponseRef = useRef<AuthSessionResult | null>(null);

  const ids = useMemo(() => googleClientIds(), []);
  const configured = Boolean(ids.webClientId || ids.iosClientId || ids.androidClientId);

  // Web must keep the existing localhost redirect. Native must omit redirectUri so
  // expo-auth-session uses `${Application.applicationId}:/oauthredirect`.
  const webRedirectUri =
    Platform.OS === 'web' ? makeRedirectUri({ preferLocalhost: true }) : undefined;

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest(
    configured
      ? {
          iosClientId: ids.iosClientId,
          androidClientId: ids.androidClientId,
          webClientId: ids.webClientId,
          clientId: ids.clientId,
          ...(webRedirectUri ? { redirectUri: webRedirectUri } : {}),
        }
      : {
          clientId: 'UNCONFIGURED.apps.googleusercontent.com',
          webClientId: 'UNCONFIGURED.apps.googleusercontent.com',
          ...(webRedirectUri ? { redirectUri: webRedirectUri } : {}),
        }
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await loadAuthSession();
      if (!cancelled) {
        setSession(existing);
        setReady(true);
      }
    })();
    const unsubscribe = subscribeAuthSession((next) => {
      if (!cancelled) setSession(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const finishWithAuthResult = useCallback(
    async (result: AuthSessionResult) => {
      if (finishingRef.current) return;
      if (result.type !== 'success') {
        if (result.type === 'error') {
          setError(result.error?.message ?? 'Google sign-in failed');
        } else if (result.type === 'dismiss' || result.type === 'cancel') {
          setError(
            Platform.OS === 'web'
              ? 'Sign-in did not finish. Open http://localhost:8081 in Chrome or Safari (Cursor’s browser often blocks Google after Allow), and add this Redirect URI in Google Cloud Console (Web client).'
              : 'Sign-in was cancelled.'
          );
        }
        return;
      }

      clearWebAuthCallbackUrl();
      finishingRef.current = true;
      setSigningIn(true);
      setError(null);
      try {
        let idToken =
          result.params.id_token ||
          (result.authentication as { idToken?: string } | null)?.idToken ||
          '';

        // Native flows often return an auth code first; exchange it for an ID token.
        if (!idToken && result.params.code && request) {
          const clientId = clientIdForPlatform(ids);
          if (!clientId) {
            setError('Missing Google client ID for this platform.');
            return;
          }
          const exchanged = await exchangeCodeAsync(
            {
              clientId,
              code: result.params.code,
              redirectUri: request.redirectUri,
              extraParams: {
                code_verifier: request.codeVerifier ?? '',
              },
            },
            Google.discovery
          );
          idToken = exchanged.idToken ?? '';
        }

        if (!idToken) {
          setError(
            'Google did not return an ID token. Check OAuth client IDs and redirect URIs in Google Cloud Console.'
          );
          return;
        }

        const next = await establishSession(idToken);
        setSession(next);
        setError(null);
      } catch (e) {
        await clearAuthSession();
        setSession(null);
        if (e instanceof ApiError) {
          setError(e.message);
        } else {
          setError(e instanceof Error ? e.message : 'Google sign-in failed');
        }
      } finally {
        finishingRef.current = false;
        setSigningIn(false);
      }
    },
    [ids, request]
  );

  // Completes sign-in when Google redirects back (popup or full-page return).
  useEffect(() => {
    if (!response || handledResponseRef.current === response) return;
    handledResponseRef.current = response;
    void finishWithAuthResult(response);
  }, [response, finishWithAuthResult]);

  const signIn = useCallback(async () => {
    if (!configured) {
      setError(
        'Add EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (and iOS/Android IDs) to .env, then restart Expo.'
      );
      return;
    }
    if (!request) {
      setError('Google sign-in is still preparing. Wait a second and try again.');
      return;
    }
    setError(null);
    setSigningIn(true);
    try {
      const result = await promptAsync();
      // On web, success often arrives via `response` effect; still handle here for native/popup.
      await finishWithAuthResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed');
      setSigningIn(false);
    }
  }, [configured, promptAsync, request, finishWithAuthResult]);

  const signOut = useCallback(async () => {
    const current = await loadAuthSession();
    if (current?.refreshToken) {
      await revokeApplicationSession(current.refreshToken);
    }
    await clearAuthSession();
    clearWebAuthCallbackUrl();
    setSession(null);
    setError(null);
    setSigningIn(false);
  }, []);

  const value = useMemo(
    () => ({
      session,
      ready,
      signingIn,
      error,
      signIn,
      signOut,
      configured: configured && (Platform.OS === 'web' ? !!ids.webClientId : true),
      redirectUri: webRedirectUri ?? request?.redirectUri ?? '',
    }),
    [
      session,
      ready,
      signingIn,
      error,
      signIn,
      signOut,
      configured,
      ids.webClientId,
      webRedirectUri,
      request?.redirectUri,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
