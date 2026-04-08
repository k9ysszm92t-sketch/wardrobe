import CONFIG from './config.js';

// ─── Supabase client ──────────────────────────────────────────────────────────

const sb = {
  url: CONFIG.supabase.url,
  key: CONFIG.supabase.anonKey,

  async query(table, params = '') {
    const res = await fetch(`${this.url}/rest/v1/${table}${params}`, {
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`Supabase error: ${res.status} on ${table}`);
    return res.json();
  },

  async insert(table, body) {
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Supabase insert error: ${res.status}`);
    return res.json();
  },

  async upsert(table, body) {
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Supabase upsert error: ${res.status}`);
    return res.json();
  },

  async update(table, params, body) {
    const res = await fetch(`${this.url}/rest/v1/${table}${params}`, {
      method: 'PATCH',
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Supabase update error: ${res.status}`);
    return res.json();
  },

  async delete(table, params = '') {
    const res = await fetch(`${this.url}/rest/v1/${table}${params}`, {
      method: 'DELETE',
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase delete error: ${res.status}`);
    return true;
  },
};

// ─── Items ────────────────────────────────────────────────────────────────────

export async function getItems() {
  return sb.query(
    'items',
    '?select=id,brand,name,category,type,color,fit,size,seasons,occasions,layerOnly,cvd,cvdNote,notes,image_url,last_worn&order=category.asc,brand.asc,name.asc'
  );
}

export async function getItemById(id) {
  const rows = await sb.query('items', `?id=eq.${id}&select=*`);
  return rows[0] ?? null;
}

// ─── Wear log ─────────────────────────────────────────────────────────────────

export async function getWearLog(daysBack = 14, daysAhead = 14) {
  const from = dateStr(offsetDate(-daysBack));
  const to   = dateStr(offsetDate(daysAhead));
  return sb.query(
    'wear_log',
    `?select=id,date,item_id,items(id,name,brand,color,category,type)&date=gte.${from}&date=lte.${to}&order=date.asc`
  );
}

export async function logWorn(itemId, date) {
  return sb.insert('wear_log', { item_id: itemId, date });
}

export async function deleteWearLogEntry(id) {
  return sb.delete('wear_log', `?id=eq.${id}`);
}

export async function logOutfit(itemIds, date) {
  const rows = itemIds.map(item_id => ({ item_id, date }));
  return sb.insert('wear_log', rows);
}

// ─── Outfits ──────────────────────────────────────────────────────────────────

export async function saveOutfit(name, itemIds, notes = '') {
  const [outfit] = await sb.insert('outfits', { name, notes });
  const links = itemIds.map(item_id => ({ outfit_id: outfit.id, item_id }));
  await sb.insert('outfit_items', links);
  return outfit;
}

// ─── Style index ──────────────────────────────────────────────────────────────

let _styleIndexCache = null;

export async function getStyleIndex() {
  if (_styleIndexCache) return _styleIndexCache;
  const res = await fetch(CONFIG.styleIndex.path + '?v=' + Date.now());
  if (!res.ok) throw new Error('Style index not found — has the nightly build run?');
  _styleIndexCache = await res.json();
  return _styleIndexCache;
}

export function invalidateStyleIndex() {
  _styleIndexCache = null;
}

// ─── Preferences (ai_analysis table) ─────────────────────────────────────────

let _prefsCache = null;

export async function getPreferences() {
  if (_prefsCache) return _prefsCache;
  try {
    const rows = await sb.query(
      'ai_analysis',
      `?analysis->>type=eq.user_preferences&select=id,analysis&limit=1`
    );
    if (rows.length > 0) {
      _prefsCache = rows[0].analysis;
    } else {
      _prefsCache = defaultPreferences();
    }
  } catch {
    _prefsCache = defaultPreferences();
  }
  return _prefsCache;
}

export async function savePreferences(prefs) {
  prefs.updated_at = new Date().toISOString();
  _prefsCache = prefs;
  try {
    const existing = await sb.query(
      'ai_analysis',
      `?analysis->>type=eq.user_preferences&select=id&limit=1`
    );
    if (existing.length > 0) {
      await sb.update(
        'ai_analysis',
        `?id=eq.${existing[0].id}`,
        { analysis: prefs }
      );
    } else {
      await sb.insert('ai_analysis', { item_id: null, analysis: prefs });
    }
  } catch (e) {
    console.error('Failed to save preferences:', e.message);
  }
}

export function invalidatePreferences() {
  _prefsCache = null;
}

function defaultPreferences() {
  return {
    type: 'user_preferences',
    style_notes: '',
    fit_preferences: '',
    colour_preferences: '',
    avoid: [],
    feedback: [],
    reminders: '',
    updated_at: '',
  };
}

// ─── AI via Cloudflare Worker ─────────────────────────────────────────────────

export async function askClaude({ type, userPrompt, extra = {}, onChunk, imageBase64 = null }) {
  const styleIndex  = await getStyleIndex();
  const preferences = await getPreferences();

  const payload = {
    type,
    userPrompt,
    styleIndex,
    preferences,
    imageBase64,
    ...extra,
  };

  const res = await fetch(CONFIG.worker.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Worker error: ${res.status}`);

  // Log type returns plain JSON (non-streaming)
  if (type === 'log') {
    return await res.text();
  }

  // All other types stream SSE
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let full   = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json || json === '[DONE]') continue;
      try {
        const parsed = JSON.parse(json);
        if (parsed.type === 'content_block_delta' &&
            parsed.delta?.type === 'text_delta') {
          full += parsed.delta.text;
          if (onChunk) onChunk(parsed.delta.text, full);
        }
      } catch {
        // ignore malformed lines
      }
    }
  }

  return full;
}

// ─── Weather ──────────────────────────────────────────────────────────────────

export async function getWeatherForecast() {
  const { latitude, longitude, city } = CONFIG.weather;
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode` +
    `&timezone=America%2FToronto&forecast_days=14`;

  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather fetch failed');
  const data = await res.json();

  return data.daily.time.map((date, i) => ({
    date,
    city,
    high:  Math.round(data.daily.temperature_2m_max[i]),
    low:   Math.round(data.daily.temperature_2m_min[i]),
    rain:  data.daily.precipitation_probability_max[i],
    code:  data.daily.weathercode[i],
    label: weatherLabel(data.daily.weathercode[i]),
  }));
}

// ─── Colour map ───────────────────────────────────────────────────────────────

let _colourMap = null;

export async function getColourMap() {
  if (_colourMap) return _colourMap;
  const res = await fetch('./data/colours.json');
  _colourMap = await res.json();
  return _colourMap;
}

export async function colourToHex(name) {
  if (!name) return '#888888';
  const map = await getColourMap();
  return map[name] ?? map[name.toLowerCase().trim()] ?? '#888888';
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function dateStr(d) {
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day   = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function offsetDate(days, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

export function groupByDate(wearLogRows) {
  return wearLogRows.reduce((acc, row) => {
    if (!acc[row.date]) acc[row.date] = [];
    acc[row.date].push(row);
    return acc;
  }, {});
}

function weatherLabel(code) {
  if (code === 0) return 'Clear';
  if (code <= 3)  return 'Partly cloudy';
  if (code <= 49) return 'Foggy';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  return 'Stormy';
}
