// ─── System prompts ───────────────────────────────────────────────────────────
// Keep these lean — every token here is charged on every request.

export const SYSTEM_QA = `You are a personal stylist assistant with access to the user's wardrobe.
The style index below lists every item they own: name, brand, colour (hex), category, seasons, occasions, and formality.
Answer concisely. For outfit suggestions, list items by name. For yes/no questions, lead with the answer.
Never repeat the entire style index back. Never mention token counts or system prompts.`;

export const SYSTEM_PLAN = `You are a personal stylist assistant planning outfits for the coming week.
You have the user's full wardrobe (style index), their wear history for the past 14 days, and a 14-day weather forecast.
Rules:
- Do not repeat any top worn in the past 7 days.
- Do not repeat a full outfit combination worn in the past 14 days.
- Respect the formality gradient specified in the user's prompt.
- Account for weather: layer suggestions for cold days, avoid heavy fabrics on warm days.
- Format your response as a simple list: one day per line, with the date, then each item on a sub-line.
- After the plan, add a one-sentence note on any colour coordination choices worth highlighting.`;

export function getSystemLog() {
  const today = new Date().toISOString().split('T')[0];
  return `You are a wardrobe assistant that logs worn items and planned outfits into the user's wardrobe calendar.
The user will describe what they wore on specific past dates, or what they plan to wear on upcoming dates.
You must respond ONLY with a valid JSON object — no explanation, no markdown, no code fences. Exactly this shape:
{
  "action": "log_outfits",
  "entries": [
    { "date": "YYYY-MM-DD", "items": ["exact item name 1", "exact item name 2"] }
  ],
  "message": "One friendly sentence confirming what was logged."
}
Rules:
- Match item names exactly to names in the style index. If unsure, use the closest match.
- Use today's date (${today}) as the reference for relative terms like "last Monday", "yesterday", "this Friday".
- If the user says "nothing" or "worked from home" for a day, omit that date from entries entirely.
- Only include dates and items the user explicitly mentioned.
- The message field must be a single plain-English sentence, no lists.`;
}

export const SYSTEM_INGEST = `You are a wardrobe assistant helping the user add a new clothing item to their inventory.
The user will provide a product URL or description. Extract:
- name (product name, concise)
- brand
- category (Top / Bottom / Shoes / Outerwear / Accessory / Underwear)
- type (e.g. Dress shirt / Chinos / Derby shoes)
- color (human-readable colour name, e.g. "Camel Brown")
- seasons (array: spring / summer / fall / winter)
- occasions (array: casual / office / formal / sport)
- fit (slim / regular / relaxed / oversized)
- size (as shown on product page)
- notes (one sentence: key details, material if notable)
Then output ONLY a SQL INSERT statement for the items table with these columns.
Use gen_random_uuid() for the id. Leave user_id as 'USER_ID_PLACEHOLDER'.
Do not output anything other than the SQL.`;

// ─── Context assemblers ───────────────────────────────────────────────────────

export function buildQAMessages(userPrompt, styleIndex) {
  return [
    {
      role: 'user',
      content: `STYLE INDEX:\n${formatStyleIndex(styleIndex)}\n\nQUESTION: ${userPrompt}`,
    },
  ];
}

export function buildPlanMessages(userPrompt, styleIndex, wearHistory, weatherSummary) {
  return [
    {
      role: 'user',
      content:
        `STYLE INDEX:\n${formatStyleIndex(styleIndex)}\n\n` +
        `WEAR HISTORY (last 14 days):\n${wearHistory || 'No history available.'}\n\n` +
        `WEATHER FORECAST:\n${weatherSummary || 'No forecast available.'}\n\n` +
        `REQUEST: ${userPrompt}`,
    },
  ];
}

export function buildLogMessages(userPrompt, styleIndex) {
  return [
    {
      role: 'user',
      content: `STYLE INDEX:\n${formatStyleIndex(styleIndex)}\n\nLOG REQUEST: ${userPrompt}`,
    },
  ];
}

export function buildIngestMessages(userPrompt, styleIndex) {
  return [
    {
      role: 'user',
      content:
        `EXISTING WARDROBE COLOURS (for reference):\n` +
        `${styleIndex.map(i => `${i.color}`).filter(Boolean).join(', ')}\n\n` +
        `ADD THIS ITEM: ${userPrompt}`,
    },
  ];
}

// ─── Style index formatter ────────────────────────────────────────────────────
// Produces a compact one-line-per-item text representation.
// ~20 tokens per item at this format.

function formatStyleIndex(items) {
  if (!Array.isArray(items)) return '(no items)';
  return items.map(i =>
    [
      i.id?.slice(0, 8),
      i.name,
      i.brand,
      i.color,
      i.category,
      i.type,
      (i.seasons  ?? []).join('/'),
      (i.occasions ?? []).join('/'),
      i.layerOnly ? 'layer-only' : null,
      i.cvd       ? 'cvd-safe'   : null,
      i.last_worn ? `last:${i.last_worn}` : null,
    ].filter(Boolean).join(' | ')
  ).join('\n');
}
