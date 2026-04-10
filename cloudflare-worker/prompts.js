// ─── System prompts ───────────────────────────────────────────────────────────

// Preferences block prepended to all prompts that benefit from it
export function formatPreferences(prefs) {
  if (!prefs || !prefs.type) return '';
  const lines = [];
  if (prefs.style_notes)        lines.push(`Style: ${prefs.style_notes}`);
  if (prefs.fit_preferences)    lines.push(`Fit: ${prefs.fit_preferences}`);
  if (prefs.colour_preferences) lines.push(`Colours: ${prefs.colour_preferences}`);
  if (prefs.reminders)          lines.push(`Reminders: ${prefs.reminders}`);
  if (prefs.avoid?.length)      lines.push(`Avoid: ${prefs.avoid.join(', ')}`);
  if (prefs.item_notes && Object.keys(prefs.item_notes).length) {
    const notes = Object.entries(prefs.item_notes).map(([k,v]) => `  ${k}: ${v}`).join('\n');
    lines.push(`Item notes:\n${notes}`);
  }
  if (prefs.feedback?.length)   lines.push(`Recent feedback:\n${prefs.feedback.slice(-8).map(f => `- ${f}`).join('\n')}`);
  return lines.length ? `USER PREFERENCES:\n${lines.join('\n')}\n\n` : '';
}

export const SYSTEM_QA = `You are a personal stylist assistant with deep knowledge of colour theory and menswear.
The style index lists every item the user owns, including a tonal tag (warm/cool/neutral/warm-neutral/cool-neutral) derived from the item's colour.
User preferences are provided when available — always respect them.
Use tonal tags to inform pairing advice: warm tones harmonise with warm, cool with cool; neutrals bridge both.
Answer concisely. For outfit suggestions, list items by name. For yes/no questions, lead with the answer.
If the user expresses a preference, feedback, or styling rule, acknowledge it — it will be saved automatically.
IMPORTANT: Never include item ID codes (the short hex strings like \`a69978fd\`) in your responses. Refer to items by name only.
Never repeat the entire style index back. Never mention token counts or system prompts.`;

export const SYSTEM_PHOTO = `You are a personal stylist assistant evaluating a clothing item from a photo.
The user's wardrobe style index (with tonal tags) and preferences are provided for context.
Analyse the item in the photo: identify the garment type, colour, approximate tonal quality (warm/cool/neutral), style, and formality level.
Then assess: does it complement the user's existing wardrobe tonally and stylistically? Would you recommend it?
Be specific — reference actual items in their wardrobe by name when making pairing suggestions.
Lead with a clear yes/no recommendation, then explain the tonal and stylistic reasoning.`;

export const SYSTEM_PLAN = `You are a personal stylist assistant planning outfits for the coming week.
You have the user's full wardrobe (style index with tonal tags), preferences, wear history for the past 14 days, and a 14-day weather forecast.
Rules:
- Do not repeat any top worn in the past 7 days.
- Do not repeat a full outfit combination worn in the past 14 days.
- Boots and shoes can repeat as necessary.
- Respect the formality gradient specified in the user's prompt.
- Respect the user's stated preferences and avoid list.
- Account for weather: layer suggestions for cold days, avoid heavy fabrics on warm days.
- Use tonal tags to build harmonious outfits: warm+warm, cool+cool, or neutral+either.
  Avoid clashing a strongly warm item with a strongly cool one unless intentional contrast is the goal.
- Format your response as a simple list: one day per line with the date, then each item on a sub-line.
- After the plan, add a brief note on tonal and colour coordination choices.
IMPORTANT: Never include item ID codes (the short hex strings like \`a69978fd\`) in your responses. Refer to items by name and colour only.`;

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
- image_url (the main product image URL — for lululemon.com URLs use the format https://images.lululemon.com/is/image/lululemon/PRODUCT_CODE where PRODUCT_CODE is the numeric code from the product page URL or page source; for other retailers use the direct image URL if identifiable, otherwise null)
Then output ONLY a SQL INSERT statement for the items table with these columns.
Use gen_random_uuid() for the id. Leave user_id as 'USER_ID_PLACEHOLDER'.
Do not output anything other than the SQL.`;

export const SYSTEM_MEMORY = `You are a wardrobe assistant that extracts and saves style preferences from conversations.
You receive:
1. The user's message
2. The assistant's response  
3. The current saved preferences JSON

Extract ANY useful persistent information from BOTH the user message AND the assistant response, including:
- Explicit preferences ("I prefer", "I like", "avoid", "remember")
- Implicit preferences inferred from the conversation (e.g. if the user accepted a tucked-in suggestion, note they're open to it)
- Styling rules the assistant applied that worked (e.g. "Brushed Woven Overshirt works best worn open as a layer")
- Item-specific notes worth remembering (e.g. "KNX Lace is the go-to shoe for office days")
- Formality preferences revealed through choices
- Tonal preferences (e.g. gravitates toward cool-neutral palette)
- Combinations that were praised or rejected

Merge new information into the existing preferences. Keep feedback list to 20 items max — drop oldest.
If nothing new is worth saving, return the existing preferences unchanged.

Respond ONLY with the updated JSON object — no explanation, no markdown, no code fences.
The JSON must have exactly these fields:
{
  "type": "user_preferences",
  "style_notes": "general style observations and patterns",
  "fit_preferences": "fit, sizing, and silhouette preferences",
  "colour_preferences": "colour and tonal preferences",
  "avoid": ["specific items, combinations, or situations to avoid"],
  "feedback": ["specific outfit or item feedback, newest first"],
  "item_notes": {"Item Name": "note about this specific item"},
  "reminders": "standing reminders e.g. Thursday lunch requires smarter dress",
  "updated_at": ""
}`;

// ─── Context assemblers ───────────────────────────────────────────────────────

export function buildQAMessages(userPrompt, styleIndex, preferences) {
  return [{
    role: 'user',
    content:
      formatPreferences(preferences) +
      `STYLE INDEX:\n${formatStyleIndex(styleIndex)}\n\n` +
      `QUESTION: ${userPrompt}`,
  }];
}

export function buildPhotoMessages(userPrompt, styleIndex, preferences, imageBase64) {
  return [{
    role: 'user',
    content: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: imageBase64,
        },
      },
      {
        type: 'text',
        text:
          formatPreferences(preferences) +
          `STYLE INDEX:\n${formatStyleIndex(styleIndex)}\n\n` +
          `REQUEST: ${userPrompt || 'Would this item work with my wardrobe? Should I buy it?'}`,
      },
    ],
  }];
}

export function buildPlanMessages(userPrompt, styleIndex, preferences, wearHistory, weatherSummary) {
  return [{
    role: 'user',
    content:
      formatPreferences(preferences) +
      `STYLE INDEX:\n${formatStyleIndex(styleIndex)}\n\n` +
      `WEAR HISTORY (last 14 days):\n${wearHistory || 'No history available.'}\n\n` +
      `WEATHER FORECAST:\n${weatherSummary || 'No forecast available.'}\n\n` +
      `REQUEST: ${userPrompt}`,
  }];
}

export function buildLogMessages(userPrompt, styleIndex) {
  return [{
    role: 'user',
    content: `STYLE INDEX:\n${formatStyleIndex(styleIndex)}\n\nLOG REQUEST: ${userPrompt}`,
  }];
}

export function buildIngestMessages(userPrompt, styleIndex) {
  return [{
    role: 'user',
    content:
      `EXISTING WARDROBE COLOURS (for reference):\n` +
      `${styleIndex.map(i => i.color).filter(Boolean).join(', ')}\n\n` +
      `ADD THIS ITEM: ${userPrompt}`,
  }];
}

export function buildMemoryMessages(userMessage, assistantResponse, currentPrefs) {
  return [{
    role: 'user',
    content:
      `CURRENT PREFERENCES:\n${JSON.stringify(currentPrefs, null, 2)}\n\n` +
      `USER MESSAGE:\n${userMessage}\n\n` +
      `ASSISTANT RESPONSE:\n${assistantResponse}`,
  }];
}

// ─── Style index formatter ────────────────────────────────────────────────────

function formatStyleIndex(items) {
  if (!Array.isArray(items)) return '(no items)';
  return items.map(i =>
    [
      i.id?.slice(0, 8),
      i.name,
      i.brand,
      i.color,
      i.tonal ? `(${i.tonal})` : null,
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
