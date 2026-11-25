/**
 * @deprecated Use authenticated upload via `@/services/api` + background sync.
 * Shared upload secrets must not live in the mobile app.
 */
export { isPdfMimeOrUri } from '@/services/api';

export async function uploadReceiptToR2(): Promise<never> {
  throw new Error(
    'Direct R2 upload secret flow removed. Receipts upload in the background via the authenticated API.'
  );
}
