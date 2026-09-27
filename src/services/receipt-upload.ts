/**
 * Upload a local receipt file (image or PDF) to Cloudflare R2 via Worker.
 * Returns the public Worker URL for the stored object.
 */
export async function uploadReceiptToR2(
  localUri: string,
  mimeTypeHint?: string | null
): Promise<string> {
  const baseUrl = process.env.EXPO_PUBLIC_RECEIPT_UPLOAD_URL?.replace(/\/$/, '');
  const secret = process.env.EXPO_PUBLIC_RECEIPT_UPLOAD_SECRET;

  if (!baseUrl) {
    throw new Error(
      'Missing EXPO_PUBLIC_RECEIPT_UPLOAD_URL. Deploy workers/receipt-upload and add it to .env'
    );
  }
  if (!secret) {
    throw new Error('Missing EXPO_PUBLIC_RECEIPT_UPLOAD_SECRET in .env');
  }

  const fileResponse = await fetch(localUri);
  if (!fileResponse.ok) {
    throw new Error('Could not read the receipt file from the device');
  }

  const headerType = fileResponse.headers.get('Content-Type');
  const contentType =
    mimeTypeHint ||
    headerType ||
    (localUri.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

  const body = await fileResponse.blob();

  const uploadResponse = await fetch(`${baseUrl}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'X-Upload-Secret': secret,
    },
    body,
  });

  const payload = (await uploadResponse.json().catch(() => null)) as
    | { url?: string; error?: string }
    | null;

  if (!uploadResponse.ok || !payload?.url) {
    throw new Error(payload?.error || `Receipt upload failed (${uploadResponse.status})`);
  }

  return payload.url;
}

export function isPdfMimeOrUri(mimeType?: string | null, uri?: string | null): boolean {
  if (mimeType?.toLowerCase().includes('pdf')) return true;
  if (uri?.toLowerCase().includes('.pdf')) return true;
  return false;
}
