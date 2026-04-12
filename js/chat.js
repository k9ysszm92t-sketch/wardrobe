import { askClaude, getWearLog, getWeatherForecast, getItems, getPreferences,
         savePreferences, logOutfit, groupByDate } from './api.js';

const messagesEl   = document.getElementById('chat-messages');
const inputEl      = document.getElementById('chat-input');
const sendBtn      = document.getElementById('btn-chat-send');
const photoBtn     = document.getElementById('btn-photo-upload');
const photoInput   = document.getElementById('photo-input');
const photoPreview = document.getElementById('photo-preview');

let pendingImageBase64  = null;
let conversationHistory = [];  // { role: 'user'|'assistant', content: string }[]

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initChat() {
  sendBtn.addEventListener('click', () => handleSend());

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  photoBtn.addEventListener('click', () => photoInput.click());

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;
    pendingImageBase64 = await fileToBase64(file);
    photoPreview.innerHTML = `
      <div style="position:relative;display:inline-block;">
        <img src="data:image/jpeg;base64,${pendingImageBase64}"
             style="height:64px;width:64px;object-fit:cover;border-radius:8px;border:0.5px solid var(--border);">
        <button id="btn-remove-photo" style="position:absolute;top:-6px;right:-6px;
          width:18px;height:18px;border-radius:50%;border:none;background:var(--muted);
          color:white;font-size:11px;cursor:pointer;display:flex;align-items:center;
          justify-content:center;padding:0;">✕</button>
      </div>`;
    document.getElementById('btn-remove-photo').addEventListener('click', clearPhoto);
    inputEl.placeholder = 'Ask about this item — does it work with my wardrobe?';
    inputEl.focus();
    photoInput.value = '';
  });

  document.querySelectorAll('.quick-prompt').forEach(btn => {
    btn.addEventListener('click', () => sendQuickPrompt(btn.dataset.prompt));
  });

  document.getElementById('btn-new-conversation')
    ?.addEventListener('click', resetConversation);
}

export function sendQuickPrompt(text, type = 'qa', extra = {}) {
  inputEl.value = text;
  handleSend(type, extra);
}

function resetConversation() {
  conversationHistory = [];
  messagesEl.innerHTML = `<div class="chat-msg assistant">
    Ask me anything about your wardrobe — outfit advice, what to buy, or whether two items
    work together. You can also upload a photo of an item to ask if it would match your wardrobe.
  </div>`;
  inputEl.focus();
}

// ─── Send ─────────────────────────────────────────────────────────────────────

async function handleSend(type = 'qa', extra = {}) {
  const text     = inputEl.value.trim();
  const hasImage = !!pendingImageBase64;

  if (!text && !hasImage) return;

  const displayText = text || 'Would this item work with my wardrobe?';
  inputEl.value = '';
  setInputDisabled(true);

  appendUserMessage(displayText, pendingImageBase64);

  let resolvedType = type !== 'qa' ? type : detectType(text);
  if (hasImage) resolvedType = 'photo';

  const imageBase64 = pendingImageBase64;
  clearPhoto();

  // Fetch weather + wear history for plan requests
  let context = { ...extra };
  if (resolvedType === 'plan' && !context.wearHistory) {
    try {
      const [rawLog, weather] = await Promise.all([getWearLog(14, 14), getWeatherForecast()]);
      context.wearHistory    = buildWearHistory(rawLog);
      context.weatherSummary = buildWeatherSummary(weather);
    } catch (e) {
      console.warn('Could not fetch plan context:', e.message);
    }
  }

  const msgEl = appendMessage('assistant', '', true);

  try {
    if (resolvedType === 'log' || resolvedType === 'log+qa') {
      // ── Log path ──────────────────────────────────────────────────────────
      msgEl.textContent = 'Logging outfit...';
      const rawResponse = await askClaude({
        type: 'log',
        userPrompt: displayText,
        extra: { ...context, conversationHistory },
      });
      await handleLogResponse(rawResponse, msgEl);

      // Add to history so follow-up turns know what was logged
      conversationHistory.push({ role: 'user',      content: displayText });
      conversationHistory.push({ role: 'assistant', content: msgEl.textContent });

      // If mixed intent, also answer the question
      if (resolvedType === 'log+qa') {
        const qaMsg = appendMessage('assistant', '', true);
        const fullResponse = await askClaude({
          type: 'qa',
          userPrompt: displayText,
          extra: { ...context, conversationHistory },
          onChunk: (_chunk, full) => {
            updateMessage(qaMsg, full);
            qaMsg.classList.add('streaming');
            scrollToBottom();
          },
        });
        qaMsg.classList.remove('streaming');
        conversationHistory.push({ role: 'assistant', content: fullResponse });
        maybeUpdateMemory(displayText, fullResponse, 'qa');
      }

    } else {
      // ── Streaming path: qa / plan / photo / ingest ────────────────────────
      // Add user turn to history before sending
      conversationHistory.push({ role: 'user', content: displayText });

      const fullResponse = await askClaude({
        type: resolvedType,
        userPrompt: displayText,
        extra: { ...context, conversationHistory: conversationHistory.slice(0, -1) },
        imageBase64,
        onChunk: (_chunk, full) => {
          updateMessage(msgEl, full);
          msgEl.classList.add('streaming');
          scrollToBottom();
        },
      });
      msgEl.classList.remove('streaming');

      // Add assistant turn to history
      conversationHistory.push({ role: 'assistant', content: fullResponse });

      // Cap history at last 10 turns to control token growth
      if (conversationHistory.length > 10) {
        conversationHistory = conversationHistory.slice(-10);
      }

      maybeUpdateMemory(displayText, fullResponse, resolvedType);
    }

  } catch (e) {
    msgEl.classList.remove('streaming');
    msgEl.textContent = 'Sorry, something went wrong: ' + e.message;
    // Remove the failed user turn from history
    if (conversationHistory[conversationHistory.length - 1]?.role === 'user') {
      conversationHistory.pop();
    }
  }

  setInputDisabled(false);
  inputEl.placeholder = 'Ask about your wardrobe…';
  inputEl.focus();
  scrollToBottom();
}

// ─── Memory ───────────────────────────────────────────────────────────────────

const EXPLICIT_MEMORY_PHRASES = [
  'remember', 'save this', 'note that', 'prefer', "don't like", 'i like',
  'i love', 'i hate', 'always', 'never', 'avoid', 'favourite', 'favorite',
  'usually', 'tend to', 'i find', 'i feel', 'too formal', 'too casual',
  'works well', "doesn't work", 'great combination', 'not a fan',
  'works best', 'i think', 'in my opinion',
];

async function maybeUpdateMemory(userText, assistantResponse, requestType) {
  const lower = userText.toLowerCase();
  const alwaysCapture  = requestType === 'plan' || requestType === 'photo';
  const hasExplicit    = EXPLICIT_MEMORY_PHRASES.some(p => lower.includes(p));
  if (!alwaysCapture && !hasExplicit) return;

  try {
    const currentPrefs = await getPreferences();
    const raw = await askClaude({
      type: 'memory',
      userPrompt: 'Extract preferences',
      extra: { userMessage: userText, assistantResponse, currentPrefs },
    });
    const clean   = raw.replace(/```json|```/g, '').trim();
    const updated = JSON.parse(clean);
    if (updated.type === 'user_preferences') {
      await savePreferences(updated);
    }
  } catch (e) {
    console.warn('Memory update skipped:', e.message);
  }
}

// ─── Log response handler ─────────────────────────────────────────────────────

async function handleLogResponse(rawResponse, msgEl) {
  let parsed;
  try {
    const clean = rawResponse.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    updateMessage(msgEl, rawResponse);
    return;
  }

  if (parsed.action !== 'log_outfits' || !Array.isArray(parsed.entries)) {
    updateMessage(msgEl, parsed.message ?? rawResponse);
    return;
  }

  let allItems;
  try { allItems = await getItems(); }
  catch (e) { msgEl.textContent = 'Could not fetch wardrobe: ' + e.message; return; }

  const results = [];
  for (const entry of parsed.entries) {
    const itemIds = entry.items.map(name => findItem(allItems, name)?.id).filter(Boolean);
    if (itemIds.length === 0) {
      results.push(entry.date + ': no matches for "' + entry.items.join(', ') + '"');
      continue;
    }
    try {
      await logOutfit(itemIds, entry.date);
      const names = itemIds
        .map(id => allItems.find(i => i.id === id)?.name)
        .filter(Boolean).join(', ');
      results.push(entry.date + ': ' + names);
    } catch (e) {
      results.push(entry.date + ': failed — ' + e.message);
    }
  }

  const summary = results.length ? '\n\nLogged:\n' + results.join('\n') : '';
  updateMessage(msgEl, (parsed.message ?? 'Done.') + summary);

  try {
    const { reloadCalendar } = await import('./calendar.js');
    await reloadCalendar();
  } catch { /* calendar not open yet */ }
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(text) {
  // Strip item ID codes like (`a69978fd`)
  text = text.replace(/\s*\(`[a-f0-9]{8}`\)/g, '');

  const esc = s => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = text.split('\n');
  const out   = [];
  let inList   = false;

  for (const line of lines) {
    if (/^---+$/.test(line.trim())) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('<hr style="border:none;border-top:0.5px solid var(--border);margin:10px 0;">');
      continue;
    }
    if (/^##\s/.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<div style="font-size:13px;font-weight:500;margin:12px 0 4px;">${inlineFormat(esc(line.replace(/^##\s+/, '')))}</div>`);
      continue;
    }
    if (/^###\s/.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<div style="font-size:12px;font-weight:500;color:var(--muted);margin:10px 0 3px;">${inlineFormat(esc(line.replace(/^###\s+/, '')))}</div>`);
      continue;
    }
    if (/^[\-\*]\s/.test(line)) {
      if (!inList) { out.push('<ul style="margin:4px 0;padding-left:16px;list-style:none;">'); inList = true; }
      out.push(`<li style="margin:3px 0;line-height:1.5;">${inlineFormat(esc(line.replace(/^[\-\*]\s+/, '')))}</li>`);
      continue;
    }
    if (inList && line.trim() !== '') { out.push('</ul>'); inList = false; }
    if (line.trim() === '') {
      if (!inList) out.push('<div style="height:6px;"></div>');
      continue;
    }
    out.push(`<div style="line-height:1.55;margin:2px 0;">${inlineFormat(esc(line))}</div>`);
  }

  if (inList) out.push('</ul>');
  return out.join('');
}

function inlineFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:500;">$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`([^`]+)`/g,     '<code style="font-size:12px;background:var(--bg);padding:1px 5px;border-radius:4px;font-family:monospace;">$1</code>');
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function appendUserMessage(text, imageBase64) {
  const el = document.createElement('div');
  el.className = 'chat-msg user';
  if (imageBase64) {
    const img = document.createElement('img');
    img.src = 'data:image/jpeg;base64,' + imageBase64;
    img.style.cssText = 'display:block;width:120px;height:120px;object-fit:cover;border-radius:8px;margin-bottom:6px;';
    el.appendChild(img);
  }
  el.appendChild(document.createTextNode(text));
  messagesEl.appendChild(el);
  scrollToBottom();
}

function appendMessage(role, text, streaming = false) {
  const el = document.createElement('div');
  el.className = 'chat-msg ' + role + (streaming ? ' streaming' : '');
  if (text) el.innerHTML = renderMarkdown(text);
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function updateMessage(el, text) {
  el.innerHTML = renderMarkdown(text);
  scrollToBottom();
}

function clearPhoto() {
  pendingImageBase64 = null;
  if (photoPreview) photoPreview.innerHTML = '';
  inputEl.placeholder = 'Ask about your wardrobe…';
}

function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

function setInputDisabled(disabled) {
  inputEl.disabled    = disabled;
  sendBtn.disabled    = disabled;
  photoBtn.disabled   = disabled;
  sendBtn.textContent = disabled ? 'Sending...' : 'Send';
}

// ─── Type detection ───────────────────────────────────────────────────────────

function detectType(text) {
  const lower = text.toLowerCase();

  const logKeywords = [
    'wore', 'had on', 'log this', 'log those', 'log them', 'log the',
    'record this', 'record those', 'save those', 'save them',
    'save to calendar', 'add to calendar', 'put on', 'dressed in', 'i was in',
  ];
  const planKeywords = [
    'plan', 'next week', 'forecast', 'weather', 'schedule',
    'coming week', 'this week', 'calendar',
  ];
  const qaKeywords = [
    'should i', 'would', 'does this', 'what goes', 'advice',
    'suggest', 'recommend', 'tuck', 'match', 'work with', 'pair',
    'wear with', 'look good', 'think about', 'opinion', '?',
  ];

  const isLog  = logKeywords.some(kw  => lower.includes(kw));
  const isPlan = planKeywords.some(kw => lower.includes(kw));
  const isQA   = qaKeywords.some(kw   => lower.includes(kw));
  const mentionsNow = lower.includes('today') || lower.includes('wearing') ||
                      lower.includes('i have on') || lower.includes("i'm in");

  if (isPlan && !isLog) return 'plan';
  if (isLog)            return 'log';
  if (mentionsNow && isQA) return 'log+qa';
  if (mentionsNow)      return 'log';
  return 'qa';
}

// ─── Item matcher ─────────────────────────────────────────────────────────────

function findItem(items, name) {
  const n = name.toLowerCase().trim();
  return items.find(i => i.name.toLowerCase() === n)
      ?? items.find(i => i.name.toLowerCase().includes(n) || n.includes(i.name.toLowerCase()))
      ?? items.find(i => {
           const iw = i.name.toLowerCase().split(/\s+/);
           return name.split(/\s+/).filter(w => w.length > 2 && iw.includes(w.toLowerCase())).length >= 2;
         })
      ?? null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        else if (h > MAX)     { w = Math.round(w * MAX / h); h = MAX; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function buildWearHistory(rawLog) {
  const byDate = groupByDate(rawLog);
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => date + ': ' + rows.map(r => r.items?.name).filter(Boolean).join(', '))
    .join('\n');
}

function buildWeatherSummary(weather) {
  return weather
    .map(w => w.date + ': ' + w.high + '/' + w.low + 'C, ' + w.label + ', ' + w.rain + '% rain')
    .join('\n');
}
