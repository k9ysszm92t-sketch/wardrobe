import { getItems, getColourMap } from './api.js';

let allItems = [];
let colourMap = {};

const grid    = document.getElementById('item-grid');
const count   = document.getElementById('wardrobe-count');
const fSearch   = document.getElementById('filter-search');
const fCategory = document.getElementById('filter-category');
const fBrand    = document.getElementById('filter-brand');
const fSeason   = document.getElementById('filter-season');
const fColour   = document.getElementById('filter-colour');

export async function initWardrobe() {
  grid.innerHTML = '<div class="loading"><div class="spinner"></div> Loading items…</div>';

  try {
    [allItems, colourMap] = await Promise.all([getItems(), getColourMap()]);
    populateFilters();
    render();
    bindFilters();
  } catch (e) {
    grid.innerHTML = `<div class="empty">Failed to load items: ${e.message}</div>`;
  }
}

// ─── Filter dropdowns ─────────────────────────────────────────────────────────

function populateFilters() {
  const categories = [...new Set(allItems.map(i => i.category).filter(Boolean))].sort();
  const brands     = [...new Set(allItems.map(i => i.brand).filter(Boolean))].sort();
  const colours    = [...new Set(allItems.map(i => i.color).filter(Boolean))].sort();

  fill(fCategory, categories);
  fill(fBrand,    brands);
  fill(fColour,   colours);
}

function fill(select, values) {
  const first = select.options[0]; // preserve "All …" option
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
  const hex     = resolveHex(item.color);
  const seasons = (item.seasons ?? []).join(', ');

  const card = document.createElement('div');
  card.className = 'item-card';
  card.innerHTML = `
    <div class="item-card-top">
      <div class="item-card-swatch" style="background:${hex}"></div>
      <div style="min-width:0;">
        <div class="item-card-title">${esc(item.name)}</div>
        <div class="item-card-brand">${esc(item.brand ?? '')}</div>
        <div class="item-card-colour">${esc(item.color ?? '')}</div>
      </div>
    </div>
    <div class="item-card-tags">
      ${item.category ? `<span class="badge badge-muted">${esc(item.category)}</span>` : ''}
      ${item.type     ? `<span class="badge badge-muted">${esc(item.type)}</span>` : ''}
      ${seasons       ? `<span class="badge badge-muted">${esc(seasons)}</span>` : ''}
      ${item.layerOnly ? '<span class="badge badge-accent">layer only</span>' : ''}
      ${item.cvd      ? '<span class="badge badge-green">CVD safe</span>' : ''}
    </div>
    ${item.notes ? `<div style="font-size:11px;color:var(--hint);line-height:1.4;">${esc(item.notes)}</div>` : ''}
  `;

  card.addEventListener('click', () => {
    // Switch to chat and pre-fill a question about this item
    import('./chat.js').then(({ sendQuickPrompt }) => {
      document.querySelector('[data-view="chat"]').click();
      sendQuickPrompt(
        `Tell me more about my ${item.brand} ${item.name} in ${item.color}. What works well with it?`
      );
    });
  });

  return card;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveHex(name) {
  if (!name) return '#888888';
  if (name.startsWith('#')) return name;
  // Try exact match first, then lowercase
  return colourMap[name] ?? colourMap[name.toLowerCase().trim()] ?? '#888888';
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
