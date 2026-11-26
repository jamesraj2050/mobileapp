import * as Google from 'expo-auth-session/providers/google';
import { exchangeCodeAsync, makeRedirectUri, type AuthSessionResult } from 'expo-auth-session';
import * as Linking from 'expo-linking';
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
import { NativeModules, Platform } from 'react-native';

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

const OAUTH_DIAG = '[TTR OAuth diag]';
const SENSITIVE_OAUTH_KEYS = new Set([
  'code',
  'id_token',
  'access_token',
  'refresh_token',
  'client_id',
  'client_secret',
]);

function redactOAuthQuery(raw: string): string {
  return raw
    .split('&')
    .map((part) => {
      const eq = part.indexOf('=');
      const key = (eq === -1 ? part : part.slice(0, eq)).toLowerCase();
      if (SENSITIVE_OAUTH_KEYS.has(key)) {
        return `${eq === -1 ? part : part.slice(0, eq)}=[REDACTED]`;
      }
      return part;
    })
    .join('&');
}

/** Temporary: keep scheme/path, strip codes, tokens, and client IDs. */
function redactOAuthUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const hashIndex = url.indexOf('#');
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex + 1);
  const queryIndex = withoutHash.indexOf('?');
  const base = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1);
  let redacted = base;
  if (query) redacted += `?${redactOAuthQuery(query)}`;
  if (hash) redacted += `#${hash.includes('=') ? redactOAuthQuery(hash) : '[REDACTED]'}`;
  return redacted;
}

function oauthResultSnapshot(result: AuthSessionResult) {
  const params = 'params' in result ? result.params : undefined;
  return {
    type: result.type,
    url: 'url' in result ? redactOAuthUrl(result.url) : null,
    paramKeys: params ? Object.keys(params) : [],
    hasCode: Boolean(params?.code),
    hasIdToken: Boolean(params?.id_token),
    hasAccessToken: Boolean(params?.access_token),
    error: 'error' in result ? result.error?.message ?? result.errorCode ?? null : null,
  };
}

function logOAuthDiag(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.warn(OAUTH_DIAG, message, details);
    return;
  }
  console.warn(OAUTH_DIAG, message);
}

const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

function googleAndroidRedirectUri(clientId: string | undefined): string | undefined {
  if (!clientId?.endsWith(GOOGLE_CLIENT_ID_SUFFIX)) return undefined;
  const prefix = clientId.slice(0, -GOOGLE_CLIENT_ID_SUFFIX.length);
  return prefix ? `com.googleusercontent.apps.${prefix}:/oauthredirect` : undefined;
}

function redirectUriShape(uri: string | null | undefined) {
  if (!uri) {
    return {
      uri: null,
      scheme: null,
      hasOauthredirectPath: false,
      isPackageScheme: false,
      isGoogleReversedScheme: false,
      isHttps: false,
    };
  }
  const isGoogleReversedScheme = uri.startsWith('com.googleusercontent.apps.');
  return {
    uri: isGoogleReversedScheme
      ? uri.replace(/^com\.googleusercontent\.apps\.[^:/]+/, 'com.googleusercontent.apps.[REDACTED]')
      : uri,
    scheme: isGoogleReversedScheme
      ? 'com.googleusercontent.apps.[REDACTED]'
      : (uri.split(':')[0] ?? null),
    hasOauthredirectPath: /oauthredirect/i.test(uri),
    isPackageScheme: uri.startsWith('com.arkconsultinggroup.travelexpenses:'),
    isGoogleReversedScheme,
    isHttps: uri.startsWith('https:'),
  };
}

function authorizeRedirectUri(requestUrl: string | undefined): string | null {
  if (!requestUrl) return null;
  const match = requestUrl.match(/[?&]redirect_uri=([^&]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1].replace(/\+/g, ' '));
  } catch {
    return match[1];
  }
}

function agentLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string
): void {
  logOAuthDiag(message, data);
  // #region agent log
  const payload = JSON.stringify({
    sessionId: '7e5b01',
    location,
    message,
    data,
    timestamp: Date.now(),
    hypothesisId,
    runId: 'post-fix',
  });
  const headers = {
    'Content-Type': 'application/json',
    'X-Debug-Session-Id': '7e5b01',
  };
  const ingestPath = '/ingest/0a45d84a-b160-4d87-9d50-39d0f82bc164';
  fetch(`http://127.0.0.1:7782${ingestPath}`, {
    method: 'POST',
    headers,
    body: payload,
  }).catch(() => {});
  try {
    const scriptURL = NativeModules.SourceCode?.scriptURL as string | undefined;
    const metroHost = scriptURL?.match(/^https?:\/\/([^:/]+)/)?.[1];
    if (metroHost && metroHost !== '127.0.0.1' && metroHost !== 'localhost') {
      fetch(`http://${metroHost}:7782${ingestPath}`, {
        method: 'POST',
        headers,
        body: payload,
      }).catch(() => {});
    }
  } catch {
    /* Physical-device Metro host is best-effort. */
  }
  // #endregion
}

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

  // Web keeps localhost. Android Google clients redirect to the reversed client-ID
  // scheme, not `${applicationId}:/oauthredirect`. iOS still uses AuthSession default.
  const webRedirectUri =
    Platform.OS === 'web' ? makeRedirectUri({ preferLocalhost: true }) : undefined;
  const androidRedirectUri =
    Platform.OS === 'android' ? googleAndroidRedirectUri(ids.androidClientId) : undefined;
  const platformRedirectUri = webRedirectUri ?? androidRedirectUri;

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest(
    configured
      ? {
          iosClientId: ids.iosClientId,
          androidClientId: ids.androidClientId,
          webClientId: ids.webClientId,
          clientId: ids.clientId,
          ...(platformRedirectUri ? { redirectUri: platformRedirectUri } : {}),
        }
      : {
          clientId: 'UNCONFIGURED.apps.googleusercontent.com',
          webClientId: 'UNCONFIGURED.apps.googleusercontent.com',
          ...(platformRedirectUri ? { redirectUri: platformRedirectUri } : {}),
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

  useEffect(() => {
    if (!request) return;
    // #region agent log
    agentLog(
      'auth-context.tsx:AuthRequest',
      'AuthRequest ready',
      {
        platform: Platform.OS,
        responseType: request.responseType,
        redirect: redirectUriShape(request.redirectUri),
        authorizeRedirect: redirectUriShape(authorizeRedirectUri(request.url ?? undefined)),
        hasAndroidClientId: Boolean(ids.androidClientId),
      },
      'H1'
    );
    // #endregion
  }, [ids.androidClientId, request]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    const subscription = Linking.addEventListener('url', (event) => {
      // #region agent log
      agentLog(
        'auth-context.tsx:Linking.url',
        'Linking url event',
        {
          received: true,
          url: redactOAuthUrl(event.url),
          shape: redirectUriShape(redactOAuthUrl(event.url)),
        },
        'H1'
      );
      // #endregion
    });
    void Linking.getInitialURL().then((url) => {
      if (cancelled) return;
      // #region agent log
      agentLog(
        'auth-context.tsx:Linking.initial',
        'Linking initial URL',
        {
          received: Boolean(url),
          url: redactOAuthUrl(url),
        },
        'H1'
      );
      // #endregion
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const finishWithAuthResult = useCallback(
    async (result: AuthSessionResult) => {
      const snapshot = {
        ...oauthResultSnapshot(result),
        expectedRedirect: redirectUriShape(request?.redirectUri ?? null),
      };
      // #region agent log
      agentLog('auth-context.tsx:finishWithAuthResult', 'AuthSession result', snapshot, 'H5');
      // #endregion
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
            // #region agent log
            agentLog(
              'auth-context.tsx:finishWithAuthResult',
              'Missing platform client ID',
              { platform: Platform.OS },
              'H3'
            );
            // #endregion
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
          // #region agent log
          agentLog(
            'auth-context.tsx:finishWithAuthResult',
            'Code exchange completed',
            { hasIdToken: Boolean(idToken) },
            'H3'
          );
          // #endregion
        }

        if (!idToken) {
          // #region agent log
          agentLog(
            'auth-context.tsx:finishWithAuthResult',
            'No ID token after success response',
            { hasCode: Boolean(result.params.code) },
            'H3'
          );
          // #endregion
          setError(
            'Google did not return an ID token. Check OAuth client IDs and redirect URIs in Google Cloud Console.'
          );
          return;
        }

        const next = await establishSession(idToken);
        setSession(next);
        setError(null);
        // #region agent log
        agentLog(
          'auth-context.tsx:finishWithAuthResult',
          'Application session established',
          { hasUserId: Boolean(next.user.id) },
          'H3'
        );
        // #endregion
      } catch (e) {
        await clearAuthSession();
        setSession(null);
        // #region agent log
        agentLog(
          'auth-context.tsx:finishWithAuthResult',
          'Session establish failed',
          {
            isApiError: e instanceof ApiError,
            status: e instanceof ApiError ? e.status : null,
            name: e instanceof Error ? e.name : 'unknown',
          },
          'H3'
        );
        // #endregion
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
      // #region agent log
      agentLog(
        'auth-context.tsx:signIn',
        'promptAsync starting',
        {
          platform: Platform.OS,
          redirect: redirectUriShape(request.redirectUri),
        },
        'H4'
      );
      // #endregion
      const result = await promptAsync();
      // #region agent log
      agentLog(
        'auth-context.tsx:signIn',
        'promptAsync returned',
        oauthResultSnapshot(result),
        'H4'
      );
      // #endregion
      // On web, success often arrives via `response` effect; still handle here for native/popup.
      await finishWithAuthResult(result);
    } catch (e) {
      // #region agent log
      agentLog(
        'auth-context.tsx:signIn',
        'promptAsync threw',
        { name: e instanceof Error ? e.name : 'unknown' },
        'H4'
      );
      // #endregion
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
      redirectUri: webRedirectUri ?? '',
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
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
