import { getWearLog, getWeatherForecast, askClaude, logOutfit, deleteWearLogEntry,
         groupByDate, dateStr, offsetDate, getColourMap } from './api.js';
import CONFIG from './config.js';
import { resolveHex, detectPatternLabel } from './wardrobe.js';

let wearByDate  = {};   // { 'YYYY-MM-DD': [wearLog rows] }
let weatherData = {};   // { 'YYYY-MM-DD': weatherObj }
let colourMap   = {};
let selectedDate = null;

const DEFAULT_PLAN_PROMPT =
  `Look at the weather forecast for ${CONFIG.weather.city} and plan outfits for my ` +
  `three in-office days this week. The first day is most formal (dress shirt), ` +
  `the middle day is business casual, and the last is least formal (jeans ok). ` +
  `Avoid repeating tops worn in the past week, and don't repeat full outfits ` +
  `worn in the past two weeks.`;

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initCalendar() {
  updateMonthLabel();
  showLoading();

  try {
    const [rawLog, weather, rawMap] = await Promise.all([
      getWearLog(14, 14),
      getWeatherForecast(),
      getColourMap(),
    ]);

    colourMap = {};
    for (const [k, v] of Object.entries(rawMap)) {
      colourMap[k] = v;
      colourMap[k.toLowerCase()] = v;
    }
    wearByDate  = groupByDate(rawLog);
    weatherData = Object.fromEntries(weather.map(w => [w.date, w]));

    renderAll();
    bindControls();
  } catch (e) {
    document.getElementById('cal-past').innerHTML =
      `<div class="empty">Failed to load calendar: ${e.message}</div>`;
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
  const today = new Date();
  const todayStr = dateStr(today);

  // Past week: 7 days back from today's weekStart
  const pastStart  = weekStart(offsetDate(-7, today));
  const thisStart  = weekStart(today);
  const nextStart  = weekStart(offsetDate(7, today));

  renderWeek('cal-past',    pastStart,  todayStr);
  renderWeek('cal-current', thisStart,  todayStr);
  renderWeek('cal-next',    nextStart,  todayStr);
}

function renderWeek(containerId, startDate, todayStr) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  for (let i = 0; i < 7; i++) {
    const d    = offsetDate(i, startDate);
    const dStr = dateStr(d);
    container.appendChild(makeDayCard(d, dStr, todayStr));
  }
}

function makeDayCard(date, dStr, todayStr) {
  const worn     = wearByDate[dStr] ?? [];
  const weather  = weatherData[dStr];
  const isToday  = dStr === todayStr;
  const isPast   = dStr < todayStr;
  const isPlanned = !isPast && worn.length > 0;

  const card = document.createElement('div');
  let cls = 'day-card';
  if (isToday)   cls += ' is-today';
  else if (isPast && worn.length) cls += ' is-past';
  else if (isPlanned) cls += ' is-planned';

  card.className = cls;
  card.dataset.date = dStr;

  // Day number
  const num = document.createElement('div');
  num.className = 'day-num';
  num.textContent = date.getDate();
  card.appendChild(num);

  // Colour swatches
  if (worn.length) {
    const swatchRow = document.createElement('div');
    swatchRow.className = 'day-swatches';
    worn.forEach(row => {
      const colorName = row.items?.color ?? '';
      if (colorName.includes('/')) {
        const parts = colorName.split('/').slice(0, 2);
        const [h1, h2] = parts.map(p => resolveHex(p.trim()));
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '13');
        svg.setAttribute('height', '13');
        svg.style.cssText = 'border-radius:3px;border:0.5px solid rgba(0,0,0,0.12);flex-shrink:0;';
        svg.setAttribute('title', row.items?.name ?? '');
        svg.innerHTML = `<rect x="0" y="0" width="7" height="13" fill="${h1}"/><rect x="7" y="0" width="6" height="13" fill="${h2}"/>`;
        swatchRow.appendChild(svg);
      } else {
        const hex = resolveHex(colorName);
        const sw  = document.createElement('div');
        sw.className = 'day-swatch';
        sw.style.background = hex;
        sw.title = row.items?.name ?? '';
        swatchRow.appendChild(sw);
      }
    });
    card.appendChild(swatchRow);
  }

  // Meta line
  const meta = document.createElement('div');
  meta.className = 'day-meta';

  if (worn.length && isPast)    meta.innerHTML += `<span class="day-badge worn">worn</span> `;
  if (worn.length && isPlanned) meta.innerHTML += `<span class="day-badge planned">planned</span> `;
  if (weather)                  meta.innerHTML += `<br>${weather.high}°/${weather.low}° ${weather.label}`;

  card.appendChild(meta);

  // Click → detail panel
  card.addEventListener('click', () => showDetail(dStr, worn, weather, isPlanned));

  return card;
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function showDetail(dStr, worn, weather, isPlanned) {
  const panel = document.getElementById('day-detail');

  if (selectedDate === dStr && panel.style.display !== 'none') {
    panel.style.display = 'none';
    selectedDate = null;
    return;
  }

  selectedDate = dStr;
  panel.style.display = 'block';

  const label = isPlanned ? 'Planned outfit' : (worn.length ? 'Worn' : 'Nothing logged');
  const dateLabel = new Date(dStr + 'T12:00:00').toLocaleDateString('en-CA', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  let html = `
    <div class="day-detail-header">
      <h3>${dateLabel} — ${label}</h3>
      <div style="display:flex;gap:6px;">
        ${isPlanned ? `<button class="btn btn-sm" id="btn-clear-plan">Clear plan</button>` : ''}
        <button class="btn btn-sm btn-primary" id="btn-detail-chat">Ask AI ↗</button>
      </div>
    </div>`;

  if (weather) {
    html += `<div style="font-size:12px;color:var(--hint);margin-bottom:0.75rem;">
      ${weather.city}: ${weather.high}°/${weather.low}°C · ${weather.label} · ${weather.rain}% rain
    </div>`;
  }

  if (worn.length) {
    worn.forEach(row => {
      const item      = row.items ?? {};
      const colorName = item.color ?? '';
      const imageUrl  = item.image_url ? thumbUrl(item.image_url) : null;

      // Visual: thumbnail or swatch
      let visualHtml;
      if (imageUrl) {
        visualHtml = `<img src="${esc(imageUrl)}" alt="${esc(item.name ?? '')}"
          style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:0.5px solid rgba(0,0,0,0.12);flex-shrink:0;"
          onerror="this.style.display='none'">`;
      } else if (colorName.includes('/')) {
        const parts = colorName.split('/').slice(0, 2);
        const [h1, h2] = parts.map(p => resolveHex(p.trim()));
        visualHtml = `<svg width="28" height="28" style="border-radius:6px;border:0.5px solid rgba(0,0,0,0.12);flex-shrink:0;">
          <rect x="0" y="0" width="14" height="28" fill="${h1}"/>
          <rect x="14" y="0" width="14" height="28" fill="${h2}"/>
        </svg>`;
      } else {
        const hex = resolveHex(colorName);
        visualHtml = `<div class="swatch swatch-lg" style="background:${hex}"></div>`;
      }

      html += `
        <div class="outfit-item-row" data-log-id="${row.id}">
          ${visualHtml}
          <div class="outfit-item-info">
            <div class="outfit-item-name">${esc(item.name ?? 'Unknown item')}</div>
            <div class="outfit-item-meta">${esc(item.brand ?? '')} · ${esc(colorName)}</div>
          </div>
          <button class="btn btn-sm" data-remove="${row.id}" title="Remove">✕</button>
        </div>`;
    });
  } else {
    html += `<div class="empty" style="padding:1rem 0;">No items logged for this day.</div>`;
  }

  panel.innerHTML = html;

  // Bind remove buttons
  panel.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.remove;
      await deleteWearLogEntry(id);
      await reload();
    });
  });

  // Clear plan
  panel.querySelector('#btn-clear-plan')?.addEventListener('click', async () => {
    for (const row of worn) await deleteWearLogEntry(row.id);
    await reload();
  });

  // Ask AI
  panel.querySelector('#btn-detail-chat')?.addEventListener('click', () => {
    const worn_names = worn.map(r => r.items?.name).filter(Boolean).join(', ');
    import('./chat.js').then(({ sendQuickPrompt }) => {
      document.querySelector('[data-view="chat"]').click();
      const prompt = worn.length
        ? `On ${dateLabel} I wore: ${worn_names}. What could I have worn instead or paired differently?`
        : `Suggest an outfit for ${dateLabel}. ${weather ? `The weather will be ${weather.high}°C and ${weather.label}.` : ''}`;
      sendQuickPrompt(prompt);
    });
  });
}

// ─── AI plan ──────────────────────────────────────────────────────────────────

function bindControls() {
  const editor       = document.getElementById('plan-editor');
  const promptText   = document.getElementById('plan-prompt-text');
  const btnToggle    = document.getElementById('btn-toggle-plan-editor');
  const btnCancel    = document.getElementById('btn-plan-cancel');
  const btnSend      = document.getElementById('btn-plan-send');
  const btnLogToday  = document.getElementById('btn-log-today');

  promptText.value = DEFAULT_PLAN_PROMPT;

  btnToggle.addEventListener('click', () => {
    editor.style.display = editor.style.display === 'none' ? 'block' : 'none';
  });

  btnCancel.addEventListener('click', () => {
    editor.style.display = 'none';
  });

  btnSend.addEventListener('click', async () => {
    const prompt = promptText.value.trim();
    if (!prompt) return;

    btnSend.textContent = 'Planning…';
    btnSend.disabled = true;

    try {
      // Gather wear history for context
      const wearHistory = buildWearHistorySummary();
      const weatherSummary = buildWeatherSummary();

      // Send to Claude
      import('./chat.js').then(({ sendQuickPrompt }) => {
        document.querySelector('[data-view="chat"]').click();
        sendQuickPrompt(prompt, 'plan', { wearHistory, weatherSummary });
      });

      editor.style.display = 'none';
    } catch (e) {
      alert('Planning failed: ' + e.message);
    } finally {
      btnSend.textContent = 'Generate plan ↗';
      btnSend.disabled = false;
    }
  });

  btnLogToday.addEventListener('click', () => {
    import('./chat.js').then(({ sendQuickPrompt }) => {
      document.querySelector('[data-view="chat"]').click();
      sendQuickPrompt(`Help me log what I wore today (${dateStr(new Date())}). Ask me what I had on.`);
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildWearHistorySummary() {
  const today = dateStr(new Date());
  return Object.entries(wearByDate)
    .filter(([d]) => d <= today)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([date, rows]) => {
      const names = rows.map(r => r.items?.name).filter(Boolean).join(', ');
      return `${date}: ${names}`;
    })
    .join('\n');
}

function buildWeatherSummary() {
  return Object.values(weatherData)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(w => `${w.date}: ${w.high}°/${w.low}°C, ${w.label}, ${w.rain}% rain`)
    .join('\n');
}

function resolveHex(name) {
  if (!name) return '#888888';
  if (name.startsWith('#')) return name;
  return colourMap[name] ?? colourMap[name.toLowerCase().trim()] ?? '#888888';
}

// Append size params for Lululemon CDN URLs
function thumbUrl(url) {
  if (!url) return null;
  if (url.includes('images.lululemon.com/is/image/')) {
    return url.split('?')[0] + '?wid=120&hei=120&fmt=jpeg&qlt=85&fit=crop,1';
  }
  return url;
}

function weekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay()); // Sunday
  return d;
}

function showLoading() {
  ['cal-past', 'cal-current', 'cal-next'].forEach(id => {
    document.getElementById(id).innerHTML =
      '<div class="loading" style="grid-column:1/-1"><div class="spinner"></div></div>';
  });
}

function updateMonthLabel() {
  document.getElementById('cal-month').textContent =
    new Date().toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
}

async function reload() {
  const { getWearLog, groupByDate } = await import('./api.js');
  const rawLog = await getWearLog(14, 14);
  wearByDate = groupByDate(rawLog);
  renderAll();
  document.getElementById('day-detail').style.display = 'none';
  selectedDate = null;
}

// Exported so chat.js can trigger a calendar refresh after logging outfits
export async function reloadCalendar() {
  await reload();
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
