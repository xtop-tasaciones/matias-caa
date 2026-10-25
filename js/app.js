// Aplicación principal: estado, Modo Niño, tira de frase, barra rápida y navegación.
import * as db from './db.js';
import { buildDefaults } from './vocab.js';
import * as voice from './speech.js';
import { h, $, toast, today } from './ui.js';
import { renderSpecial } from './special.js';
import * as parents from './parents.js';
import { logEvent } from './log.js';

export const COLORS = {
  persona: { name: 'Personas', hex: '#E5B300' },
  accion: { name: 'Acciones (verbos)', hex: '#2E9B45' },
  cosa: { name: 'Cosas (sustantivos)', hex: '#EE7A12' },
  descriptivo: { name: 'Descriptivos', hex: '#2F78D0' },
  social: { name: 'Social / frases', hex: '#DB5297' },
  urgente: { name: 'Negación / urgente', hex: '#D6312A' },
  carpeta: { name: 'Carpeta', hex: '#8B7D6B' },
};

const isTablet = () => Math.min(screen.width, screen.height) >= 600;

export const DEFAULT_SETTINGS = {
  voiceURI: null,
  rate: 0.9,
  pitch: 1,
  cols: 8,
  rows: 5,
  showText: true,
  fontSize: 'm',
  debounceMs: 500,
  holdMs: 0,
  theme: 'light',
  pin: '',
  addToPhrase: true,
  speakFolders: false,
  quickBar: true,
  logEnabled: true,
  wakeLock: false,
};

export const S = {
  settings: { ...DEFAULT_SETTINGS },
  boards: new Map(),
  cards: new Map(),
  board: 'home',
  page: 0,
  phrase: [],
  parent: false,
  schedule: null,
  choice: null,
  lastFire: 0,
};

// ---------- Datos ----------
export async function loadAll() {
  const [boards, cards, settings, schedule, choice] = await Promise.all([
    db.getAll('boards'), db.getAll('cards'), db.getKV('settings', null), db.getKV('schedule', null), db.getKV('choice', null),
  ]);
  S.boards = new Map(boards.map(b => [b.id, b]));
  S.cards = new Map(cards.map(c => [c.id, c]));
  S.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  S.schedule = schedule || { items: [], first: null, then: null, day: '' };
  S.choice = choice || { question: '', cardIds: [] };
  await db.preloadMedia();
}

export async function seedDefaults() {
  const d = buildDefaults();
  await db.putMany('boards', d.boards);
  await db.putMany('cards', d.cards);
  await db.setKV('schedule', d.schedule);
  await db.setKV('choice', d.choice);
  const s = { ...DEFAULT_SETTINGS };
  if (!isTablet()) { s.cols = 4; s.rows = 4; }
  await db.setKV('settings', s);
}

export async function saveSettings() {
  await db.setKV('settings', S.settings);
  applySettings();
}
export async function saveCard(card) {
  S.cards.set(card.id, card);
  await db.put('cards', card);
}
export async function saveBoard(board) {
  S.boards.set(board.id, board);
  await db.put('boards', board);
}
export const saveSchedule = () => db.setKV('schedule', S.schedule);
export const saveChoice = () => db.setKV('choice', S.choice);

export function cardsOf(boardId) {
  return [...S.cards.values()].filter(c => c.boardId === boardId).sort((a, b) => a.pos - b.pos);
}
export function firstFreePos(boardId, from = 0) {
  const used = new Set(cardsOf(boardId).map(c => c.pos));
  let p = from;
  while (used.has(p)) p++;
  return p;
}
export const perPage = () => S.settings.cols * S.settings.rows;

export function imgSrc(card) {
  if (!card || !card.image) return null;
  if (card.image.kind === 'media') return db.mediaURLSync(card.image.id);
  if (card.image.kind === 'url') return card.image.url;
  return null;
}

// Borra fotos y audios que ya no usa ninguna ficha.
export async function gcMedia() {
  const used = new Set();
  for (const c of S.cards.values()) {
    if (c.image && c.image.kind === 'media') used.add(c.image.id);
    if (c.audio) used.add(c.audio);
  }
  const all = await db.getAll('media');
  for (const m of all) if (!used.has(m.id)) { await db.del('media', m.id); db.forgetMedia(m.id); }
}

// ---------- Apariencia ----------
export function applySettings() {
  const s = S.settings;
  const root = document.documentElement;
  let dark = s.theme === 'dark' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
  root.dataset.fs = s.fontSize;
  root.classList.toggle('no-text', !s.showText);
  root.style.setProperty('--cols', s.cols);
  root.style.setProperty('--rows', s.rows);
  voice.configure(s);
  wakeLock();
}

let lock = null;
async function wakeLock() {
  try {
    if (S.settings.wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      if (!lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
    } else if (!S.settings.wakeLock && lock) { await lock.release(); lock = null; }
  } catch (e) { lock = null; }
}

// ---------- Elementos de ficha ----------
export function picEl(card, cls = 'pic') {
  const src = imgSrc(card);
  return h('div', { class: cls },
    src ? h('img', { src, alt: '', draggable: 'false', loading: 'lazy' })
      : h('span', { class: 'emoji' }, card.emoji || (card.label || '?').slice(0, 1).toUpperCase()));
}

export function cardEl(card, extraClass = '') {
  const color = COLORS[card.color] ? card.color : 'cosa';
  const el = h('div', {
    class: `card c-${color}${card.type === 'folder' ? ' folder' : ''}${extraClass ? ' ' + extraClass : ''}`,
    role: 'button',
    'aria-label': card.label,
  },
    picEl(card),
    h('div', { class: 'label' + ((card.label || '').length > 9 ? ' long' : '') }, card.label));
  if (card.type === 'folder') el.prepend(h('div', { class: 'tab' }));
  return el;
}

// Activación de toques con antitoque y "mantener presionado".
export function bindActivate(el, fn) {
  let timer = null;
  let down = false;
  const clearPress = () => { el.classList.remove('pressing', 'holding'); };
  const cancel = () => { down = false; clearTimeout(timer); timer = null; clearPress(); };
  const fire = () => {
    const now = Date.now();
    if (now - S.lastFire < (Number(S.settings.debounceMs) || 0)) return;
    S.lastFire = now;
    el.classList.add('fired');
    setTimeout(() => el.classList.remove('fired'), 400);
    fn();
  };
  el.addEventListener('pointerdown', e => {
    if (e.button && e.button !== 0) return;
    down = true;
    el.classList.add('pressing');
    const hold = Number(S.settings.holdMs) || 0;
    if (hold > 0) {
      el.style.setProperty('--hold', hold + 'ms');
      // forzar reflujo para reiniciar la barra de progreso
      void el.offsetWidth;
      el.classList.add('holding');
      timer = setTimeout(() => { timer = null; down = false; clearPress(); fire(); }, hold);
    }
  });
  el.addEventListener('pointerup', () => {
    if (!down) return;
    if ((Number(S.settings.holdMs) || 0) > 0) { cancel(); return; }
    down = false; clearPress(); fire();
  });
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
  el.tabIndex = 0;
}

// ---------- Acciones ----------
export function activateCard(card, boardName) {
  if (card.type === 'folder') {
    if (S.settings.speakFolders) voice.sayCard(card);
    openBoard(card.link);
    return;
  }
  voice.sayCard(card);
  const toBody = card.link && S.boards.get(card.link)?.special === 'body';
  if (S.settings.addToPhrase && !toBody) addToPhrase({ label: card.label, cardId: card.id, color: card.color, emoji: card.emoji, image: card.image });
  logEvent({ kind: 'card', label: card.label, cardId: card.id, board: boardName || S.boards.get(card.boardId)?.name || '' });
  if (card.link && S.boards.has(card.link)) openBoard(card.link);
}

export function addToPhrase(item) {
  if (S.phrase.length >= 30) return;
  S.phrase.push(item);
  renderStrip();
}

export function speakPhrase() {
  if (!S.phrase.length) return;
  if (S.phrase.length === 1 && S.phrase[0].cardId) {
    const c = S.cards.get(S.phrase[0].cardId);
    if (c) { voice.sayCard(c); return; }
  }
  const text = S.phrase.map(p => p.label).join(' ');
  voice.speak(text);
  logEvent({ kind: 'phrase', label: text, words: S.phrase.length });
}

export function openBoard(id) {
  if (!S.boards.has(id)) id = 'home';
  S.board = id;
  S.page = 0;
  renderMain();
}

// ---------- Render ----------
let els = {};

export function render() {
  const app = $('#app');
  app.innerHTML = '';
  els.parentBar = h('div', { class: 'parentbar' });
  els.strip = h('div', { class: 'strip' });
  els.nav = h('div', { class: 'nav' });
  els.main = h('main', { class: 'main' });
  els.quick = h('div', { class: 'quick' });
  app.append(els.parentBar, els.strip, els.nav, els.main, els.quick);
  document.documentElement.classList.toggle('parent-mode', S.parent);
  renderParentBar();
  renderStrip();
  renderMain();
  renderQuick();
}

function renderParentBar() {
  els.parentBar.innerHTML = '';
  if (!S.parent) return;
  els.parentBar.append(parents.toolbar());
}

export function renderStrip() {
  const s = els.strip;
  if (!s) return;
  s.innerHTML = '';
  const list = h('div', { class: 'phrase', 'aria-label': 'Frase' });
  S.phrase.forEach(p => {
    const mini = h('div', { class: `mini c-${p.color || 'cosa'}` },
      picEl(p, 'mpic'),
      h('div', { class: 'mlabel' }, p.label));
    list.append(mini);
  });
  if (!S.phrase.length) list.append(h('div', { class: 'phrase-empty' }));
  const sayBtn = h('div', { class: 'sbtn say', 'aria-label': 'Decir la frase' }, h('span', { class: 'ico' }, '🔊'), h('span', { class: 'txt' }, 'Decir'));
  const backBtn = h('div', { class: 'sbtn', 'aria-label': 'Borrar el último' }, h('span', { class: 'ico' }, '⌫'), h('span', { class: 'txt' }, 'Borrar'));
  const clearBtn = h('div', { class: 'sbtn', 'aria-label': 'Borrar todo' }, h('span', { class: 'ico' }, '✖'), h('span', { class: 'txt' }, 'Todo'));
  bindActivate(sayBtn, speakPhrase);
  bindActivate(backBtn, () => { S.phrase.pop(); renderStrip(); });
  bindActivate(clearBtn, () => { S.phrase = []; voice.stop(); renderStrip(); });
  s.append(list, h('div', { class: 'sbtns' }, sayBtn, backBtn, clearBtn));
  requestAnimationFrame(() => { list.scrollLeft = list.scrollWidth; });
}

function pageCount(boardId) {
  const n = perPage();
  const cards = cardsOf(boardId).filter(c => S.parent || !c.hidden);
  const maxPos = cards.reduce((m, c) => Math.max(m, c.pos), -1);
  let pages = Math.max(1, Math.ceil((maxPos + 1) / n));
  if (S.parent) pages += 1; // una página extra para agregar fichas
  return pages;
}

function renderNav() {
  const nav = els.nav;
  nav.innerHTML = '';
  const board = S.boards.get(S.board);
  const home = h('div', { class: 'navbtn home' + (S.board === 'home' ? ' here' : ''), 'aria-label': 'Inicio' },
    h('span', { class: 'ico' }, '🏠'), h('span', { class: 'txt' }, 'Inicio'));
  bindActivate(home, () => openBoard('home'));
  const special = board && board.special;
  const pages = special ? 1 : pageCount(S.board);
  if (S.page >= pages) S.page = pages - 1;
  const prev = h('div', { class: 'navbtn pg', 'aria-label': 'Página anterior', 'data-pagejump': '-1' }, '◀');
  const next = h('div', { class: 'navbtn pg', 'aria-label': 'Página siguiente', 'data-pagejump': '1' }, '▶');
  const info = h('div', { class: 'pginfo' }, pages > 1 ? `${S.page + 1}/${pages}` : '');
  if (S.page <= 0) prev.classList.add('off');
  if (S.page >= pages - 1) next.classList.add('off');
  bindActivate(prev, () => { if (S.page > 0) { S.page--; renderMain(); } });
  bindActivate(next, () => { if (S.page < pages - 1) { S.page++; renderMain(); } });
  const pager = h('div', { class: 'pager' + (pages > 1 ? '' : ' hide') }, prev, info, next);
  const title = h('div', { class: 'title' }, board ? board.name : '');
  const gear = parents.gateButton();
  nav.append(home, title, pager, gear);
}

export function renderMain() {
  if (!els.main) return;
  renderNav();
  const main = els.main;
  main.innerHTML = '';
  const board = S.boards.get(S.board);
  main.className = 'main';
  if (board && board.special) {
    main.classList.add('special');
    renderSpecial(board, main);
    return;
  }
  const grid = h('div', { class: 'grid' });
  const n = perPage();
  const start = S.page * n;
  const byPos = new Map(cardsOf(S.board).map(c => [c.pos, c]));
  for (let i = start; i < start + n; i++) {
    const card = byPos.get(i);
    if (card && (!card.hidden || S.parent)) {
      const el = cardEl(card, card.hidden ? 'is-hidden' : '');
      el.dataset.slot = i;
      if (S.parent) {
        parents.bindParentCard(el, card);
        if (card.type === 'folder' && S.boards.has(card.link)) {
          const open = h('button', { class: 'btn sm open-folder' }, 'Abrir ›');
          open.addEventListener('pointerdown', e => e.stopPropagation());
          open.addEventListener('click', e => { e.stopPropagation(); openBoard(card.link); });
          el.append(open);
        }
      }
      else bindActivate(el, () => activateCard(card));
      grid.append(el);
    } else {
      const empty = h('div', { class: 'slot-empty', 'data-slot': i });
      if (S.parent) {
        empty.append(h('span', {}, '+'));
        empty.addEventListener('click', () => parents.newCard(S.board, i));
      }
      grid.append(empty);
    }
  }
  main.append(grid);
}

export function renderQuick() {
  const q = els.quick;
  if (!q) return;
  q.innerHTML = '';
  q.classList.toggle('hide', !S.settings.quickBar && !S.parent);
  if (!S.settings.quickBar && !S.parent) return;
  const cards = cardsOf('quick').filter(c => S.parent || !c.hidden);
  const count = cards.length + (S.parent ? 1 : 0);
  q.style.setProperty('--qn', count);
  q.style.setProperty('--qhalf', Math.ceil(count / 2));
  for (const card of cards) {
    const el = cardEl(card, 'qcard' + (card.hidden ? ' is-hidden' : ''));
    if (S.parent) el.addEventListener('click', () => parents.editCard(card));
    else bindActivate(el, () => activateCard(card, 'Barra rápida'));
    q.append(el);
  }
  if (S.parent) {
    const add = h('div', { class: 'slot-empty qcard' }, h('span', {}, '+'));
    add.addEventListener('click', () => parents.newCard('quick', firstFreePos('quick')));
    q.append(add);
  }
}

export function setParent(on) {
  S.parent = on;
  render();
}

// ---------- Agenda: reinicio diario ----------
export function checkScheduleDay() {
  const d = today();
  if (S.schedule && S.schedule.day !== d) {
    S.schedule.items.forEach(i => { i.done = false; });
    S.schedule.day = d;
    saveSchedule();
    return true;
  }
  return false;
}

// ---------- Inicio ----------
async function init() {
  try {
    const existing = await db.getAll('boards');
    if (!existing.length) await seedDefaults();
    await loadAll();
  } catch (e) {
    document.body.innerHTML = '<p style="padding:2rem;font-size:1.2rem">No se pudo abrir el almacenamiento del dispositivo. Si estás en modo incógnito/privado, abre la app en una ventana normal.</p>';
    throw e;
  }
  checkScheduleDay();
  applySettings();
  render();

  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      wakeLock();
      if (checkScheduleDay() && S.boards.get(S.board)?.special === 'schedule') renderMain();
    }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applySettings);
  // Evitar menús, zoom y gestos accidentales
  document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
