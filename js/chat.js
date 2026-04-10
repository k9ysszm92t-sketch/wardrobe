import { askClaude, getWearLog, getWeatherForecast, getItems, getPreferences,
         savePreferences, logOutfit, groupByDate } from './api.js';

const messagesEl = document.getElementById('chat-messages');
const inputEl    = document.getElementById('chat-input');
const sendBtn    = document.getElementById('btn-chat-send');
const photoBtn   = document.getElementById('btn-photo-upload');
const photoInput = document.getElementById('photo-input');
const photoPreview = document.getElementById('photo-preview');

let pendingImageBase64 = null;

export function initChat() {
  sendBtn.addEventListener('click', () => handleSend());

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Photo upload button
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
}

export function sendQuickPrompt(text, type = 'qa', extra = {}) {
  inputEl.value = text;
  handleSend(type, extra);
}

async function handleSend(type = 'qa', extra = {}) {
  const text  = inputEl.value.trim();
  const hasImage = !!pendingImageBase64;

  if (!text && !hasImage) return;

  const displayText = text || 'Would this item work with my wardrobe?';
  inputEl.value = '';
  setInputDisabled(true);

  // Show user message with thumbnail if photo attached
  appendUserMessage(displayText, pendingImageBase64);

  // Determine type
  let resolvedType = type !== 'qa' ? type : detectType(text);
  if (hasImage) resolvedType = 'photo';

  const imageBase64 = pendingImageBase64;
  clearPhoto();

  // Fetch plan context if needed
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
      msgEl.textContent = 'Logging outfit...';
      const rawResponse = await askClaude({ type: 'log', userPrompt: displayText, extra: context });
      await handleLogResponse(rawResponse, msgEl);

      // If there's also a question, follow up with a QA response
      if (resolvedType === 'log+qa') {
        const qaMsg = appendMessage('assistant', '', true);
        const fullResponse = await askClaude({
          type: 'qa',
          userPrompt: displayText,
          extra: context,
          onChunk: (_chunk, full) => {
            qaMsg.textContent = full;
            qaMsg.classList.add('streaming');
            scrollToBottom();
          },
        });
        qaMsg.classList.remove('streaming');
        maybeUpdateMemory(displayText, fullResponse, 'qa');
      }

    } else {
      const fullResponse = await askClaude({
        type: resolvedType,
        userPrompt: displayText,
        extra: context,
        imageBase64,
        onChunk: (_chunk, full) => {
          msgEl.textContent = full;
          msgEl.classList.add('streaming');
          scrollToBottom();
        },
      });
      msgEl.classList.remove('streaming');
      maybeUpdateMemory(displayText, fullResponse, resolvedType);
    }

  } catch (e) {
    msgEl.classList.remove('streaming');
    msgEl.textContent = 'Sorry, something went wrong: ' + e.message;
  }

  setInputDisabled(false);
  inputEl.placeholder = 'Ask about your wardrobe…';
  inputEl.focus();
  scrollToBottom();
}

// ─── Memory: extract preferences after each response ─────────────────────────

// Phrases that strongly signal a preference worth saving
const EXPLICIT_MEMORY_PHRASES = [
  'remember', 'save this', 'note that', 'prefer', 'don\'t like', 'i like',
  'i love', 'i hate', 'always', 'never', 'avoid', 'favourite', 'favorite',
  'usually', 'tend to', 'i find', 'i feel', 'too formal', 'too casual',
  'works well', 'doesn\'t work', 'great combination', 'not a fan',
  'works best', 'i think', 'in my opinion',
];

async function maybeUpdateMemory(userText, assistantResponse, requestType) {
  const lower = userText.toLowerCase();

  // Always run memory extraction after plan and photo responses —
  // these contain rich implicit preference data worth capturing
  const alwaysCapture = requestType === 'plan' || requestType === 'photo';
  const hasExplicitPhrase = EXPLICIT_MEMORY_PHRASES.some(p => lower.includes(p));

  if (!alwaysCapture && !hasExplicitPhrase) return;

  try {
    const currentPrefs = await getPreferences();
    const raw = await askClaude({
      type: 'memory',
      userPrompt: 'Extract preferences',
      extra: {
        userMessage: userText,
        assistantResponse,
        currentPrefs,
      },
    });

    const clean = raw.replace(/```json|```/g, '').trim();
    const updated = JSON.parse(clean);
    if (updated.type === 'user_preferences') {
      await savePreferences(updated);
      console.log('Preferences updated');
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
    msgEl.textContent = rawResponse;
    return;
  }

  if (parsed.action !== 'log_outfits' || !Array.isArray(parsed.entries)) {
    msgEl.textContent = parsed.message ?? rawResponse;
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
      const names = itemIds.map(id => allItems.find(i => i.id === id)?.name).filter(Boolean).join(', ');
      results.push(entry.date + ': ' + names);
    } catch (e) {
      results.push(entry.date + ': failed — ' + e.message);
    }
  }

  const summary = results.length ? '\n\nLogged:\n' + results.join('\n') : '';
  msgEl.textContent = (parsed.message ?? 'Done.') + summary;

  try {
    const { reloadCalendar } = await import('./calendar.js');
    await reloadCalendar();
  } catch { /* calendar not open yet */ }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function clearPhoto() {
  pendingImageBase64 = null;
  if (photoPreview) photoPreview.innerHTML = '';
  inputEl.placeholder = 'Ask about your wardrobe…';
}

async function fileToBase64(file) {
  // Resize + compress before sending to keep token count low
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

function detectType(text) {
  const lower = text.toLowerCase();

  const logKeywords  = ['wore', 'had on', 'log this', 'record this',
                        'put on', 'dressed in', 'i was in'];
  const planKeywords = ['plan', 'next week', 'forecast', 'weather',
                        'schedule', 'coming week', 'this week', 'calendar'];
  const qaKeywords   = ['should i', 'would', 'does this', 'what goes',
                        'advice', 'suggest', 'recommend', 'tuck', 'match',
                        'work with', 'pair', 'wear with', 'look good',
                        'think about', 'opinion', '?'];

  const isLog  = logKeywords.some(kw  => lower.includes(kw));
  const isPlan = planKeywords.some(kw => lower.includes(kw));
  const isQA   = qaKeywords.some(kw   => lower.includes(kw));

  // "today" or "wearing" + a question = log the outfit AND answer the question
  const mentionsNow = lower.includes('today') || lower.includes('wearing') ||
                      lower.includes('i have on') || lower.includes("i'm in");

  if (isPlan) return 'plan';
  if (isLog)  return 'log';
  if (mentionsNow && isQA) return 'log+qa';
  if (mentionsNow) return 'log';
  return 'qa';
}

function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

function setInputDisabled(disabled) {
  inputEl.disabled    = disabled;
  sendBtn.disabled    = disabled;
  photoBtn.disabled   = disabled;
  sendBtn.textContent = disabled ? 'Sending...' : 'Send';
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
