# Wardrobe

Personal wardrobe management app — calendar, item manager, and AI style chat.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS (ES modules), GitHub Pages |
| Database | Supabase (PostgreSQL) |
| AI proxy | Cloudflare Worker |
| AI model | Claude Sonnet 4.6 (Anthropic API) |
| Weather | Open-Meteo (free, no key needed) |
| CI/CD | GitHub Actions |

---

## Features

### Calendar
Three-week view (past / current / next week) showing colour swatches for each day's outfit. Days with logged items show split swatches for patterned items. Clicking a day opens a detail panel with item thumbnails, weather, and an "Ask AI" shortcut. The "Plan week with AI" button opens an editable prompt that sends your wear history and weather forecast to Claude to generate outfit suggestions.

### Wardrobe manager
Grid of all items filterable by brand, category, season, and colour. Items with a `image_url` show a product photo; others show a colour swatch. Multi-colour/patterned items show a split swatch and pattern label (gingham, plaid, dot, etc.). Clicking an item opens the style chat with a pre-filled question about that item.

### Style chat
Conversational AI stylist powered by Claude Sonnet 4.6. Supports:
- **Outfit Q&A** — "What goes with my navy chinos?"
- **Outfit planning** — "Plan my three office days this week" (fetches weather + wear history automatically)
- **Outfit logging** — "I wore my grey shirt and black trousers today" (writes to `wear_log`, updates calendar)
- **Mixed intent** — "I'm wearing my olive polo today — should I tuck it in?" (logs AND answers)
- **Photo upload** — attach a photo of an item to ask "Would this work with my wardrobe?"
- **Memory** — preferences and feedback are automatically saved to Supabase and prepended to every future request

### Persistent memory
Expressed preferences, item notes, and styling feedback are extracted after each conversation and saved to the `ai_analysis` table. Claude reads these at the start of every session. Use phrases like "remember", "I prefer", "avoid", "save this" to explicitly save preferences. Memory also captures implicit patterns from outfit planning and photo sessions automatically.

---

## Database schema (Supabase)

| Table | Purpose |
|---|---|
| `items` | All wardrobe items with colour, category, seasons, occasions, CVD flags, image URLs |
| `wear_log` | Records of items worn on specific dates (also used for planned outfits) |
| `outfits` | Named saved outfits |
| `outfit_items` | Junction table linking outfits to items |
| `ai_analysis` | Stores the user preferences JSON (single row, `type: "user_preferences"`) |

---

## File structure

```
wardrobe/
├── index.html                        # App shell + navigation
├── css/
│   └── style.css                     # All styles, dark mode included
├── js/
│   ├── app.js                        # View router + bootstrap
│   ├── config.js                     # Supabase URL, anon key, worker URL ← edit this
│   ├── api.js                        # All data access (Supabase, Worker, Weather)
│   ├── calendar.js                   # Calendar view
│   ├── wardrobe.js                   # Item manager + swatch/image rendering
│   └── chat.js                       # AI chat — routing, logging, memory, photo
├── data/
│   ├── colours.json                  # Colour name → hex map (hand-maintained)
│   └── style-index.json              # Auto-generated nightly — do not edit manually
├── cloudflare-worker/
│   ├── worker.js                     # Request routing + Anthropic API proxy
│   ├── prompts.js                    # All system prompts + context builders
│   └── wrangler.toml                 # Worker config
└── .github/workflows/
    ├── deploy.yml                    # Push to main → GitHub Pages deploy
    └── rebuild-index.yml             # Nightly: fetch items + compute tonal tags → style-index.json
```

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
  weather: {
    latitude: 45.4215,   // Ottawa — change if needed
    longitude: -75.6972,
    city: 'Ottawa',
  },
};
```

### 3. Deploy the Cloudflare Worker

```bash
cd cloudflare-worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put ANTHROPIC_API_KEY   # paste your Anthropic key when prompted
```

Copy the worker URL from the deploy output and paste it into `js/config.js` as `worker.url`.

### 4. Add GitHub Secrets

Repo → Settings → Secrets and variables → Actions → New repository secret:

- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_ANON_KEY` — your Supabase anon key

### 5. Enable GitHub Pages

Repo → Settings → Pages → Source: **GitHub Actions**

### 6. Push to `main`

The deploy workflow triggers automatically. Your site will be live at `https://YOURUSERNAME.github.io/wardrobe/` within ~60 seconds.

### 7. Seed the style index

Actions → "Rebuild style index" → Run workflow. This fetches all items from Supabase, computes tonal tags (warm/cool/neutral) from hex codes, and writes `data/style-index.json`. The workflow runs nightly at 1am ET automatically after this.

### 8. Set up Supabase RLS policies

Run these in the Supabase SQL Editor:

```sql
-- wear_log
CREATE POLICY "Allow anon read"   ON public.wear_log FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert" ON public.wear_log FOR INSERT TO anon WITH CHECK (true);

-- ai_analysis (preferences)
ALTER TABLE public.ai_analysis ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE public.ai_analysis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon read"   ON public.ai_analysis FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert" ON public.ai_analysis FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update" ON public.ai_analysis FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Seed the preferences row
INSERT INTO public.ai_analysis (item_id, analysis)
VALUES (NULL, '{
  "type": "user_preferences",
  "style_notes": "", "fit_preferences": "", "colour_preferences": "",
  "avoid": [], "feedback": [], "item_notes": {}, "reminders": "", "updated_at": ""
}'::jsonb);

-- outfits + outfit_items
CREATE POLICY "Allow anon read"   ON public.outfits FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert" ON public.outfits FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon read"   ON public.outfit_items FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert" ON public.outfit_items FOR INSERT TO anon WITH CHECK (true);
```

---

## Adding items

### Via AI chat (recommended for new purchases)
Paste a product URL and describe what you bought:
> "I just bought this jacket — add it to my wardrobe: https://shop.lululemon.com/..."

Claude returns a `INSERT INTO items ...` SQL statement. Review it, run it in the Supabase SQL editor, then trigger "Rebuild style index" to update the AI's context.

### Manually via Supabase
Add rows directly to the `items` table. Key fields:
- `color` — must match a key in `data/colours.json` for swatches to render correctly
- `image_url` — for Lululemon, use `https://images.lululemon.com/is/image/lululemon/PRODUCT_CODE`
- `seasons` — array, e.g. `{spring,fall,winter}`
- `occasions` — array, e.g. `{work,casual}`

---

## Style chat tips

**Logging outfits:**
> "I wore my grey confetti dot shirt and black trousers yesterday"
> "Log Tuesday: navy dress shirt, cream chinos, KNX sneakers"

**Planning:**
> "Plan outfits for my three office days next week. Monday is most formal, Friday is casual. Check the Ottawa weather."

**Mixed (log + question):**
> "I'm wearing my olive polo today — should I tuck it in?"

**Saving preferences explicitly:**
> "Remember I prefer to wear the Airing Easy shirt untucked"
> "Save this: avoid pairing two textured pieces in the same outfit"
> "Note that I find the slim-fit trousers more versatile than relaxed"

**Photo upload:**
Tap the camera icon, attach a photo of an item, and ask:
> "Would this jacket work with my wardrobe?"
> "Is this colour palette a good fit for my existing clothes?"

**Reviewing saved preferences:**
> "What are my current style preferences and what have you learned about my taste?"

---

## Architecture

```
Browser (GitHub Pages)
    │
    ├── Supabase (direct)
    │   items, wear_log, outfits, ai_analysis
    │
    └── Cloudflare Worker
            │
            ├── Claude Sonnet 4.6 (Anthropic API)
            │   qa / plan / log / photo / memory / ingest
            │
            └── Open-Meteo (weather, free)

GitHub Actions
    ├── deploy.yml          push to main → GitHub Pages
    └── rebuild-index.yml   nightly → style-index.json with tonal tags
```

### Request types and token budgets

| Type | Trigger | Context sent | ~Input tokens |
|---|---|---|---|
| `qa` | General questions | Style index + preferences | ~1,500 |
| `plan` | Week planning | Style index + preferences + wear history + weather | ~2,500 |
| `log` | Outfit logging | Style index only | ~1,200 |
| `log+qa` | "I'm wearing X today — should I...?" | Log first, then qa | ~1,500 |
| `photo` | Camera icon used | Style index + preferences + image | ~2,000+ |
| `memory` | After qa/plan/photo | Current preferences + conversation | ~800 |
| `ingest` | Adding new item | Colour map + URL/description | ~600 |

### Tonal enrichment
The nightly rebuild computes a tonal tag for each item from its hex colour using HSL:
- **warm** — reds, oranges, warm browns (hue 0–60° or 320–360°)
- **cool** — blues, blue-greens, blue-purples (hue 150–270°)
- **cool-neutral** — yellow-greens (hue 60–150°)
- **warm-neutral** — red-purples (hue 270–320°)
- **neutral** — low saturation colours (greys, creams, blacks, whites)

Claude uses these tags to suggest tonally harmonious outfits.
