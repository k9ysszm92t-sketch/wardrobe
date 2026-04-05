import { initCalendar } from './calendar.js';
import { initWardrobe } from './wardrobe.js';
import { initChat }     from './chat.js';

// ─── View routing ─────────────────────────────────────────────────────────────

const views = {
  calendar: document.getElementById('view-calendar'),
  wardrobe: document.getElementById('view-wardrobe'),
  chat:     document.getElementById('view-chat'),
};

const navBtns = document.querySelectorAll('nav button[data-view]');
const loaded  = new Set();

function switchView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });

  navBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });

  // Lazy-init each view on first visit
  if (!loaded.has(name)) {
    loaded.add(name);
    if (name === 'calendar') initCalendar();
    if (name === 'wardrobe') initWardrobe();
    if (name === 'chat')     initChat();
  }
}

navBtns.forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

switchView('calendar');
