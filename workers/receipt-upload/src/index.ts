/**
 * Cloudflare Worker: upload & serve receipt images from R2.
 *
 * Deploy (from this folder):
 *   npx wrangler login
 *   npx wrangler secret put UPLOAD_SECRET
 *   npx wrangler deploy
 *
 * Then put the worker URL in the Expo app .env:
 *   EXPO_PUBLIC_RECEIPT_UPLOAD_URL=https://<worker>.workers.dev
 *   EXPO_PUBLIC_RECEIPT_UPLOAD_SECRET=<same value as UPLOAD_SECRET>
 */

export interface Env {
  RECEIPTS: R2Bucket;
  UPLOAD_SECRET: string;
}

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Secret',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

function unauthorized(): Response {
  return json({ error: 'Unauthorized' }, 401);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);

    // Serve an uploaded receipt: GET /receipts/<key>
    if (request.method === 'GET' && url.pathname.startsWith('/receipts/')) {
      const key = decodeURIComponent(url.pathname.replace(/^\/receipts\//, ''));
      if (!key || key.includes('..')) {
        return json({ error: 'Invalid key' }, 400);
      }

      const object = await env.RECEIPTS.get(key);
      if (!object) {
        return new Response('Not found', { status: 404, headers: corsHeaders() });
      }

      const headers = new Headers(corsHeaders());
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(object.body, { headers });
    }

    // Upload a receipt: POST /upload
    if (request.method === 'POST' && url.pathname === '/upload') {
      if (!env.UPLOAD_SECRET || request.headers.get('X-Upload-Secret') !== env.UPLOAD_SECRET) {
        return unauthorized();
      }

      const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
      const normalized = contentType.split(';')[0].trim().toLowerCase();
      const allowed =
        normalized.startsWith('image/') ||
        normalized === 'application/pdf' ||
        normalized === 'application/octet-stream';

      if (!allowed) {
        return json({ error: 'Only image or PDF uploads are allowed' }, 400);
      }

      const ext =
        normalized === 'application/pdf'
          ? 'pdf'
          : normalized.includes('png')
            ? 'png'
            : normalized.includes('webp')
              ? 'webp'
              : normalized.includes('heic')
                ? 'heic'
                : 'jpg';

      const key = `receipts/${crypto.randomUUID()}.${ext}`;
      await env.RECEIPTS.put(key, request.body, {
        httpMetadata: {
          contentType: normalized === 'application/octet-stream' ? 'image/jpeg' : normalized,
        },
      });

      const publicUrl = `${url.origin}/receipts/${encodeURIComponent(key)}`;
      return json({ key, url: publicUrl });
    }

    return json({
      ok: true,
      service: 'receipt-upload',
      endpoints: ['POST /upload', 'GET /receipts/<key>'],
    });
  },
};
