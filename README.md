# Wardrobe

Personal wardrobe management app — calendar, item manager, and AI style chat.

## Stack

- **Frontend**: Vanilla JS (ES modules), hosted on GitHub Pages
- **Database**: Supabase (items, wear_log, outfits, ai_analysis)
- **AI proxy**: Cloudflare Worker (adds Anthropic API key, assembles prompts)
- **Weather**: Open-Meteo (free, no key needed)
- **CI**: GitHub Actions (deploy + nightly style index rebuild)

---

## Setup

### 1. Fork / clone this repo

### 2. Configure `js/config.js`

```js
const CONFIG = {
  supabase: {
    url: 'https://YOUR_PROJECT.supabase.co',
    anonKey: 'YOUR_SUPABASE_ANON_KEY',
  },
  worker: {
    url: 'https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev',
  },
  // Ottawa coords — change if needed
  weather: { latitude: 45.4215, longitude: -75.6972, city: 'Ottawa' },
};
```

### 3. Deploy the Cloudflare Worker

```bash
cd cloudflare-worker
npm install -g wrangler
wrangler login
wrangler deploy
wrangler secret put ANTHROPIC_API_KEY   # paste your key when prompted
```

Update `ALLOWED_ORIGIN` in `worker.js` to your GitHub Pages URL.

### 4. Add GitHub Secrets (for the nightly style index rebuild)

In your repo → Settings → Secrets and variables → Actions:

- `SUPABASE_URL` — your project URL
- `SUPABASE_ANON_KEY` — your anon key

### 5. Enable GitHub Pages

Repo → Settings → Pages → Source: **GitHub Actions**

### 6. Push to `main` — the deploy action will publish the site

### 7. Trigger the first style index build manually

Actions → "Rebuild style index" → Run workflow

---

## Adding a new item via AI chat

In the Style chat tab, paste a product URL and say:

> I just bought this jacket. Add it to my wardrobe inventory.
> https://shop.example.com/product-page

Claude will return a SQL INSERT statement. Review it, then run it in the Supabase SQL editor.
After adding, re-run the "Rebuild style index" workflow (or wait for the nightly build).

---

## File structure

```
wardrobe/
├── index.html                   # App shell
├── css/style.css                # All styles
├── js/
│   ├── app.js                   # View router / bootstrap
│   ├── config.js                # Your keys and settings ← edit this
│   ├── api.js                   # All data access (Supabase + Worker + Weather)
│   ├── calendar.js              # Calendar view
│   ├── wardrobe.js              # Item manager view
│   └── chat.js                  # AI chat view
├── data/
│   ├── colours.json             # Colour name → hex map
│   └── style-index.json         # Auto-generated nightly — do not edit
├── cloudflare-worker/
│   ├── worker.js                # Route, assemble context, proxy to Claude
│   ├── prompts.js               # System prompts and context builders
│   └── wrangler.toml            # Worker config
└── .github/workflows/
    ├── deploy.yml               # Push → GitHub Pages
    └── rebuild-index.yml        # Nightly style index rebuild
```
