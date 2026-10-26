// Tableros especiales: ¿Dónde te duele?, Agenda visual (y Primero/Después), Elegir entre opciones.
import { S, PICTOS, cardEl, bindActivate, addToPhrase, renderMain, saveSchedule, saveChoice, activateCard } from './app.js';
import { BODY_PARTS } from './vocab.js';
import * as voice from './speech.js';
import { h, modal, toast } from './ui.js';
import { logEvent } from './log.js';
import { pickCard } from './parents.js';
import { renderTimerBoard } from './timer.js';

export function renderSpecial(board, main) {
  if (board.special === 'body') return renderBody(main);
  if (board.special === 'schedule') return renderSchedule(main);
  if (board.special === 'choice') return renderChoice(main);
  if (board.special === 'timer') return renderTimerBoard(main);
}

// ---------- ¿Dónde te duele? ----------
const SKIN = 'var(--skin)';
const BODY_SVG = `
<svg viewBox="0 0 240 430" class="body-svg" role="img" aria-label="Cuerpo">
  <g data-part="brazo"><rect x="40" y="140" width="30" height="105" rx="15"/><rect x="170" y="140" width="30" height="105" rx="15"/></g>
  <g data-part="mano"><circle cx="55" cy="258" r="17"/><circle cx="185" cy="258" r="17"/></g>
  <g data-part="pierna"><rect x="78" y="250" width="38" height="135" rx="16"/><rect x="124" y="250" width="38" height="135" rx="16"/></g>
  <g data-part="rodilla"><circle cx="97" cy="318" r="14"/><circle cx="143" cy="318" r="14"/></g>
  <g data-part="pie"><ellipse cx="92" cy="398" rx="25" ry="13"/><ellipse cx="148" cy="398" rx="25" ry="13"/></g>
  <g data-part="pecho" class="shirt"><path d="M72 150 q0 -18 18 -18 h60 q18 0 18 18 v45 h-96 z"/></g>
  <g data-part="barriga" class="shirt2"><path d="M72 195 h96 v45 q0 18 -18 18 h-60 q-18 0 -18 -18 z"/></g>
  <g data-part="garganta"><rect x="104" y="112" width="32" height="24" rx="6"/></g>
  <g data-part="oido"><ellipse cx="68" cy="72" rx="11" ry="17"/><ellipse cx="172" cy="72" rx="11" ry="17"/></g>
  <g data-part="cabeza"><circle cx="120" cy="68" r="50"/></g>
  <path class="hair" d="M72 58 q4 -42 48 -42 q44 0 48 42 q-14 -20 -48 -18 q-34 -2 -48 18z" pointer-events="none"/>
  <g data-part="ojo" class="eye"><circle cx="101" cy="64" r="8"/><circle cx="139" cy="64" r="8"/></g>
  <g data-part="nariz"><ellipse cx="120" cy="82" rx="7" ry="9"/></g>
  <g data-part="boca" class="mouth"><path d="M102 98 q18 16 36 0 q-18 6 -36 0z"/></g>
</svg>`;

function renderBody(main) {
  const wrap = h('div', { class: 'body-wrap' });
  const fig = h('div', { class: 'body-fig', html: BODY_SVG });
  const parts = h('div', { class: 'body-parts' });
  const say = (part) => {
    const text = `Me duele ${part.art} ${part.label}`;
    voice.speak(text);
    addToPhrase({ label: text, color: 'urgente', emoji: part.emoji, image: PICTOS['body-' + part.id] ? { kind: 'picto', id: 'body-' + part.id } : null });
    logEvent({ kind: 'card', label: text, board: '¿Dónde te duele?' });
    fig.querySelectorAll('[data-part]').forEach(g => g.classList.toggle('hurt', g.dataset.part === part.id));
    parts.querySelectorAll('.card').forEach(c => c.classList.toggle('chosen', c.dataset.part === part.id));
  };
  fig.querySelectorAll('[data-part]').forEach(g => {
    const part = BODY_PARTS.find(p => p.id === g.dataset.part);
    if (part) bindActivate(g, () => say(part));
  });
  for (const part of BODY_PARTS) {
    const el = cardEl({ label: part.label, emoji: part.emoji, color: 'urgente', image: PICTOS['body-' + part.id] ? { kind: 'picto', id: 'body-' + part.id } : null }, 'part');
    el.dataset.part = part.id;
    bindActivate(el, () => say(part));
    parts.append(el);
  }
  wrap.append(fig, parts);
  main.append(wrap);
}

// ---------- Agenda visual ----------
function renderSchedule(main) {
  const tab = S.scheduleTab || 'list';
  const tabs = h('div', { class: 'tabs' });
  const t1 = h('div', { class: 'tabbtn' + (tab === 'list' ? ' on' : '') }, '📅 Agenda del día');
  const t2 = h('div', { class: 'tabbtn' + (tab === 'ft' ? ' on' : '') }, '1️⃣ Primero / Después');
  bindActivate(t1, () => { S.scheduleTab = 'list'; renderMain(); });
  bindActivate(t2, () => { S.scheduleTab = 'ft'; renderMain(); });
  tabs.append(t1, t2);
  if (S.parent) {
    const tools = h('div', { class: 'ptools' });
    if (tab === 'list') {
      tools.append(
        h('button', { class: 'btn primary', onclick: editSchedule }, '✏️ Editar agenda'),
        h('button', { class: 'btn', onclick: () => { S.schedule.items.forEach(i => { i.done = false; }); saveSchedule(); renderMain(); } }, '↺ Reiniciar día'));
    } else {
      tools.append(h('button', { class: 'btn', onclick: fromSchedule }, 'Tomar de la agenda'),
        h('span', { class: 'muted small' }, 'Toca cada ficha para cambiarla.'));
    }
    tabs.append(tools);
  }
  main.append(tabs);
  if (tab === 'list') renderList(main); else renderFirstThen(main);
}

function renderList(main) {
  const items = S.schedule.items.filter(i => S.cards.has(i.cardId));
  const list = h('div', { class: 'sched' });
  const n = Math.max(1, items.length);
  const landscape = main.clientWidth > main.clientHeight;
  const rows = landscape ? (n > 6 ? 2 : 1) : (n > 8 ? 4 : n > 4 ? 3 : 2);
  list.style.setProperty('--sc', Math.ceil(n / rows));
  list.style.setProperty('--sr', rows);
  if (!items.length) list.append(h('p', { class: 'muted center' }, S.parent ? 'La agenda está vacía. Toca “Editar agenda”.' : ''));
  items.forEach((it, idx) => {
    const card = S.cards.get(it.cardId);
    const el = cardEl(card, it.done ? 'done' : '');
    el.prepend(h('div', { class: 'num' }, idx + 1));
    if (it.done) el.append(h('div', { class: 'donecheck', html: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#2E9B45"/><path d="M28 52 l15 15 l30 -32" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></svg>' }));
    bindActivate(el, () => {
      it.done = !it.done;
      voice.sayCard(card);
      if (it.done) logEvent({ kind: 'card', label: card.label, cardId: card.id, board: 'Agenda' });
      saveSchedule();
      renderMain();
    });
    list.append(el);
  });
  main.append(list);
}

function renderFirstThen(main) {
  const box = h('div', { class: 'ft' });
  const slot = (key, title) => {
    const card = S.cards.get(S.schedule[key]);
    const col = h('div', { class: 'ft-col' }, h('div', { class: 'ft-title' }, title));
    const el = card ? cardEl(card) : h('div', { class: 'slot-empty' }, h('span', {}, S.parent ? '+' : ''));
    if (S.parent) {
      el.addEventListener('click', async () => {
        const id = await pickCard('Elegir ficha para “' + title + '”');
        if (id) { S.schedule[key] = id; saveSchedule(); renderMain(); }
      });
    } else if (card) {
      bindActivate(el, () => {
        voice.speak(`${title}, ${card.speak || card.label}`);
        logEvent({ kind: 'card', label: card.label, cardId: card.id, board: 'Primero / Después' });
      });
    }
    col.append(el);
    return col;
  };
  box.append(slot('first', 'Primero'), h('div', { class: 'ft-arrow' }, '➜'), slot('then', 'Después'));
  main.append(box);
}

function fromSchedule() {
  const pending = S.schedule.items.filter(i => !i.done && S.cards.has(i.cardId));
  if (!pending.length) { toast('No hay actividades pendientes en la agenda'); return; }
  S.schedule.first = pending[0].cardId;
  S.schedule.then = pending[1] ? pending[1].cardId : null;
  saveSchedule();
  renderMain();
}

function editSchedule() {
  const m = modal('Editar agenda', { wide: true, onClose: renderMain });
  const list = h('div', { class: 'edit-list' });
  const draw = () => {
    list.innerHTML = '';
    S.schedule.items.forEach((it, i) => {
      const c = S.cards.get(it.cardId);
      if (!c) return;
      const up = h('button', { class: 'btn sm', disabled: i === 0 }, '▲');
      const down = h('button', { class: 'btn sm', disabled: i === S.schedule.items.length - 1 }, '▼');
      const rm = h('button', { class: 'btn sm danger' }, '✕');
      up.onclick = () => { const a = S.schedule.items; [a[i - 1], a[i]] = [a[i], a[i - 1]]; saveSchedule(); draw(); };
      down.onclick = () => { const a = S.schedule.items; [a[i + 1], a[i]] = [a[i], a[i + 1]]; saveSchedule(); draw(); };
      rm.onclick = () => { S.schedule.items.splice(i, 1); saveSchedule(); draw(); };
      list.append(h('div', { class: 'edit-row' }, h('b', {}, i + 1), cardEl(c, 'tiny'), h('span', { class: 'grow' }, c.label), up, down, rm));
    });
  };
  draw();
  const addBtn = h('button', { class: 'btn primary' }, '+ Agregar actividad');
  addBtn.onclick = async () => {
    const id = await pickCard('Agregar a la agenda', 'rutinas');
    if (id) { S.schedule.items.push({ cardId: id, done: false }); saveSchedule(); draw(); }
  };
  m.body.append(h('p', { class: 'muted small' }, 'La agenda se desmarca sola cada día nuevo. Las fichas de la carpeta “Rutinas” son ideales; puedes crear más con fotos reales.'), list, h('div', { class: 'row' }, addBtn));
}

// ---------- Elegir entre opciones ----------
function renderChoice(main) {
  const ch = S.choice;
  const cards = ch.cardIds.map(id => S.cards.get(id)).filter(Boolean);
  const q = h('div', { class: 'choice-q' }, h('span', { class: 'qtext' }, ch.question || ''));
  if (ch.question) {
    const sp = h('div', { class: 'navbtn' }, '🔊');
    bindActivate(sp, () => voice.speak(ch.question));
    q.prepend(sp);
  }
  if (S.parent) q.append(h('button', { class: 'btn primary', onclick: editChoice }, '✏️ Editar opciones'));
  const grid = h('div', { class: 'choice c' + Math.max(2, cards.length) });
  if (!cards.length) grid.append(h('p', { class: 'muted center' }, S.parent ? 'Elige de 2 a 4 fichas con “Editar opciones”.' : ''));
  cards.forEach(card => {
    const el = cardEl(card);
    if (S.chosen === card.id) el.classList.add('chosen');
    else if (S.chosen) el.classList.add('dim');
    if (!S.parent) bindActivate(el, () => {
      S.chosen = card.id;
      activateCard({ ...card, link: null }, 'Elegir');
      grid.querySelectorAll('.card').forEach(c => { c.classList.toggle('chosen', c === el); c.classList.toggle('dim', c !== el); });
    });
    grid.append(el);
  });
  main.append(q, grid);
}

export function editChoice() {
  const m = modal('Elegir entre opciones', { wide: true, onClose: () => { S.chosen = null; renderMain(); } });
  const qIn = h('input', { type: 'text', value: S.choice.question || '', placeholder: '¿Qué quieres comer?' });
  qIn.oninput = () => { S.choice.question = qIn.value; saveChoice(); };
  const list = h('div', { class: 'edit-list' });
  const draw = () => {
    list.innerHTML = '';
    S.choice.cardIds.forEach((id, i) => {
      const c = S.cards.get(id);
      if (!c) return;
      const rm = h('button', { class: 'btn sm danger' }, '✕');
      rm.onclick = () => { S.choice.cardIds.splice(i, 1); saveChoice(); draw(); };
      list.append(h('div', { class: 'edit-row' }, cardEl(c, 'tiny'), h('span', { class: 'grow' }, c.label), rm));
    });
    addBtn.disabled = S.choice.cardIds.length >= 4;
  };
  const addBtn = h('button', { class: 'btn primary' }, '+ Agregar opción');
  addBtn.onclick = async () => {
    const id = await pickCard('Agregar opción');
    if (id && !S.choice.cardIds.includes(id)) { S.choice.cardIds.push(id); saveChoice(); draw(); }
  };
  draw();
  m.body.append(
    h('label', { class: 'field' }, h('span', {}, 'Pregunta (se puede escuchar con 🔊)'), qIn),
    h('p', { class: 'muted small' }, 'Elige de 2 a 4 fichas. Se mostrarán grandes para que él escoja.'),
    list, h('div', { class: 'row' }, addBtn));
}
