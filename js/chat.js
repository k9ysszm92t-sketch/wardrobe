import { askClaude, getWearLog, getWeatherForecast, groupByDate, dateStr } from './api.js';

const messagesEl = document.getElementById('chat-messages');
const inputEl    = document.getElementById('chat-input');
const sendBtn    = document.getElementById('btn-chat-send');

export function initChat() {
  sendBtn.addEventListener('click', handleSend);

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Quick prompt buttons
  document.querySelectorAll('.quick-prompt').forEach(btn => {
    btn.addEventListener('click', () => {
      sendQuickPrompt(btn.dataset.prompt);
    });
  });
}

// Called externally (from calendar.js, wardrobe.js)
export function sendQuickPrompt(text, type = 'qa', extra = {}) {
  inputEl.value = text;
  handleSend(type, extra);
}

async function handleSend(type = 'qa', extra = {}) {
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = '';
  appendMessage('user', text);

  // Determine request type from prompt content if not specified
  const resolvedType = type !== 'qa' ? type : detectType(text);

  // Build extra context based on type
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
      console.warn('Could not fetch wear history/weather for plan prompt:', e.message);
    }
  }

  const msgEl = appendMessage('assistant', '', true);

  try {
    await askClaude({
      type: resolvedType,
      userPrompt: text,
      extra: context,
      onChunk: (chunk, full) => {
        msgEl.textContent = full;
        msgEl.classList.add('streaming');
        scrollToBottom();
      },
    });
  } catch (e) {
    msgEl.textContent = `Sorry, something went wrong: ${e.message}`;
  }

  msgEl.classList.remove('streaming');
  scrollToBottom();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function appendMessage(role, text, streaming = false) {
  const el = document.createElement('div');
  el.className = `chat-msg ${role}${streaming ? ' streaming' : ''}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Sniff whether the prompt needs full plan context
function detectType(text) {
  const planKeywords = ['plan', 'outfit', 'week', 'forecast', 'weather', 'schedule', 'calendar'];
  const lower = text.toLowerCase();
  return planKeywords.some(kw => lower.includes(kw)) ? 'plan' : 'qa';
}

function buildWearHistory(rawLog) {
  const byDate = groupByDate(rawLog);
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => {
      const names = rows.map(r => r.items?.name).filter(Boolean).join(', ');
      return `${date}: ${names}`;
    })
    .join('\n');
}

function buildWeatherSummary(weather) {
  return weather
    .map(w => `${w.date}: ${w.high}°/${w.low}°C, ${w.label}, ${w.rain}% rain`)
    .join('\n');
}
