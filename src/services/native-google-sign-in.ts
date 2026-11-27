export async function nativeGoogleIdToken(
  _webClientId: string,
  _iosClientId?: string
): Promise<string | null> {
  throw new Error('Native Google Sign-In is unavailable on web.');
}

export async function nativeGoogleSignOut(): Promise<void> {}

export function nativeGoogleErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Google sign-in failed.';
}
