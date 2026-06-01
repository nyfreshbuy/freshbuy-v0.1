# Freshbuy App Setup

Freshbuy now has a safer PWA app shell for iPhone, iPad, and Android.

## Installable app

- User entry: `/user/index.html`
- Manifest: `/user/manifest.webmanifest`
- Offline fallback: `/user/offline.html`
- Service worker: `/user/service-worker.js`

After deployment, open the site on a phone and use "Add to Home Screen". On Android Chrome, the install prompt can also appear automatically.

## Required production settings

Set these in `backend/.env` or your hosting dashboard:

```env
FRONTEND_URL=https://www.nyfreshbuy.com
CORS_ORIGINS=https://nyfreshbuy.com,https://www.nyfreshbuy.com
GOOGLE_MAPS_BROWSER_KEY=your_browser_restricted_key
GOOGLE_MAPS_SERVER_KEY=your_server_key
```

The browser key must be restricted in Google Cloud to your production domains. The server key should stay private and only be used by backend routes.