// Aplicación principal: estado, Modo Niño, tira de frase, barra rápida y navegación.
import * as db from './db.js';
import { buildDefaults, SCHOOL } from './vocab.js';
import * as voice from './speech.js';
import { h, $, toast, today } from './ui.js';
import { renderSpecial } from './special.js';
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
  cols: 4,
  rows: 3,
  gridSync: true,
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

// ---------- Ubicación de las fichas ----------
// Cada ficha guarda su casilla absoluta: página, fila y columna. Nunca cambia sola:
// esconder, mostrar, agregar o cambiar la cuadrícula no mueve a las demás.
// En la barra de abajo ("quick") solo cuenta la columna, que es el orden.
export const slotKey = c => c.row == null ? (c.pos || 0) : (c.page || 0) * 10000 + c.row * 100 + c.col;
export const slotOf = c => ({ page: c.page || 0, row: c.row, col: c.col });
export const sameSlot = (a, b) => (a.page || 0) === (b.page || 0) && a.row === b.row && a.col === b.col;
export const slotId = c => `${c.page || 0},${c.row},${c.col}`;
export function parseSlot(str) {
  const [page, row, col] = String(str).split(',').map(Number);
  return { page, row, col };
}

export function cardsOf(boardId) {
  return [...S.cards.values()].filter(c => c.boardId === boardId).sort((a, b) => slotKey(a) - slotKey(b));
}
export function cardAt(boardId, slot, exceptId) {
  return cardsOf(boardId).find(c => c.id !== exceptId && sameSlot(c, slot));
}
export function gridOf(boardId = S.board) {
  const b = S.boards.get(boardId);
  if (b && b.cols && b.rows) return { cols: b.cols, rows: b.rows };
  return { cols: S.settings.cols, rows: S.settings.rows };
}
export const inGrid = (c, g = gridOf(c.boardId)) => c.row < g.rows && c.col < g.cols;

// Primera casilla libre desde una página (para fichas nuevas, importadas o duplicadas)
export function firstFreeSlot(boardId, fromPage = 0) {
  const list = cardsOf(boardId);
  if (boardId === 'quick') return { page: 0, row: 0, col: list.reduce((m, c) => Math.max(m, c.col), -1) + 1 };
  const g = gridOf(boardId);
  const used = new Set(list.map(slotId));
  for (let page = fromPage; ; page++) {
    for (let row = 0; row < g.rows; row++) {
      for (let col = 0; col < g.cols; col++) if (!used.has(`${page},${row},${col}`)) return { page, row, col };
    }
  }
}

// Convierte el número lineal antiguo (pos) en casilla, con la cuadrícula que el niño veía
export function posToSlot(pos, boardId, g) {
  pos = Number(pos) || 0;
  if (boardId === 'quick') return { page: 0, row: 0, col: pos };
  const n = g.cols * g.rows;
  return { page: Math.floor(pos / n), row: Math.floor((pos % n) / g.cols), col: (pos % n) % g.cols };
}

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

// Mantener presionado: para gestos del adulto que el niño no hace por accidente
function bindLongPress(el, ms, fn) {
  let timer = null;
  const stop = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', e => { if (e.button && e.button !== 0) return; stop(); timer = setTimeout(() => { timer = null; fn(); }, ms); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, stop);
}

// "Estoy modelando": el adulto toca fichas para enseñarle; esos toques no van al registro.
// Se activa y desactiva manteniendo Inicio 2 segundos. Un borde suave lo indica.
export function toggleModeling() {
  S.modeling = !S.modeling;
  document.documentElement.classList.toggle('modeling', S.modeling);
  toast(S.modeling ? 'Estoy modelando: lo que se toque ahora no se guarda en el registro. Mantén Inicio otra vez para terminar.' : 'Modelado terminado: el registro sigue como siempre.', 3500);
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
  const text = phraseText(S.phrase);
  voice.speak(text);
  logEvent({ kind: 'phrase', label: text, words: S.phrase.length });
}

// Frase natural. Regla: cada ficha aporta su texto pronunciado (o su texto si no tiene);
// si ese texto empieza con las mismas palabras con que termina lo ya dicho, no se repiten.
// "Quiero" + "Agua" (dice "Quiero agua") → "Quiero agua", no "Quiero quiero agua".
// "Yo quiero" + "Plaza Vea" (dice "Quiero ir a Plaza Vea") → "Yo quiero ir a Plaza Vea".
const normWord = w => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ]/g, '');
export function phraseText(items) {
  const out = [];
  for (const p of items) {
    const c = p.cardId && S.cards.get(p.cardId);
    const words = String((c && c.speak) || p.label || '').trim().split(/\s+/).filter(Boolean);
    let k = Math.min(out.length, words.length);
    while (k > 0 && !words.slice(0, k).every((w, i) => normWord(w) === normWord(out[out.length - k + i]))) k--;
    out.push(...words.slice(k));
  }
  const text = out.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
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
  document.documentElement.classList.toggle('modeling', !!S.modeling && !S.parent);
  renderParentBar();
  renderStrip();
  renderMain();
  renderQuick();
}

function renderParentBar() {
  els.parentBar.innerHTML = '';
  if (!S.parent) return;
  els.parentBar.append(parents.toolbar());
  parents.notices(els.parentBar);
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

// En Modo Niño hay una sola página por menú; las demás páginas solo las ve el adulto
function pageCount(boardId) {
  if (!S.parent) return 1;
  const g = gridOf(boardId);
  const cards = cardsOf(boardId).filter(c => (S.parent || !c.hidden) && inGrid(c, g));
  let pages = cards.reduce((m, c) => Math.max(m, (c.page || 0) + 1), 1);
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
  // Mantenerlo 2 s: "Estoy modelando". Se cancela el toque para que no abra el Inicio ni cuente como toque.
  if (!S.parent) bindLongPress(home, 2000, () => { home.dispatchEvent(new Event('pointercancel')); toggleModeling(); });
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
  const g = gridOf(S.board);
  grid.style.setProperty('--cols', g.cols);
  grid.style.setProperty('--rows', g.rows);
  if (g.cols * g.rows <= 9) grid.classList.add('big');
  const all = cardsOf(S.board);
  const bySlot = new Map(all.map(c => [slotId(c), c]));
  const cells = [];
  for (let row = 0; row < g.rows; row++) for (let col = 0; col < g.cols; col++) cells.push({ page: S.page, row, col });
  for (const slot of cells) {
    const i = slotId(slot);
    const card = bySlot.get(i);
    if (card && (!card.hidden || S.parent)) {
      const el = cardEl(card, card.hidden ? 'is-hidden' : '');
      el.dataset.slot = i;
      if (S.parent) {
        parents.bindParentCard(el, card);
        if (S.board !== 'quick') el.append(visToggle(card, S.board));
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
        empty.addEventListener('click', () => parents.newCard(S.board, slot));
      }
      grid.append(empty);
    }
  }
  main.append(grid);
  // Fichas que el niño no ve porque no caben en su única página: solo las ve el adulto
  const outside = all.filter(c => !c.hidden && (!inGrid(c, g) || (c.page || 0) > 0));
  if (S.parent && outside.length) main.prepend(parents.outsideNotice(outside, g));
}

// Modo Padres: un toque para que el niño vea o no esta ficha
function visToggle(card, boardId) {
  const b = h('button', { class: 'vis-toggle' + (card.hidden ? ' off' : ''), type: 'button', 'aria-label': card.hidden ? 'Mostrar' : 'Esconder' },
    card.hidden ? '🚫' : '👁');
  b.title = card.hidden ? 'Oculta: tócala para mostrarla' : 'Se ve: tócala para esconderla';
  b.addEventListener('pointerdown', e => e.stopPropagation());
  b.addEventListener('click', async e => {
    e.stopPropagation();
    await parents.setVisible(boardId, S.cards.get(card.id), !!card.hidden);
    render();
  });
  return b;
}

export function renderQuick() {
  const q = els.quick;
  if (!q) return;
  q.innerHTML = '';
  q.classList.toggle('hide', !S.settings.quickBar && !S.parent);
  if (!S.settings.quickBar && !S.parent) return;
  const all = cardsOf('quick');
  const shown = all.filter(c => !c.hidden);
  const last = shown.length ? shown[shown.length - 1].col : -1;
  const first = shown.length ? shown[0].col : 0;
  // En Modo Niño, un botón escondido entre otros deja su hueco: los demás no se corren
  const cards = S.parent ? all : all.filter(c => c.col >= first && c.col <= last);
  const count = cards.length + (S.parent ? 1 : 0);
  q.style.setProperty('--qn', count);
  q.style.setProperty('--qhalf', Math.ceil(count / 2));
  for (const card of cards) {
    if (card.hidden && !S.parent) { q.append(h('div', { class: 'qcard qgap', 'aria-hidden': 'true' })); continue; }
    const el = cardEl(card, 'qcard' + (card.hidden ? ' is-hidden' : '') + (card.small ? ' small' : ''));
    if (S.parent) { el.addEventListener('click', () => parents.editCard(card)); el.append(visToggle(card, 'quick')); }
    else bindActivate(el, () => activateCard(card, 'Barra rápida'));
    q.append(el);
  }
  if (S.parent) {
    const add = h('div', { class: 'slot-empty qcard' }, h('span', {}, '+'));
    add.addEventListener('click', () => parents.newCard('quick', firstFreeSlot('quick')));
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

// Posiciones por página, fila y columna (antes un número lineal "pos").
// Se calcula con la cuadrícula que tenía cada tablero, así el niño ve todo igual que antes.
export function slotsFromPos(cards, gridFor) {
  let changed = 0;
  for (const c of cards) {
    if (c.row != null && c.col != null) { if ('pos' in c) { delete c.pos; changed++; } continue; }
    Object.assign(c, posToSlot(c.pos, c.boardId, gridFor(c.boardId)));
    delete c.pos;
    changed++;
  }
  return changed;
}
async function migrateSlots() {
  if ((await db.getKV('slotVersion', 0)) >= 1) return;
  const cards = [...S.cards.values()].map(c => ({ ...c }));
  slotsFromPos(cards, id => gridOf(id));
  for (const c of cards) await saveCard(c);
  await db.setKV('slotVersion', 1);
}

// "Quiero" vuelve a la barra de abajo como primer botón (una sola vez)
async function migrateQuiero() {
  if ((await db.getKV('quieroVersion', 0)) >= 1) return;
  const q = S.cards.get('q-quiero');
  if (q && q.boardId === 'quick') {
    const others = cardsOf('quick').filter(c => c.id !== q.id);
    const minCol = others.reduce((m, c) => Math.min(m, c.col), 0);
    await saveCard({ ...q, hidden: false, page: 0, row: 0, col: minCol - 1 });
  }
  await db.setKV('quieroVersion', 1);
}

// Temporizador "Esperar": tablero especial y su carpeta en el Inicio, escondida hasta que el adulto la muestre
async function migrateTimer() {
  if ((await db.getKV('timerVersion', 0)) >= 1) return;
  if (!S.boards.has('esperar')) await saveBoard({ id: 'esperar', name: 'Esperar', special: 'timer' });
  if (!S.cards.has('f-esperar') && S.boards.has('home')) {
    await saveCard({ id: 'f-esperar', boardId: 'home', ...firstFreeSlot('home'), label: 'Esperar', speak: '', emoji: '⏳', color: 'carpeta',
      type: 'folder', link: 'esperar', q: 'esperar', hidden: true, image: { kind: 'picto', id: 'a-esperar' }, audio: null });
  }
  await db.setKV('timerVersion', 1);
}

// Menú del colegio: tablero nuevo y su carpeta en el Inicio, escondida hasta que el adulto la muestre
async function migrateSchool() {
  if ((await db.getKV('schoolVersion', 0)) >= 1) return;
  if (!S.boards.has('colegio')) {
    await saveBoard({ id: 'colegio', name: 'Colegio' });
    const g = gridOf('colegio');
    for (const [i, [id, label, emoji, color, o]] of SCHOOL.entries()) {
      if (S.cards.has(id)) continue;
      await saveCard({ id, boardId: 'colegio', ...posToSlot(i, 'colegio', g), label, emoji, color, speak: o.s || '', type: 'word', link: null,
        q: o.q || '', hidden: false, image: PICTOS[id] ? { kind: 'picto', id } : null, audio: null });
    }
  }
  if (!S.cards.has('f-colegio') && S.boards.has('home')) {
    await saveCard({ id: 'f-colegio', boardId: 'home', ...firstFreeSlot('home'), label: 'Colegio', speak: '', emoji: '🏫', color: 'carpeta',
      type: 'folder', link: 'colegio', q: 'colegio', hidden: true, image: PICTOS['f-colegio'] ? { kind: 'picto', id: 'f-colegio' } : null, audio: null });
  }
  await db.setKV('schoolVersion', 1);
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
    S.fresh = !existing.length;
    if (S.fresh) await seedDefaults();
    await loadAll();
  } catch (e) {
    document.body.innerHTML = '<p style="padding:2rem;font-size:1.2rem">No se pudo abrir el almacenamiento del dispositivo. Si estás en modo incógnito/privado, abre la app en una ventana normal.</p>';
    throw e;
  }
  await migrateLayout();
  await migrateColors();
  await migrateV3();
  // Instalación nueva: el Inicio usa el mismo tamaño de ficha que los menús
  if (S.fresh && S.boards.get('home')) { const hb = { ...S.boards.get('home') }; delete hb.cols; delete hb.rows; await saveBoard(hb); }
  await migrateSlots();
  await migrateQuiero();
  await loadPictos();
  await migrateTimer();
  await migrateSchool();
  if (!(await db.getKV('installedAt', 0))) await db.setKV('installedAt', Date.now());
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
    // Actualizaciones solas: al volver a la app se busca versión nueva y, si llega, se recarga una vez
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded && !S.parent) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('./sw.js').then(reg => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  }
}

init();
