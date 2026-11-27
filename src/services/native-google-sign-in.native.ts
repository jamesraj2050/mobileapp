import {
  GoogleOneTapSignIn,
  isCancelledResponse,
  isErrorWithCode,
  isNoSavedCredentialFoundResponse,
  isSuccessResponse,
} from 'react-native-nitro-google-signin';

let configuredFor: string | null = null;

function configure(webClientId: string, iosClientId?: string): void {
  const key = `${webClientId}:${iosClientId ?? ''}`;
  if (configuredFor === key) return;
  GoogleOneTapSignIn.configure({
    webClientId,
    iosClientId: iosClientId ?? null,
    offlineAccess: false,
    autoSelectOnSignIn: false,
  });
  configuredFor = key;
}

export async function nativeGoogleIdToken(
  webClientId: string,
  iosClientId?: string
): Promise<string | null> {
  configure(webClientId, iosClientId);
  await GoogleOneTapSignIn.checkPlayServices(true);

  let response = await GoogleOneTapSignIn.signIn();
  if (isNoSavedCredentialFoundResponse(response)) {
    response = await GoogleOneTapSignIn.createAccount();
  }
  if (isNoSavedCredentialFoundResponse(response)) {
    response = await GoogleOneTapSignIn.presentExplicitSignIn();
  }
  if (isCancelledResponse(response)) return null;
  if (!isSuccessResponse(response) || !response.data.idToken) {
    throw new Error('Google Sign-In did not return an ID token.');
  }
  return response.data.idToken;
}

export async function nativeGoogleSignOut(): Promise<void> {
  if (!configuredFor) return;
  await GoogleOneTapSignIn.signOut();
}

export function nativeGoogleErrorMessage(error: unknown): string {
  if (!isErrorWithCode(error)) {
    return error instanceof Error ? error.message : 'Google sign-in failed.';
  }
  switch (error.code) {
    case 'DEVELOPER_ERROR':
      return 'Google Sign-In is not configured for this Android app signature. Check the package name and Play App Signing SHA-1 in the Android OAuth client.';
    case 'PLAY_SERVICES_NOT_AVAILABLE':
      return 'Google Play Services is unavailable or needs to be updated.';
    case 'IN_PROGRESS':
      return 'Google sign-in is already in progress.';
    case 'SIGN_IN_CANCELLED':
      return 'Google sign-in was cancelled.';
    default:
      return 'Google sign-in failed. Please try again.';
  }
}
