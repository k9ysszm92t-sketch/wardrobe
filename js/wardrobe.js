import { getItems, getColourMap } from './api.js';

let allItems = [];
let colourMap = {};

const grid      = document.getElementById('item-grid');
const count     = document.getElementById('wardrobe-count');
const fSearch   = document.getElementById('filter-search');
const fCategory = document.getElementById('filter-category');
const fBrand    = document.getElementById('filter-brand');
const fSeason   = document.getElementById('filter-season');
const fColour   = document.getElementById('filter-colour');

export async function initWardrobe() {
  grid.innerHTML = '<div class="loading"><div class="spinner"></div> Loading items…</div>';
  try {
    const [items, rawMap] = await Promise.all([getItems(), getColourMap()]);
    allItems = items;
    colourMap = buildCaseInsensitiveMap(rawMap);
    populateFilters();
    render();
    bindFilters();
  } catch (e) {
    grid.innerHTML = `<div class="empty">Failed to load items: ${e.message}</div>`;
  }
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function populateFilters() {
  const categories = [...new Set(allItems.map(i => i.category).filter(Boolean))].sort();
  const brands     = [...new Set(allItems.map(i => i.brand).filter(Boolean))].sort();
  const colours    = [...new Set(allItems.map(i => i.color).filter(Boolean))].sort();
  fill(fCategory, categories);
  fill(fBrand,    brands);
  fill(fColour,   colours);
}

function fill(select, values) {
  const first = select.options[0];
  select.innerHTML = '';
  select.appendChild(first);
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
}

function bindFilters() {
  [fSearch, fCategory, fBrand, fSeason, fColour].forEach(el =>
    el.addEventListener('input', render)
  );
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const search   = fSearch.value.toLowerCase();
  const category = fCategory.value;
  const brand    = fBrand.value;
  const season   = fSeason.value;
  const colour   = fColour.value;

  const filtered = allItems.filter(item => {
    if (search && !`${item.name} ${item.brand} ${item.color}`.toLowerCase().includes(search)) return false;
    if (category && item.category !== category) return false;
    if (brand    && item.brand    !== brand)    return false;
    if (colour   && item.color    !== colour)   return false;
    if (season   && !(item.seasons ?? []).includes(season)) return false;
    return true;
  });

  count.textContent = `${filtered.length} item${filtered.length === 1 ? '' : 's'}`;

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty">No items match the current filters.</div>';
    return;
  }

  grid.innerHTML = '';
  filtered.forEach(item => grid.appendChild(makeCard(item)));
}

function makeCard(item) {
  const seasons     = (item.seasons ?? []).join(', ');
  const isPattern   = item.color?.includes('/');
  const patternLabel = isPattern ? detectPatternLabel(item.color) : null;
  const imageUrl    = item.image_url ? lululemonThumb(item.image_url) : null;

  const card = document.createElement('div');
  card.className = 'item-card';

  // ── Visual: photo if available, swatch if not ──────────────────────────────
  let visualHtml;
  if (imageUrl) {
    visualHtml = `
      <div class="item-card-image-wrap">
        <img class="item-card-image"
             src="${esc(imageUrl)}"
             alt="${esc(item.name)}"
             loading="lazy"
             onerror="this.parentElement.innerHTML='${swatchHtml(item.color, 'lg').replace(/'/g, "\\'")}'"
        >
      </div>`;
  } else {
    visualHtml = `
      <div class="item-card-swatch-wrap">
        ${swatchHtml(item.color, 'lg')}
        ${patternLabel ? `<span class="badge badge-muted pattern-label">${esc(patternLabel)}</span>` : ''}
      </div>`;
  }

  card.innerHTML = `
    ${visualHtml}
    <div class="item-card-body">
      <div class="item-card-title">${esc(item.name)}</div>
      <div class="item-card-brand">${esc(item.brand ?? '')}</div>
      <div class="item-card-colour">${swatchInline(item.color)} ${esc(item.color ?? '')}</div>
      <div class="item-card-tags">
        ${item.category  ? `<span class="badge badge-muted">${esc(item.category)}</span>` : ''}
        ${item.type      ? `<span class="badge badge-muted">${esc(item.type)}</span>` : ''}
        ${seasons        ? `<span class="badge badge-muted">${esc(seasons)}</span>` : ''}
        ${item.layerOnly ? `<span class="badge badge-accent">layer only</span>` : ''}
        ${item.cvd       ? `<span class="badge badge-green">CVD</span>` : ''}
      </div>
      ${item.notes ? `<div class="item-card-notes">${esc(item.notes)}</div>` : ''}
    </div>`;

  card.addEventListener('click', () => {
    import('./chat.js').then(({ sendQuickPrompt }) => {
      document.querySelector('[data-view="chat"]').click();
      sendQuickPrompt(
        `Tell me more about my ${item.brand} ${item.name} in ${item.color}. What works well with it?`
      );
    });
  });

  return card;
}

// ─── Swatch helpers ───────────────────────────────────────────────────────────

// Full-size swatch for card header (36×36 or 28×28)
function swatchHtml(colorName, size = 'md') {
  const dim = size === 'lg' ? 36 : 28;
  const r   = size === 'lg' ? 8  : 6;

  if (colorName?.includes('/')) {
    const parts = colorName.split('/').slice(0, 2);
    const [h1, h2] = parts.map(p => resolveHex(p.trim()));
    return `<svg width="${dim}" height="${dim}" style="border-radius:${r}px;border:0.5px solid rgba(0,0,0,0.12);display:block;flex-shrink:0;" aria-label="${esc(colorName)}">
      <rect x="0" y="0" width="${Math.ceil(dim/2)}" height="${dim}" fill="${h1}"/>
      <rect x="${Math.ceil(dim/2)}" y="0" width="${Math.floor(dim/2)}" height="${dim}" fill="${h2}"/>
    </svg>`;
  }

  const hex = resolveHex(colorName);
  return `<div style="width:${dim}px;height:${dim}px;border-radius:${r}px;background:${hex};border:0.5px solid rgba(0,0,0,0.12);flex-shrink:0;"></div>`;
}

// Tiny inline swatch (14×14) for the colour name row
function swatchInline(colorName) {
  if (colorName?.includes('/')) {
    const parts = colorName.split('/').slice(0, 2);
    const [h1, h2] = parts.map(p => resolveHex(p.trim()));
    return `<svg width="14" height="14" style="border-radius:3px;border:0.5px solid rgba(0,0,0,0.12);display:inline-block;vertical-align:middle;margin-right:3px;">
      <rect x="0" y="0" width="7" height="14" fill="${h1}"/>
      <rect x="7" y="0" width="7" height="14" fill="${h2}"/>
    </svg>`;
  }
  const hex = resolveHex(colorName);
  return `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${hex};border:0.5px solid rgba(0,0,0,0.12);vertical-align:middle;margin-right:3px;"></span>`;
}

// ─── Pattern detection ────────────────────────────────────────────────────────

export function detectPatternLabel(colorName) {
  const lower = (colorName ?? '').toLowerCase();
  if (lower.includes('gingham'))  return 'gingham';
  if (lower.includes('plaid'))    return 'plaid';
  if (lower.includes('tartan'))   return 'tartan';
  if (lower.includes('stripe'))   return 'stripe';
  if (lower.includes('dot'))      return 'dot';
  if (lower.includes('check'))    return 'check';
  if (lower.includes('print'))    return 'print';
  if (lower.includes('floral'))   return 'floral';
  if (lower.includes('multi'))    return 'multi';
  if (lower.includes('heather'))  return 'heather';
  return 'pattern';
}

// ─── Image URL helpers ────────────────────────────────────────────────────────

// Append Lululemon image server size params if URL matches their CDN
function lululemonThumb(url) {
  if (!url) return null;
  if (url.includes('images.lululemon.com/is/image/')) {
    return url.split('?')[0] + '?wid=400&hei=400&fmt=jpeg&qlt=85&fit=crop,1';
  }
  return url; // return as-is for other domains
}

// ─── Shared colour resolver ───────────────────────────────────────────────────

export function resolveHex(name) {
  if (!name) return '#888888';
  if (name.startsWith('#')) return name;
  return colourMap[name] ?? colourMap[name.toLowerCase().trim()] ?? '#888888';
}

function buildCaseInsensitiveMap(raw) {
  const map = {};
  for (const [k, v] of Object.entries(raw)) {
    map[k] = v;
    map[k.toLowerCase()] = v;
  }
  return map;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
