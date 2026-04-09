import { askClaude, getWearLog, getWeatherForecast, getItems,
         logOutfit, groupByDate, dateStr } from './api.js';

const messagesEl = document.getElementById('chat-messages');
const inputEl    = document.getElementById('chat-input');
const sendBtn    = document.getElementById('btn-chat-send');

export function initChat() {
  sendBtn.addEventListener('click', () => handleSend());

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  document.querySelectorAll('.quick-prompt').forEach(btn => {
    btn.addEventListener('click', () => sendQuickPrompt(btn.dataset.prompt));
  });
}

// Called externally from calendar.js and wardrobe.js
export function sendQuickPrompt(text, type = 'qa', extra = {}) {
  inputEl.value = text;
  handleSend(type, extra);
}

async function handleSend(type = 'qa', extra = {}) {
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = '';
  setInputDisabled(true);
  appendMessage('user', text);

  const resolvedType = type !== 'qa' ? type : detectType(text);

  // Fetch extra context for plan requests
  let context = { ...extra };
  if (resolvedType === 'plan' && !context.wearHistory) {
    try {
      const [rawLog, weather] = await Promise.all([
        getWearLog(14, 14),
        getWeatherForecast(),
      ]);
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
  const rawResponse = await askClaude({
    type: 'log',
    userPrompt: displayText,
    extra: context,
  });
  await handleLogResponse(rawResponse, msgEl);

  // If there's also a question, follow up with a QA response
  if (resolvedType === 'log+qa') {
    const qaMsg = appendMessage('assistant', '', true);
    await askClaude({
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
  }

      await handleLogResponse(rawResponse, msgEl);

    } else {
      // Streaming path: qa / plan / ingest
      await askClaude({
        type: resolvedType,
        userPrompt: text,
        extra: context,
        onChunk: (_chunk, full) => {
          msgEl.textContent = full;
          msgEl.classList.add('streaming');
          scrollToBottom();
        },
      });
      msgEl.classList.remove('streaming');
    }

  } catch (e) {
    msgEl.classList.remove('streaming');
    msgEl.textContent = 'Sorry, something went wrong: ' + e.message;
  }

  setInputDisabled(false);
  inputEl.focus();
  scrollToBottom();
}

// Log response handler
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
  try {
    allItems = await getItems();
  } catch (e) {
    msgEl.textContent = 'Could not fetch wardrobe items: ' + e.message;
    return;
  }

  const results = [];
  for (const entry of parsed.entries) {
    const itemIds = entry.items
      .map(name => findItem(allItems, name)?.id)
      .filter(Boolean);

    if (itemIds.length === 0) {
      results.push(entry.date + ': no matching items found for "' + entry.items.join(', ') + '"');
      continue;
    }

    try {
      await logOutfit(itemIds, entry.date);
      const names = itemIds
        .map(id => allItems.find(i => i.id === id)?.name)
        .filter(Boolean)
        .join(', ');
      results.push(entry.date + ': logged ' + names);
    } catch (e) {
      results.push(entry.date + ': failed — ' + e.message);
    }
  }

  const summary = results.length ? '\n\nLogged:\n' + results.join('\n') : '';
  msgEl.textContent = (parsed.message ?? 'Done.') + summary;

  // Reload calendar if already initialised
  try {
    const { reloadCalendar } = await import('./calendar.js');
    await reloadCalendar();
  } catch {
    // Calendar not open yet — fine
  }
}

// Tolerant item name matcher: exact > contains > word overlap
function findItem(items, name) {
  const n = name.toLowerCase().trim();

  let match = items.find(i => i.name.toLowerCase() === n);
  if (match) return match;

  match = items.find(i =>
    i.name.toLowerCase().includes(n) || n.includes(i.name.toLowerCase())
  );
  if (match) return match;

  const words = n.split(/\s+/);
  match = items.find(i => {
    const iWords = i.name.toLowerCase().split(/\s+/);
    return words.filter(w => w.length > 2 && iWords.includes(w)).length >= 2;
  });
  return match ?? null;
}

// Detect request type from prompt text
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

  // If wearing/today is mentioned alongside a question — it's log + qa
  const mentionsToday = lower.includes('today') || lower.includes('wearing') ||
                        lower.includes('i have on') || lower.includes('i\'m in');

  if (isPlan) return 'plan';
  if (isLog)  return 'log';
  if (mentionsToday && isQA) return 'log+qa';  // mixed intent
  if (mentionsToday) return 'log';
  return 'qa';
}

function appendMessage(role, text, streaming = false) {
  const el = document.createElement('div');
  el.className = 'chat-msg ' + role + (streaming ? ' streaming' : '');
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setInputDisabled(disabled) {
  inputEl.disabled    = disabled;
  sendBtn.disabled    = disabled;
  sendBtn.textContent = disabled ? 'Sending...' : 'Send';
}

function buildWearHistory(rawLog) {
  const byDate = groupByDate(rawLog);
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => {
      const names = rows.map(r => r.items?.name).filter(Boolean).join(', ');
      return date + ': ' + names;
    })
    .join('\n');
}

function buildWeatherSummary(weather) {
  return weather
    .map(w => w.date + ': ' + w.high + '/' + w.low + 'C, ' + w.label + ', ' + w.rain + '% rain')
    .join('\n');
}
