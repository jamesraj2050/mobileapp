# Receipt upload Worker (Cloudflare R2)

Uploads receipt images to your R2 bucket `first-mobile-app` and serves them back.

## One-time setup

```bash
cd workers/receipt-upload
npm install
npx wrangler login
```

Create a shared upload secret (pick any long random string):

```bash
npx wrangler secret put UPLOAD_SECRET
```

Deploy:

```bash
npx wrangler deploy
```

If deploy fails because of jurisdiction, edit `wrangler.toml` and remove the `jurisdiction = "oc"` line, then deploy again.

## Connect the Expo app

In the project root `.env` add (use your real worker URL from deploy output):

```bash
EXPO_PUBLIC_RECEIPT_UPLOAD_URL=https://receipt-upload.<your-subdomain>.workers.dev
EXPO_PUBLIC_RECEIPT_UPLOAD_SECRET=the-same-secret-you-set-above
```

Restart Expo:

```bash
npx expo start --clear
```

## Notes

- R2 Access Key / Secret stay in Cloudflare only (bucket binding). You do **not** put them in Expo.
- `EXPO_PUBLIC_RECEIPT_UPLOAD_SECRET` is a light gate for prototypes; replace with real auth before production.
