/**
 * Gemini vision extraction for receipts / tickets.
 * Secret: GEMINI_API_KEY (wrangler secret put GEMINI_API_KEY)
 * Optional: GEMINI_MODEL (default gemini-2.5-flash)
 */

export type ReceiptExpenseType =
  | 'flight'
  | 'car'
  | 'taxi'
  | 'bus'
  | 'train'
  | 'meal'
  | 'accommodation'
  | 'parking'
  | 'other';

export type ReceiptExtraction = {
  type: ReceiptExpenseType | null;
  amount: number | null;
  date: string | null;
  from: string | null;
  to: string | null;
  merchant: string | null;
};

const DEFAULT_MODEL = 'gemini-2.5-flash';

/** Try these if the preferred model is retired / unavailable. */
const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-flash-latest',
];

const EXTRACT_PROMPT = `Extract expense fields from this receipt, ticket, boarding pass, invoice, bus/train ticket, taxi receipt, or hotel folio.

Return ONLY valid JSON:
{
  "type": "flight"|"car"|"taxi"|"bus"|"train"|"meal"|"accommodation"|"parking"|"other"|null,
  "amount": number or null,
  "date": "YYYY-MM-DD" or null,
  "from": string or null,
  "to": string or null,
  "merchant": string or null
}

Priority: always try to fill type, date, and amount.
For travel (flight/car/taxi/bus/train): also fill from and to (city or airport names).
For meal/accommodation/parking: leave from and to as null.
Map rideshare/auto-rickshaw to taxi. Map coach/bus tickets to bus. Map airline tickets to flight.
Use null when truly unknown — do not invent values.`;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Detect real file type from magic bytes — DocumentPicker often sends octet-stream. */
export function sniffReceiptMime(bytes: ArrayBuffer, declared?: string): string {
  const u8 = new Uint8Array(bytes);
  const declaredMime = (declared || '').split(';')[0].trim().toLowerCase();

  // %PDF
  if (u8.length >= 4 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) {
    return 'application/pdf';
  }
  // JPEG
  if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG
  if (
    u8.length >= 8 &&
    u8[0] === 0x89 &&
    u8[1] === 0x50 &&
    u8[2] === 0x4e &&
    u8[3] === 0x47
  ) {
    return 'image/png';
  }
  // WEBP: RIFF....WEBP
  if (
    u8.length >= 12 &&
    u8[0] === 0x52 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[3] === 0x46 &&
    u8[8] === 0x57 &&
    u8[9] === 0x45 &&
    u8[10] === 0x42 &&
    u8[11] === 0x50
  ) {
    return 'image/webp';
  }

  if (declaredMime === 'image/jpg') return 'image/jpeg';
  if (declaredMime.startsWith('image/') || declaredMime === 'application/pdf') {
    return declaredMime;
  }
  return 'image/jpeg';
}

function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return trimmed;
  const slash = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(trimmed);
  if (slash) {
    const d = slash[1]!.padStart(2, '0');
    const m = slash[2]!.padStart(2, '0');
    const y = slash[3]!;
    return `${y}-${m}-${d}`;
  }
  return null;
}

function normalizeAmount(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw * 100) / 100;
  }
  if (typeof raw === 'string') {
    const n = Number(raw.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return null;
}

function normalizePlace(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed
    .split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

function normalizeType(raw: unknown): ReceiptExpenseType | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, '');
  const aliases: Record<string, ReceiptExpenseType> = {
    flight: 'flight',
    airline: 'flight',
    airfare: 'flight',
    plane: 'flight',
    car: 'car',
    rentalcar: 'car',
    hirecar: 'car',
    taxi: 'taxi',
    uber: 'taxi',
    ola: 'taxi',
    didi: 'taxi',
    rideshare: 'taxi',
    auto: 'taxi',
    autorickshaw: 'taxi',
    bus: 'bus',
    coach: 'bus',
    train: 'train',
    rail: 'train',
    meal: 'meal',
    food: 'meal',
    restaurant: 'meal',
    lunch: 'meal',
    dinner: 'meal',
    breakfast: 'meal',
    cafe: 'meal',
    accommodation: 'accommodation',
    hotel: 'accommodation',
    lodging: 'accommodation',
    motel: 'accommodation',
    airbnb: 'accommodation',
    parking: 'parking',
    other: 'other',
  };
  return aliases[key] ?? null;
}

function parseExtraction(text: string): ReceiptExtraction {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  let type = normalizeType(parsed.type);
  const from = normalizePlace(parsed.from);
  const to = normalizePlace(parsed.to);

  // Infer transport type when route exists but type missing.
  if (!type && from && to) type = 'flight';

  return {
    type,
    amount: normalizeAmount(parsed.amount),
    date: normalizeDate(parsed.date),
    from,
    to,
    merchant: typeof parsed.merchant === 'string' ? parsed.merchant.trim() || null : null,
  };
}

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }
  | { file_data: { mime_type: string; file_uri: string } };

type GeminiResponse = {
  error?: { message?: string };
  promptFeedback?: { blockReason?: string };
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string }[] };
  }[];
};

async function uploadFileToGemini(input: {
  apiKey: string;
  mimeType: string;
  bytes: ArrayBuffer;
}): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(input.apiKey)}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'raw',
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Header-Content-Length': String(input.bytes.byteLength),
        'X-Goog-Upload-Header-Content-Type': input.mimeType,
        'Content-Type': input.mimeType,
      },
      body: input.bytes,
    }
  );

  const payload = (await response.json().catch(() => null)) as {
    file?: { uri?: string; name?: string };
    error?: { message?: string };
  } | null;

  if (!response.ok || !payload?.file?.uri) {
    throw new Error(payload?.error?.message || `Gemini file upload failed (${response.status})`);
  }
  return payload.file.uri;
}

async function generateExtraction(input: {
  apiKey: string;
  model: string;
  parts: GeminiPart[];
}): Promise<{ ok: true; text: string } | { ok: false; error: string; retryModel: boolean }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: input.parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }),
  });

  const payload = (await response.json().catch(() => null)) as GeminiResponse | null;

  if (!response.ok) {
    const message = payload?.error?.message || `Gemini request failed (${response.status})`;
    const retryModel =
      response.status === 404 || /no longer available|not found/i.test(message);
    return { ok: false, error: message, retryModel };
  }

  if (payload?.promptFeedback?.blockReason) {
    return {
      ok: false,
      error: `Gemini blocked the receipt (${payload.promptFeedback.blockReason})`,
      retryModel: false,
    };
  }

  const candidate = payload?.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) {
    const reason = candidate?.finishReason || 'empty';
    return {
      ok: false,
      error: `Gemini returned no text (${reason})`,
      retryModel: reason === 'SAFETY' ? false : true,
    };
  }

  return { ok: true, text };
}

export async function extractReceiptWithGemini(input: {
  apiKey: string;
  model?: string;
  mimeType: string;
  bytes: ArrayBuffer;
}): Promise<ReceiptExtraction> {
  const preferred = (input.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const models = [preferred, ...FALLBACK_MODELS.filter((m) => m !== preferred)];
  const mimeType = sniffReceiptMime(input.bytes, input.mimeType);
  const isPdf = mimeType === 'application/pdf';

  let lastError = 'Gemini request failed';

  // PDFs: prefer Files API (more reliable than huge inline base64). Images: inline first.
  let fileUri: string | null = null;
  if (isPdf) {
    try {
      fileUri = await uploadFileToGemini({
        apiKey: input.apiKey,
        mimeType,
        bytes: input.bytes,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Gemini PDF upload failed';
      // Fall through to inline attempt.
    }
  }

  const buildParts = (): GeminiPart[] => {
    if (fileUri) {
      return [
        { file_data: { mime_type: mimeType, file_uri: fileUri } },
        { text: EXTRACT_PROMPT },
      ];
    }
    return [
      { inline_data: { mime_type: mimeType, data: arrayBufferToBase64(input.bytes) } },
      { text: EXTRACT_PROMPT },
    ];
  };

  for (const model of models) {
    let result = await generateExtraction({
      apiKey: input.apiKey,
      model,
      parts: buildParts(),
    });

    // If file upload path failed earlier and inline also fails for PDF, stop with clear error.
    if (!result.ok) {
      lastError = result.error;
      if (result.retryModel) continue;
      // Non-retryable for this model; try next model anyway for SAFETY/empty occasionally.
      if (/no longer available|not found/i.test(result.error)) continue;
      continue;
    }

    try {
      return parseExtraction(result.text);
    } catch {
      lastError = 'Gemini returned unparseable extraction';
    }
  }

  // Last resort for PDF: if Files API wasn't used, try it now then generate once.
  if (isPdf && !fileUri) {
    try {
      fileUri = await uploadFileToGemini({
        apiKey: input.apiKey,
        mimeType,
        bytes: input.bytes,
      });
      const result = await generateExtraction({
        apiKey: input.apiKey,
        model: preferred,
        parts: [
          { file_data: { mime_type: mimeType, file_uri: fileUri } },
          { text: EXTRACT_PROMPT },
        ],
      });
      if (result.ok) return parseExtraction(result.text);
      lastError = result.error;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }

  throw new Error(lastError);
}
