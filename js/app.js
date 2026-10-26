// Aplicación principal: estado, Modo Niño, tira de frase, barra rápida y navegación.
import * as db from './db.js';
import { buildDefaults } from './vocab.js';
import * as voice from './speech.js';
import { h, $, toast, today } from './ui.js';
import { renderSpecial } from './special.js';
import { openSearch } from './search.js';
import * as parents from './parents.js';
import { logEvent } from './log.js';
import { iconSVG } from './icons.js';

export const COLORS = {
  persona: { name: 'Personas', hex: '#E5B300' },
  accion: { name: 'Acciones (verbos)', hex: '#2E9B45' },
  cosa: { name: 'Cosas (sustantivos)', hex: '#EE7A12' },
  descriptivo: { name: 'Descriptivos', hex: '#2F78D0' },
  social: { name: 'Social / frases', hex: '#DB5297' },
  urgente: { name: 'Negación / urgente', hex: '#D6312A' },
  lugar: { name: 'Lugares', hex: '#8E44AD' },
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
  neutral: true,
  arasaacColor: false,
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
  // En celular, 3×4 deja los pictogramas más grandes que 4×4
  if (settings && !isTablet() && !S.settings.phoneGrid) {
    if (S.settings.cols === 4 && S.settings.rows === 4) S.settings.cols = 3;
    S.settings.phoneGrid = 2;
    db.setKV('settings', S.settings);
  }
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
  if (!isTablet()) { s.cols = 3; s.rows = 4; s.phoneGrid = 2; }
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
export function gridOf(boardId = S.board) {
  const b = S.boards.get(boardId);
  if (b && b.cols && b.rows) return { cols: b.cols, rows: b.rows };
  return { cols: S.settings.cols, rows: S.settings.rows };
}
export const perPage = (boardId = S.board) => { const g = gridOf(boardId); return g.cols * g.rows; };

export function imgSrc(card) {
  if (!card || !card.image) return null;
  if (card.image.kind === 'media') return db.mediaURLSync(card.image.id);
  if (card.image.kind === 'url') return card.image.url;
  if (card.image.kind === 'picto') return `pictos/${S.settings.arasaacColor ? 'color' : 'bn'}/${card.image.id}.png`;
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
  root.classList.toggle('neutral', !!s.neutral);
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
  const svg = !src && card.icon ? iconSVG(card.icon) : null;
  if (svg) return h('div', { class: cls + ' has-icon', html: svg });
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
  if (S.settings.addToPhrase && !toBody) addToPhrase({ label: card.label, cardId: card.id, color: card.color, emoji: card.emoji, image: card.image, icon: card.icon });
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
  const title = h('div', { class: 'title' }, h('span', {}, board ? board.name : ''));
  const owner = [...S.cards.values()].find(c => c.type === 'folder' && c.link === S.board && c.boardId === 'home');
  if (owner && COLORS[owner.color]) title.firstChild.className = 'tpill c-' + owner.color;
  const find = h('div', { class: 'navbtn find', 'aria-label': 'Buscar pictograma' }, h('span', { class: 'ico' }, '🔎'), h('span', { class: 'txt' }, 'Buscar'));
  bindActivate(find, openSearch);
  const gear = parents.gateButton();
  nav.append(home, title, pager, find, gear);
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
  const g = gridOf(S.board);
  grid.style.setProperty('--cols', g.cols);
  grid.style.setProperty('--rows', g.rows);
  if (g.cols * g.rows <= 9) grid.classList.add('big');
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
    const el = cardEl(card, 'qcard' + (card.hidden ? ' is-hidden' : '') + (card.small ? ' small' : ''));
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

// ---------- Pantalla principal simple (5 fichas grandes) ----------
const HOME_V2 = ['f-personas', 'f-comida', 'f-lugares', 'f-juguetes', 'f-cuerpo'];
async function migrateLayout() {
  if ((await db.getKV('layoutVersion', 1)) >= 2) return;
  const home = S.boards.get('home');
  if (home) await saveBoard({ ...home, cols: 3, rows: 2 });
  const rename = async (cardId, boardId, label, emoji) => {
    const c = S.cards.get(cardId);
    if (c) await saveCard({ ...c, label, ...(emoji ? { emoji } : {}) });
    const b = S.boards.get(boardId);
    if (b) await saveBoard({ ...b, name: label });
  };
  await rename('f-personas', 'personas', 'Familia');
  await rename('f-juguetes', 'juguetes', 'Intereses', '⭐');
  const others = cardsOf('home').filter(c => !HOME_V2.includes(c.id));
  let p = 6;
  for (const c of others) await saveCard({ ...c, pos: p++, hidden: true });
  for (const [i, id] of HOME_V2.entries()) {
    const c = S.cards.get(id);
    if (c && c.boardId === 'home') await saveCard({ ...c, pos: i, hidden: false });
  }
  await db.setKV('layoutVersion', 2);
}

// Colores por menú (norma PECS / Fitzgerald)
async function migrateColors() {
  if ((await db.getKV('colorVersion', 1)) >= 2) return;
  const set = { 'f-personas': 'persona', 'f-comida': 'cosa', 'f-lugares': 'lugar', 'f-juguetes': 'accion', 'f-cuerpo': 'urgente',
    'f-bebidas': 'cosa', 'f-acciones': 'accion', 'f-sentimientos': 'descriptivo', 'f-ropa': 'cosa', 'f-higiene': 'accion',
    'f-rutinas': 'accion', 'f-agenda': 'social', 'f-elegir': 'social' };
  for (const [id, color] of Object.entries(set)) {
    const c = S.cards.get(id);
    if (c && c.color === 'carpeta') await saveCard({ ...c, color });
  }
  for (const c of cardsOf('lugares')) if (c.color === 'cosa' && !c.id.startsWith('c-')) await saveCard({ ...c, color: 'lugar' });
  await db.setKV('colorVersion', 2);
}

// Inicio con 4 menús, barra de 5 urgentes + "Me duele" pequeño, pictogramas planos
async function migrateV3() {
  if ((await db.getKV('layoutVersion', 1)) >= 3) return;
  const home = S.boards.get('home');
  if (home) await saveBoard({ ...home, cols: 2, rows: 2 });
  const icons = { 'f-personas': 'familia', 'f-comida': 'comida', 'f-lugares': 'lugares', 'f-juguetes': 'intereses', 'f-cuerpo': 'duele',
    'q-bano': 'bano', 'q-agua': 'agua', 'q-ayuda': 'ayuda', 'q-si': 'si', 'q-no': 'no', 'q-duele': 'duele' };
  const homeOrder = ['f-personas', 'f-comida', 'f-lugares', 'f-juguetes'];
  const others = cardsOf('home').filter(c => !homeOrder.includes(c.id)).sort((a, b) => a.pos - b.pos);
  let p = 4;
  for (const c of others) await saveCard({ ...c, pos: p++, hidden: true });
  for (const [i, id] of homeOrder.entries()) { const c = S.cards.get(id); if (c && c.boardId === 'home') await saveCard({ ...c, pos: i, hidden: false }); }
  const quickOrder = ['q-bano', 'q-agua', 'q-ayuda', 'q-si', 'q-no', 'q-duele'];
  const qOthers = cardsOf('quick').filter(c => !quickOrder.includes(c.id)).sort((a, b) => a.pos - b.pos);
  p = quickOrder.length;
  for (const c of qOthers) await saveCard({ ...c, pos: p++, hidden: true });
  for (const [i, id] of quickOrder.entries()) { const c = S.cards.get(id); if (c && c.boardId === 'quick') await saveCard({ ...c, pos: i, hidden: false, small: id === 'q-duele' }); }
  for (const [id, icon] of Object.entries(icons)) { const c = S.cards.get(id); if (c && !c.image) await saveCard({ ...c, icon }); }
  await db.setKV('layoutVersion', 3);
}

// Pictogramas ARASAAC incluidos en la app (carpeta pictos/)
export let PICTOS = {};
async function loadPictos() {
  try {
    const r = await fetch('pictos/index.json', { cache: 'no-cache' });
    if (r.ok) PICTOS = await r.json();
  } catch (e) {}
  if (!Object.keys(PICTOS).length) return;
  if ((await db.getKV('pictoVersion', 0)) >= 1) return;
  for (const c of S.cards.values()) {
    if (!c.image && PICTOS[c.id]) await saveCard({ ...c, image: { kind: 'picto', id: c.id } });
  }
  await db.setKV('pictoVersion', 1);
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
  await migrateLayout();
  await migrateColors();
  await migrateV3();
  await loadPictos();
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
