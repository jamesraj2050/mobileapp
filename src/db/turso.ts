/**
 * @deprecated Direct Turso access removed from the mobile app.
 * Use the Cloudflare Worker API (`src/services/api.ts`) instead.
 * This file is kept only so accidental imports fail loudly.
 */
export function tursoRemoved(): never {
  throw new Error(
    'Direct Turso access has been removed. Use the authenticated Worker API and local-first storage.'
  );
}
