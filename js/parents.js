// Modo Padres: entrada protegida, edición de fichas y carpetas, ajustes, respaldo, ARASAAC.
import * as db from './db.js';
import {
  S, COLORS, DEFAULT_SETTINGS, cardEl, cardsOf, firstFreeSlot, cardAt, slotOf, sameSlot, parseSlot, inGrid, gridOf,
  saveCard, saveBoard, saveSettings, slotsFromPos,
  setParent, render, renderMain, renderQuick, gcMedia, seedDefaults, applySettings,
} from './app.js';
import * as voice from './speech.js';
import { h, modal, toast, confirmBox, shareOrDownload, today } from './ui.js';
import { openLog } from './log.js';
import { editChoice } from './special.js';
import { openImport } from './importer.js';
import { openSearch } from './search.js';

const ARASAAC_API = 'https://api.arasaac.org/v1/pictograms/es';
const arasaacImg = id => S.settings.arasaacColor ? `https://static.arasaac.org/pictograms/${id}/${id}_500.png` : `https://api.arasaac.org/v1/pictograms/${id}?color=false&resolution=500&download=false`;
const arasaacThumb = id => S.settings.arasaacColor ? `https://static.arasaac.org/pictograms/${id}/${id}_300.png` : `https://api.arasaac.org/v1/pictograms/${id}?color=false&resolution=500&download=false`;

// ---------- Entrada protegida ----------
// Tuerca discreta: gris, plana y chica, para que no llame la atención del niño
const GEAR_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
export function gateButton() {
  if (S.parent) return h('div', { class: 'gate placeholder' });
  // Un toque abre la pregunta; la suma (o el PIN) es lo que protege del niño.
  return h('button', { class: 'gate', type: 'button', 'aria-label': 'Configuración (Modo Padres)', onclick: gate, html: GEAR_SVG });
}

function gate() {
  const pin = S.settings.pin;
  const a = 3 + Math.floor(Math.random() * 7);
  const c = 4 + Math.floor(Math.random() * 6);
  const m = modal('Configuración (Modo Padres)');
  const input = h('input', { type: pin ? 'password' : 'text', inputmode: 'numeric', autocomplete: 'off', class: 'big-input', maxlength: '8' });
  const msg = h('p', { class: 'error' });
  const ok = () => {
    const v = input.value.trim();
    if ((pin && v === pin) || (!pin && Number(v) === a + c)) { m.close(); setParent(true); }
    else { msg.textContent = 'No es correcto. Intenta de nuevo.'; input.value = ''; input.focus(); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
  m.body.append(
    h('p', { class: 'gate-q' }, pin ? 'Escribe el PIN' : `¿Cuánto es ${a} + ${c}?`),
    input, msg,
    h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: ok }, 'Entrar')));
  setTimeout(() => input.focus(), 50);
}

export function toolbar() {
  const b = (txt, fn) => h('button', { class: 'btn', onclick: fn }, txt);
  return h('div', { class: 'ptoolbar' },
    h('span', { class: 'pbadge' }, '🔧 Modo Padres'),
    b('➕ Nueva ficha', () => newCard(S.boards.get(S.board)?.special ? 'home' : S.board, null)),
    h('button', { class: 'btn primary', onclick: openMenuPicker }, '🧩 Elegir qué ve el niño'),
    b('🔎 Buscar', openSearch),
    b('📥 Importar pictogramas', openImport),
    b('⚙️ Ajustes', openSettings),
    b('🔲 Tamaño de esta pantalla', openBoardGrid),
    b('💾 Respaldo', openBackup),
    b('📊 Registro', openLog),
    b('🖼️ ARASAAC', openArasaacBulk),
    b('🤔 Elegir', () => { S.board = 'elegir'; renderMain(); editChoice(); }),
    b('🔒 Bloqueo', openLockHelp),
    b('🔄 Actualizar', checkUpdate),
    b('ℹ️ Acerca de', openAbout),
    h('button', { class: 'btn primary', onclick: () => { setParent(false); } }, '✅ Salir'),
    h('span', { class: 'phint' }, 'Toca una ficha para editarla · 👁 / 🚫 la muestra o la esconde · arrástrala para moverla · + para crear'));
}

// ---------- Mover fichas arrastrando ----------
export function bindParentCard(el, card) {
  el.addEventListener('pointerdown', e => {
    if (e.button && e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    let ghost = null;
    let target = null;
    const move = ev => {
      if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 12) {
        const r = el.getBoundingClientRect();
        ghost = el.cloneNode(true);
        ghost.classList.add('drag-ghost');
        Object.assign(ghost.style, { width: r.width + 'px', height: r.height + 'px' });
        document.body.append(ghost);
        el.classList.add('dragging');
      }
      if (ghost) {
        ev.preventDefault();
        ghost.style.transform = `translate(${ev.clientX - 40}px, ${ev.clientY - 40}px)`;
        const t = document.elementFromPoint(ev.clientX, ev.clientY);
        const slot = t && t.closest('[data-slot], [data-pagejump]');
        if (target && target !== slot) target.classList.remove('drop');
        target = slot;
        if (target) target.classList.add('drop');
      }
    };
    const up = async ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!ghost) { if (ev.type === 'pointerup') editCard(card); return; }
      ghost.remove();
      el.classList.remove('dragging');
      if (!target) return;
      target.classList.remove('drop');
      if (target.dataset.pagejump) {
        const dir = Number(target.dataset.pagejump);
        const page = Math.max(0, S.page + dir);
        await moveCard(card, firstFreeSlot(card.boardId, page));
        S.page = page;
      } else {
        await moveCard(card, parseSlot(target.dataset.slot));
      }
      renderMain();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

// Mover a propósito: si la casilla está ocupada, las dos fichas intercambian lugar
async function moveCard(card, slot) {
  if (sameSlot(card, slot)) return;
  const other = cardAt(card.boardId, slot, card.id);
  if (other) await saveCard({ ...other, ...slotOf(card) });
  await saveCard({ ...card, ...slot });
}

// ---------- Editor de fichas ----------
export function newCard(boardId, slot) {
  if (slot == null) slot = firstFreeSlot(boardId);
  editCard({
    id: db.uid('c'), boardId, ...slot, label: '', speak: '', emoji: '', color: boardId === 'personas' ? 'persona' : boardId === 'lugares' ? 'lugar' : 'cosa',
    type: 'word', link: null, q: '', hidden: false, image: null, audio: null, _new: true,
  });
}

export async function resizeImage(file, max = 640) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), hh = Math.round(img.naturalHeight * scale);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = hh;
    const ctx = cv.getContext('2d');
    const png = file.type === 'image/png';
    if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh); }
    ctx.drawImage(img, 0, 0, w, hh);
    return await new Promise(res => cv.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}

const boardOptions = (exclude = []) => [...S.boards.values()].filter(b => !exclude.includes(b.id));

export function editCard(card) {
  const isNew = !!card._new;
  const d = { ...card };
  delete d._new;
  const m = modal(isNew ? 'Nueva ficha' : 'Editar ficha', { wide: true });

  const preview = h('div', { class: 'preview' });
  const drawPreview = () => { preview.innerHTML = ''; preview.append(cardEl(d)); };

  // Imagen
  const fileCam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const fileGal = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const useFile = async (f) => {
    if (!f || !f.type.startsWith('image/')) return;
    try {
      const blob = await resizeImage(f);
      const id = await db.saveMedia(blob);
      await db.mediaURL(id);
      d.image = { kind: 'media', id };
      drawPreview();
    } catch (e) { toast('No se pudo usar esa imagen'); }
  };
  fileCam.onchange = () => useFile(fileCam.files[0]);
  fileGal.onchange = () => useFile(fileGal.files[0]);
  preview.addEventListener('dragover', e => { e.preventDefault(); preview.classList.add('drop'); });
  preview.addEventListener('dragleave', () => preview.classList.remove('drop'));
  preview.addEventListener('drop', e => { e.preventDefault(); preview.classList.remove('drop'); useFile(e.dataTransfer.files[0]); });
  const emojiIn = h('input', { type: 'text', value: d.emoji || '', placeholder: '🙂', class: 'emoji-in', maxlength: '8' });
  emojiIn.oninput = () => { d.emoji = emojiIn.value.trim(); d.icon = null; drawPreview(); };

  const imgBtns = h('div', { class: 'row wrap' },
    h('button', { class: 'btn', onclick: () => fileCam.click() }, '📷 Tomar foto'),
    h('button', { class: 'btn', onclick: () => fileGal.click() }, '🖼️ Galería / archivo'),
    h('button', { class: 'btn', onclick: () => searchArasaac(labelIn.value || d.label, img => { d.image = img; drawPreview(); }) }, '🔎 Buscar en ARASAAC'),
    h('button', { class: 'btn', onclick: () => { d.image = null; d.icon = null; drawPreview(); } }, '🗑 Quitar imagen'),
    fileCam, fileGal);

  // Textos
  const labelIn = h('input', { type: 'text', value: d.label, placeholder: 'Ej.: Plaza Vea' });
  labelIn.oninput = () => { d.label = labelIn.value; drawPreview(); };
  const speakIn = h('input', { type: 'text', value: d.speak || '', placeholder: 'Igual que el texto que se muestra' });
  speakIn.oninput = () => { d.speak = speakIn.value; };
  const testBtn = h('button', { class: 'btn' }, '🔊 Probar');
  testBtn.onclick = () => voice.sayCard({ ...d, label: labelIn.value, speak: speakIn.value });

  // Voz grabada
  const rec = recorderUI(d);

  // Color
  const colors = h('div', { class: 'colors' });
  const drawColors = () => {
    colors.innerHTML = '';
    for (const [k, v] of Object.entries(COLORS)) {
      const b = h('button', { class: 'chip c-' + k + (d.color === k ? ' on' : ''), type: 'button' }, h('i', { style: { background: v.hex } }), v.name);
      b.onclick = () => { d.color = k; drawColors(); drawPreview(); };
      colors.append(b);
    }
  };
  drawColors();

  // Tipo y enlace
  const typeSel = h('select', {},
    h('option', { value: 'word', selected: d.type === 'word' }, 'Palabra (habla y se agrega a la frase)'),
    h('option', { value: 'folder', selected: d.type === 'folder' }, 'Carpeta (abre otro tablero)'));
  const linkSel = h('select');
  const drawLink = () => {
    linkSel.innerHTML = '';
    if (d.type === 'folder') linkSel.append(h('option', { value: '__new' }, '➕ Crear carpeta nueva'));
    else linkSel.append(h('option', { value: '' }, '— Nada —'));
    for (const b of boardOptions(['quick', d.boardId])) linkSel.append(h('option', { value: b.id, selected: d.link === b.id }, b.name));
    if (d.type === 'folder' && !d.link) linkSel.value = '__new';
  };
  typeSel.onchange = () => { d.type = typeSel.value; if (d.type === 'folder' && d.color !== 'carpeta') { d.color = 'carpeta'; drawColors(); } drawLink(); linkLabel.firstChild.textContent = d.type === 'folder' ? 'Abre la carpeta' : 'Además, al tocar abre'; drawPreview(); };
  linkSel.onchange = () => { d.link = linkSel.value || null; };
  drawLink();
  const linkLabel = h('label', { class: 'field' }, h('span', {}, d.type === 'folder' ? 'Abre la carpeta' : 'Además, al tocar abre'), linkSel);

  // Ubicación
  const boardSel = h('select', {}, boardOptions().map(b => h('option', { value: b.id, selected: d.boardId === b.id }, b.name)));
  const gd = gridOf(d.boardId);
  const pIn = h('input', { type: 'number', min: 1, value: (d.page || 0) + 1, class: 'num-in' });
  const rIn = h('input', { type: 'number', min: 1, max: gd.rows, value: d.row + 1, class: 'num-in' });
  const cIn = h('input', { type: 'number', min: 1, max: gd.cols, value: d.col + 1, class: 'num-in' });
  const hiddenChk = h('input', { type: 'checkbox', checked: !!d.hidden });

  const save = async () => {
    d.label = labelIn.value.trim();
    d.speak = speakIn.value.trim();
    if (!d.label) { toast('Escribe el texto de la ficha'); labelIn.focus(); return; }
    d.hidden = hiddenChk.checked;
    if (d.type === 'folder') {
      if (!d.link || d.link === '__new' || !S.boards.has(d.link)) {
        const b = { id: db.uid('b'), name: d.label };
        await saveBoard(b);
        d.link = b.id;
      } else {
        const b = S.boards.get(d.link);
        if (!b.special && b.name !== d.label && b.id !== 'home') { b.name = d.label; await saveBoard(b); }
      }
    } else if (d.link === '__new') d.link = null;
    // Ubicación
    const newBoard = boardSel.value;
    let slot;
    if (newBoard !== card.boardId) slot = firstFreeSlot(newBoard);
    else if (d.boardId === 'quick') slot = slotOf(d);
    else {
      const num = (inp, max) => Math.min(max, Math.max(1, Number(inp.value) || 1)) - 1;
      slot = { page: num(pIn, 99), row: num(rIn, gd.rows), col: num(cIn, gd.cols) };
    }
    d.boardId = newBoard;
    const other = cardAt(newBoard, slot, d.id);
    if (other) {
      if (!isNew && newBoard === card.boardId) await saveCard({ ...other, ...slotOf(card) });
      else slot = firstFreeSlot(newBoard, slot.page);
    }
    Object.assign(d, slot);
    delete d.pos;
    await saveCard(d);
    m.close();
    await gcMedia();
    render();
  };

  const dup = async () => {
    const copy = { ...d, id: db.uid('c'), ...firstFreeSlot(d.boardId, d.page || 0), label: d.label };
    await saveCard(copy);
    m.close();
    render();
    toast('Ficha duplicada');
  };

  const remove = async () => {
    let msg = `¿Eliminar la ficha “${d.label}”?`;
    let toDelete = [card.id];
    if (card.type === 'folder' && card.link && S.boards.has(card.link) && !S.boards.get(card.link).special && card.link !== 'home') {
      const collect = (bid, seen = new Set()) => {
        if (seen.has(bid)) return [];
        seen.add(bid);
        const inside = cardsOf(bid);
        let ids = inside.map(c => c.id);
        for (const c of inside) if (c.type === 'folder' && c.link && !S.boards.get(c.link)?.special) ids = ids.concat(collect(c.link, seen));
        return ids;
      };
      const inner = collect(card.link);
      msg = `¿Eliminar la carpeta “${d.label}” y sus ${inner.length} fichas? No se puede deshacer (salvo con un respaldo).`;
      toDelete = toDelete.concat(inner);
    }
    if (!(await confirmBox(msg, { ok: 'Eliminar', danger: true }))) return;
    for (const id of toDelete) { S.cards.delete(id); await db.del('cards', id); }
    m.close();
    await gcMedia();
    render();
  };

  const isQuick = d.boardId === 'quick';
  m.body.append(
    h('div', { class: 'editor' },
      h('div', { class: 'ed-left' },
        preview,
        h('p', { class: 'muted small center' }, 'En la computadora puedes arrastrar una foto aquí.'),
        imgBtns,
        h('label', { class: 'field' }, h('span', {}, 'O usa un emoji'), emojiIn)),
      h('div', { class: 'ed-right' },
        h('label', { class: 'field' }, h('span', {}, 'Texto que se muestra'), labelIn),
        h('label', { class: 'field' }, h('span', {}, 'Texto que se pronuncia (opcional)'), h('div', { class: 'row' }, speakIn, testBtn)),
        rec,
        h('div', { class: 'field' }, h('span', {}, 'Color / categoría'), colors),
        h('label', { class: 'field' }, h('span', {}, 'Tipo'), typeSel),
        linkLabel,
        h('label', { class: 'field' }, h('span', {}, 'Está en el tablero'), boardSel),
        isQuick ? null : h('div', { class: 'field' }, h('span', {}, 'Posición (también puedes arrastrarla)'),
          h('div', { class: 'row' }, 'Página', pIn, 'Fila', rIn, 'Columna', cIn)),
        h('label', { class: 'check' }, hiddenChk, ' Ocultar al niño (su lugar queda vacío y nada se mueve)'))),
    h('div', { class: 'row wrap end sticky-actions' },
      isNew ? null : h('button', { class: 'btn danger', onclick: remove }, '🗑 Eliminar'),
      isNew ? null : h('button', { class: 'btn', onclick: dup }, '⧉ Duplicar'),
      h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'),
      h('button', { class: 'btn primary', onclick: save }, '💾 Guardar')));
  drawPreview();
  if (isNew) setTimeout(() => labelIn.focus(), 50);
}

function recorderUI(d) {
  const box = h('div', { class: 'field' }, h('span', {}, 'Voz grabada (mamá o papá) — reemplaza la voz sintética'));
  const row = h('div', { class: 'row wrap' });
  const status = h('span', { class: 'muted small' });
  let mr = null, chunks = [], stopTimer = null, stream = null;
  const draw = () => {
    row.innerHTML = '';
    if (mr && mr.state === 'recording') {
      row.append(h('button', { class: 'btn danger', onclick: stopRec }, '■ Detener'), h('span', { class: 'rec-dot' }, '● Grabando…'));
      return;
    }
    row.append(h('button', { class: 'btn', onclick: startRec }, d.audio ? '● Grabar de nuevo' : '● Grabar voz'));
    if (d.audio) {
      row.append(h('button', { class: 'btn', onclick: () => voice.playMedia(d.audio, d.label) }, '▶ Escuchar'),
        h('button', { class: 'btn', onclick: () => { d.audio = null; draw(); } }, '🗑 Quitar voz'));
    }
    row.append(status);
  };
  async function startRec() {
    if (!navigator.mediaDevices || !window.MediaRecorder) { status.textContent = 'Este navegador no permite grabar audio.'; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) { status.textContent = 'No hay permiso para usar el micrófono.'; return; }
    const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
    const type = types.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks = [];
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      clearTimeout(stopTimer);
      const blob = new Blob(chunks, { type: mr.mimeType || type || 'audio/webm' });
      if (blob.size > 0) {
        d.audio = await db.saveMedia(blob);
        await db.mediaURL(d.audio);
        status.textContent = '';
      }
      mr = null;
      draw();
    };
    mr.start();
    stopTimer = setTimeout(stopRec, 10000);
    draw();
  }
  function stopRec() { if (mr && mr.state === 'recording') mr.stop(); }
  draw();
  box.append(row);
  return box;
}

// ---------- Selector de fichas ----------
export function pickCard(title, preferBoard) {
  return new Promise(resolve => {
    let done = false;
    const m = modal(title, { wide: true, onClose: () => { if (!done) resolve(null); } });
    const search = h('input', { type: 'search', placeholder: 'Buscar ficha…' });
    const boardSel = h('select', {}, h('option', { value: '' }, 'Todas las carpetas'),
      [...S.boards.values()].filter(b => !b.special).map(b => h('option', { value: b.id, selected: b.id === preferBoard }, b.name)));
    const grid = h('div', { class: 'pick-grid' });
    const draw = () => {
      grid.innerHTML = '';
      const q = search.value.trim().toLowerCase();
      const list = [...S.cards.values()].filter(c => c.type === 'word' && (!boardSel.value || c.boardId === boardSel.value) && (!q || c.label.toLowerCase().includes(q)));
      list.sort((a, b) => a.label.localeCompare(b.label, 'es'));
      for (const c of list.slice(0, 200)) {
        const el = cardEl(c);
        el.onclick = () => { done = true; m.close(); resolve(c.id); };
        grid.append(el);
      }
      if (!list.length) grid.append(h('p', { class: 'muted' }, 'No hay fichas.'));
    };
    search.oninput = draw;
    boardSel.onchange = draw;
    m.body.append(h('div', { class: 'row' }, search, boardSel), grid);
    draw();
  });
}

// ---------- ARASAAC ----------
async function arasaacSearch(q, best = false) {
  const r = await fetch(`${ARASAAC_API}/${best ? 'bestsearch' : 'search'}/${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  return r.json();
}

async function downloadArasaac(id) {
  const url = arasaacImg(id);
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error('http');
    const blob = await r.blob();
    const mid = await db.saveMedia(blob);
    await db.mediaURL(mid);
    return { kind: 'media', id: mid, arasaac: id };
  } catch (e) {
    // Si no se puede descargar directamente, se guarda en la caché sin conexión
    try { const c = await caches.open('arasaac'); const resp = await fetch(url, { mode: 'no-cors' }); await c.put(url, resp); } catch (e2) {}
    return { kind: 'url', url, arasaac: id };
  }
}

function searchArasaac(initial, onPick) {
  const m = modal('Buscar en ARASAAC', { wide: true });
  const input = h('input', { type: 'search', value: initial || '', placeholder: 'Ej.: supermercado, pelota, columpio' });
  const results = h('div', { class: 'pick-grid' });
  const go = async () => {
    const q = input.value.trim();
    if (!q) return;
    if (!navigator.onLine) { results.innerHTML = ''; results.append(h('p', { class: 'muted' }, 'Necesitas internet para buscar. Las imágenes elegidas quedan guardadas para usarse sin conexión.')); return; }
    results.innerHTML = '<p class="muted">Buscando…</p>';
    try {
      const list = await arasaacSearch(q);
      results.innerHTML = '';
      if (!list.length) results.append(h('p', { class: 'muted' }, 'Sin resultados. Prueba con otra palabra (por ejemplo, la palabra usada en España).'));
      for (const p of list.slice(0, 60)) {
        const kw = (p.keywords && p.keywords[0] && p.keywords[0].keyword) || q;
        const el = h('div', { class: 'card c-cosa ara' }, h('div', { class: 'pic' }, h('img', { src: arasaacThumb(p._id), alt: kw, loading: 'lazy' })), h('div', { class: 'label' }, kw));
        el.onclick = async () => {
          el.classList.add('loading');
          const img = await downloadArasaac(p._id);
          m.close();
          onPick(img);
        };
        results.append(el);
      }
    } catch (e) {
      results.innerHTML = '';
      results.append(h('p', { class: 'muted' }, 'No se pudo conectar con ARASAAC. Revisa la conexión a internet.'));
    }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  m.body.append(h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: go }, 'Buscar')), results,
    h('p', { class: 'muted small' }, 'Pictogramas de ARASAAC (Gobierno de Aragón, autor Sergio Palao), licencia CC BY-NC-SA.'));
  if (initial) go();
}

function openArasaacBulk() {
  let stop = false;
  const m = modal('Pictogramas ARASAAC', { wide: true, onClose: () => { stop = true; } });
  const pending = [...S.cards.values()].filter(c => !c.image && !c.icon);
  const status = h('p', { class: 'muted' });
  const bar = h('div', { class: 'progress' }, h('i'));
  const start = h('button', { class: 'btn primary' }, `Poner pictogramas a ${pending.length} fichas`);
  start.onclick = async () => {
    if (!navigator.onLine) { status.textContent = 'Necesitas internet para descargar los pictogramas.'; return; }
    start.disabled = true;
    let done = 0, ok = 0;
    const queue = pending.slice();
    const worker = async () => {
      while (queue.length && !stop) {
        const c = queue.shift();
        try {
          let list = [];
          for (const q of [c.q, c.label].filter(Boolean)) {
            list = await arasaacSearch(q, true).catch(() => []);
            if (!list.length) list = await arasaacSearch(q).catch(() => []);
            if (list.length) break;
          }
          if (list.length) {
            const img = await downloadArasaac(list[0]._id);
            const fresh = S.cards.get(c.id);
            if (fresh && !fresh.image) { fresh.image = img; await saveCard(fresh); ok++; }
          }
        } catch (e) {}
        done++;
        bar.firstChild.style.width = (done / pending.length * 100) + '%';
        status.textContent = `${done} de ${pending.length}…`;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    status.textContent = `Listo: ${ok} fichas ahora tienen pictograma ARASAAC. Las que no encontraron uno conservan su emoji. Revisa y cambia las que no te gusten (toca la ficha → Buscar en ARASAAC).`;
    render();
  };
  m.body.append(
    h('p', {}, 'Esto reemplaza los emojis del vocabulario por pictogramas de ARASAAC (los mismos que se usan en muchos colegios), en blanco y negro para que sean neutros (se puede cambiar a color en Ajustes). Necesita internet solo esta vez; después quedan guardados en el dispositivo.'),
    h('p', { class: 'muted small' }, 'Las fichas que ya tienen foto o imagen no se tocan. Puedes elegir otro pictograma para cualquier ficha desde su editor.'),
    start, bar, status);
}

// ---------- Elegir qué menús y botones ve cada niño ----------
// Esconder o mostrar solo cambia "hidden": las demás fichas no se mueven y el hueco queda.
// Única excepción: una ficha escondida que estaba fuera de lo que el niño ve (fuera de la
// cuadrícula o después de la página 1, que es la única que él tiene) pasa a la primera
// casilla de su página que esté vacía o tenga otra ficha escondida (esa toma su lugar
// anterior y sigue escondida). El niño nunca vio ninguna de las dos en esos lugares.
export const seenByChild = c => !c.hidden && (c.boardId === 'quick' || ((c.page || 0) === 0 && inGrid(c)));
function holeForChild(boardId, exceptId) {
  const g = gridOf(boardId);
  for (let row = 0; row < g.rows; row++) for (let col = 0; col < g.cols; col++) {
    const slot = { page: 0, row, col };
    const other = cardAt(boardId, slot, exceptId);
    if (!other || other.hidden) return { slot, other };
  }
  return null;
}
export async function setVisible(boardId, card, visible, quiet = false) {
  const c = { ...card, hidden: !visible };
  if (visible && boardId !== 'quick' && !seenByChild(c)) {
    const hole = holeForChild(boardId, card.id);
    if (hole) {
      if (hole.other) await saveCard({ ...hole.other, ...slotOf(card) });
      Object.assign(c, hole.slot);
    } else if (!quiet) toast(`“${card.label}” no cabe en la página 1: desmarca otra ficha primero para dejarle un hueco.`, 5000);
  }
  await saveCard(c);
  return c;
}

export function openMenuPicker() {
  const cur = S.boards.get(S.board);
  const inMenu = cur && !cur.special && !['home', 'quick'].includes(cur.id);
  const m = modal(inMenu ? 'Elegir fichas de “' + cur.name + '”' : 'Elegir menús y botones', { wide: true, onClose: () => { if (!inMenu) S.board = 'home'; S.page = 0; render(); } });
  const section = (title, help, boardId, filter) => {
    const box = h('div', { class: 'pick-list' });
    const draw = () => {
      box.innerHTML = '';
      for (const c of cardsOf(boardId).filter(filter).sort((a, b) => a.label.localeCompare(b.label, 'es'))) {
        const seen = seenByChild(c);
        const chk = h('input', { type: 'checkbox', checked: seen });
        chk.onchange = async () => { await setVisible(boardId, S.cards.get(c.id), chk.checked); draw(); };
        box.append(h('label', { class: 'pick-item' + (seen ? ' on' : '') }, chk, cardEl(c, 'tiny'),
          h('span', {}, c.label, !c.hidden && !seen ? h('small', { class: 'muted' }, ' (no cabe)') : null)));
      }
    };
    draw();
    return h('section', {}, h('h3', {}, title), h('p', { class: 'muted small' }, help), box);
  };
  if (inMenu) {
    m.body.append(h('p', {}, 'Marca solo lo que este niño necesita ver en este menú. Lo desmarcado no se borra: queda escondido y se puede volver a marcar.'), insideMenus(cur.id));
    return;
  }
  m.body.append(
    h('p', {}, 'Marca lo que este niño necesita ver. Lo que no está marcado queda guardado y escondido; se puede volver a marcar cuando quieras. Esconder deja la casilla vacía: las demás fichas no se mueven.'),
    section('Menús del Inicio', 'Carpetas grandes de la pantalla principal. Si el Inicio está lleno, un menú nuevo aparece en otra página: primero agranda el Inicio en “🔲 Tamaño de esta pantalla” (no mueve nada) y después márcalo.', 'home', c => c.type === 'folder'),
    section('Palabras sueltas en el Inicio', 'Palabras de uso frecuente (yo, quiero, más…). Recomendado solo cuando ya maneja los menús.', 'home', c => c.type !== 'folder'),
    section('Barra de abajo (urgencias)', 'Botones que se ven siempre, en todas las pantallas.', 'quick', () => true),
    insideMenus(),
  );

  // Fichas dentro de cada menú (qué comidas, qué lugares, qué juguetes…)
  function insideMenus(only) {
    const menus = only ? [{ link: only, label: S.boards.get(only).name, hidden: false }]
      : cardsOf('home').filter(c => c.type === 'folder' && c.link && S.boards.has(c.link) && !S.boards.get(c.link).special)
        .sort((a, b) => a.hidden - b.hidden);
    if (!menus.length) return null;
    const sel = h('select', {}, menus.map(c => h('option', { value: c.link }, c.label + (c.hidden ? ' (escondido)' : ''))));
    const holder = h('div');
    const all = (on) => async () => {
      let left = 0;
      for (const c of cardsOf(sel.value)) if (seenByChild(c) !== on) left += seenByChild(await setVisible(sel.value, S.cards.get(c.id), on, true)) === on ? 0 : 1;
      if (left) toast(`${left} ficha(s) no caben en la página 1 y quedan guardadas.`, 4000);
      draw();
    };
    const draw = () => {
      holder.innerHTML = '';
      holder.append(section('Fichas de “' + S.boards.get(sel.value).name + '”', 'Lo desmarcado no lo ve el niño y su casilla queda vacía; las demás fichas no se mueven.', sel.value, () => true));
    };
    sel.onchange = draw;
    draw();
    return h('section', {}, only ? null : h('h3', {}, 'Dentro de cada menú'),
      h('div', { class: 'row wrap' }, only ? null : h('label', { class: 'field inline' }, h('span', {}, 'Menú'), sel),
        h('button', { class: 'btn', onclick: all(true) }, 'Marcar todas'),
        h('button', { class: 'btn', onclick: all(false) }, 'Desmarcar todas')),
      holder);
  }
}

// ---------- Cuadrícula propia de un tablero ----------
function openBoardGrid() {
  const b = S.boards.get(S.board);
  if (!b || b.special) { toast('Abre una carpeta normal o el Inicio para cambiar su tamaño'); return; }
  const m = modal('Tamaño de “' + b.name + '”', { wide: true, onClose: () => render() });
  const set = async (cols, rows) => {
    const next = cols ? { cols, rows } : { cols: S.settings.cols, rows: S.settings.rows };
    if (!(await confirmGrid([b.id], next))) return;
    const nb = { ...b };
    if (cols) { nb.cols = cols; nb.rows = rows; nb.manualGrid = true; } else { delete nb.cols; delete nb.rows; delete nb.manualGrid; }
    await saveBoard(nb);
    m.close();
  };
  const g = gridOf(b.id);
  m.body.append(
    h('p', {}, 'Elige cuántas fichas grandes se ven en esta pantalla (columnas × filas). Las demás carpetas siguen con el tamaño general de Ajustes.'),
    h('div', { class: 'row wrap' }, [[1, 1], [2, 1], [2, 2], [3, 2], [5, 1], [3, 3], [4, 3], [4, 4], [5, 4], [6, 5], [8, 5]].map(([c, r]) =>
      h('button', { class: 'btn' + (b.cols === c && b.rows === r ? ' on' : ''), onclick: () => set(c, r) }, `${c}×${r}`))),
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: () => set(null) }, `Usar el tamaño general (${S.settings.cols}×${S.settings.rows})`)),
    h('p', { class: 'muted small' }, `Ahora: ${g.cols}×${g.rows}. Agrandar agrega filas y columnas vacías sin mover nada. Achicar no borra fichas: las que no caben quedan guardadas y escondidas para el niño.`));
}

// Aviso antes de cambiar una cuadrícula: cuántas fichas quedarían fuera (no se borran)
async function confirmGrid(boardIds, next) {
  const out = [...S.cards.values()].filter(c => boardIds.includes(c.boardId) && !c.hidden && !inGrid(c, next));
  const msg = `La pantalla quedará de ${next.cols}×${next.rows}. Las fichas no se mueven de su lugar.` +
    (out.length ? ` ${out.length} ficha(s) no caben (${out.slice(0, 6).map(c => c.label).join(', ')}${out.length > 6 ? '…' : ''}): quedan guardadas, pero el niño no las verá hasta que agrandes la pantalla o las muevas.` : '') +
    ' Cambia la cuadrícula pocas veces: él recuerda dónde está cada ficha.';
  return confirmBox(msg, { ok: 'Cambiar', danger: out.length > 0 });
}

// Modo Padres: fichas guardadas fuera de la cuadrícula actual
// Modo Padres: fichas que el niño no ve porque están fuera de la cuadrícula o después de la página 1
export function outsideNotice(cards, g) {
  // Plegado: una sola línea para que el adulto siga viendo la página del niño
  return h('details', { class: 'outside-note' },
    h('summary', {}, `El niño solo ve la página 1 (${g.cols}×${g.rows}). ${cards.length} ficha(s) guardadas que él no ve`),
    h('div', { class: 'outside-list' },
      cards.map(c => { const b = h('button', { class: 'btn sm' }, c.label); b.onclick = () => editCard(c); return b; }),
      h('span', { class: 'muted small' }, ' Para ponerla en la página 1: en “🧩 Elegir qué ve el niño” desmarca otra y marca esta, o tócala aquí y elige fila y columna.')));
}

// ---------- Ajustes ----------
function openSettings() {
  const s = S.settings;
  const m = modal('Ajustes', { wide: true, onClose: () => render() });
  const set = (k, v) => { s[k] = v; saveSettings(); };

  // Voz
  const voices = voice.spanishVoices();
  const vSel = h('select', {}, h('option', { value: '' }, 'Automática (prefiere es-PE, es-MX, es-US)'),
    voices.map(v => h('option', { value: v.voiceURI, selected: s.voiceURI === v.voiceURI }, `${v.name} (${v.lang})`)));
  vSel.onchange = () => set('voiceURI', vSel.value || null);
  const range = (k, min, max, step, fmt) => {
    const out = h('b', {}, fmt(s[k]));
    const r = h('input', { type: 'range', min, max, step, value: s[k] });
    r.oninput = () => { out.textContent = fmt(r.value); set(k, Number(r.value)); };
    return h('div', { class: 'row' }, r, out);
  };
  const sel = (k, opts) => {
    const e = h('select', {}, opts.map(([v, t]) => h('option', { value: v, selected: String(s[k]) === String(v) }, t)));
    e.onchange = () => set(k, typeof s[k] === 'number' ? Number(e.value) : e.value);
    return e;
  };
  const chk = (k, text) => {
    const c = h('input', { type: 'checkbox', checked: !!s[k] });
    c.onchange = () => set(k, c.checked);
    return h('label', { class: 'check' }, c, ' ' + text);
  };
  const nums = n => Array.from({ length: n }, (_, i) => [i + 1, String(i + 1)]);
  const setGeneralGrid = async (cols, rows) => {
    const affected = [...S.boards.values()].filter(b => !b.special && b.id !== 'quick' && !(b.cols && b.rows)).map(b => b.id);
    if (!(await confirmGrid(affected, { cols, rows }))) return false;
    s.cols = cols; s.rows = rows; await saveSettings();
    return true;
  };
  const ownGrids = [...S.boards.values()].filter(b => !b.special && b.id !== 'quick' && b.cols && b.rows && (b.cols !== s.cols || b.rows !== s.rows));
  const sameSizeEverywhere = async (list) => {
    if (!(await confirmGrid(list.map(b => b.id), { cols: s.cols, rows: s.rows }))) return false;
    for (const b of list) { const nb = { ...b }; delete nb.cols; delete nb.rows; delete nb.manualGrid; await saveBoard(nb); }
    return true;
  };
  const gridSel = (k, n) => {
    const e = h('select', {}, nums(n).map(([v, t]) => h('option', { value: v, selected: s[k] === v }, t)));
    e.onchange = async () => {
      const v = Number(e.value);
      if (!(await setGeneralGrid(k === 'cols' ? v : s.cols, k === 'rows' ? v : s.rows))) e.value = s[k];
    };
    return e;
  };
  const presets = h('div', { class: 'row wrap' }, [[2, 2], [3, 3], [4, 4], [4, 5], [5, 6], [6, 5], [7, 6], [8, 6]].map(([c, r]) => {
    const b = h('button', { class: 'btn sm' + (s.cols === c && s.rows === r ? ' on' : '') }, `${c}×${r}`);
    b.onclick = async () => { if (await setGeneralGrid(c, r)) { m.close(); openSettings(); } };
    return b;
  }));
  const pinIn = h('input', { type: 'text', inputmode: 'numeric', value: s.pin || '', placeholder: 'Vacío = resolver una suma', maxlength: '8' });
  pinIn.onchange = () => set('pin', pinIn.value.replace(/\D/g, ''));

  m.body.append(
    h('section', {}, h('h3', {}, '🔊 Voz'),
      voices.length ? null : h('p', { class: 'warn' }, 'No se encontraron voces en español en este equipo. En Android instala “Servicios de voz de Google” y descarga la voz en español; en iPhone/iPad ve a Ajustes → Accesibilidad → Contenido leído → Voces → Español.'),
      h('label', { class: 'field' }, h('span', {}, 'Voz'), vSel),
      h('label', { class: 'field' }, h('span', {}, 'Velocidad'), range('rate', 0.5, 1.5, 0.05, v => Number(v).toFixed(2))),
      h('label', { class: 'field' }, h('span', {}, 'Tono'), range('pitch', 0.5, 1.6, 0.05, v => Number(v).toFixed(2))),
      h('button', { class: 'btn', onclick: () => voice.speak('Hola, soy la voz de Matías. Quiero jugar.') }, '🔊 Probar voz')),
    h('section', {}, h('h3', {}, '🔲 Cuadrícula'),
      h('p', { class: 'muted small' }, 'Columnas × filas de los menús que no tienen un tamaño propio. Cambiarla no mueve ninguna ficha: agrandar agrega casillas vacías y achicar esconde (sin borrar) lo que no cabe.'),
      presets,
      h('div', { class: 'row' }, 'Columnas', gridSel('cols', 10), 'Filas', gridSel('rows', 8)),
      ownGrids.length ? h('div', {},
        h('p', { class: 'muted small' }, `Estas pantallas tienen un tamaño propio, distinto del general: ${ownGrids.map(b => `${b.name} (${b.cols}×${b.rows})`).join(', ')}.`),
        h('button', { class: 'btn', onclick: async () => { if (await sameSizeEverywhere(ownGrids)) { m.close(); openSettings(); } } }, `Usar el mismo tamaño de ficha en todas (${s.cols}×${s.rows})`)) : null,
      chk('gridSync', 'Misma cuadrícula en todos mis equipos: el respaldo lleva el tamaño de cada pantalla, así la tablet y el celular muestran cada ficha en el mismo lugar')),
    h('section', {}, h('h3', {}, '🔤 Texto y apariencia'),
      h('button', { class: 'btn', onclick: () => { m.close(); openMenuPicker(); } }, '🧩 Elegir menús y botones que ve el niño'),
      chk('showText', 'Mostrar el texto debajo de la imagen'),
      chk('neutral', 'Dibujos neutros: emojis en gris, sin colores llamativos'),
      chk('arasaacColor', 'Pictogramas ARASAAC a color (si no, en blanco y negro)'),
      h('label', { class: 'field' }, h('span', {}, 'Tamaño de letra'), sel('fontSize', [['s', 'Pequeña'], ['m', 'Mediana'], ['l', 'Grande'], ['xl', 'Muy grande']])),
      h('label', { class: 'field' }, h('span', {}, 'Tema'), sel('theme', [['light', 'Claro'], ['dark', 'Oscuro suave'], ['auto', 'Automático']]))),
    h('section', {}, h('h3', {}, '✋ Toques'),
      h('label', { class: 'field' }, h('span', {}, 'Ignorar toques repetidos en menos de'), range('debounceMs', 0, 3000, 100, v => `${v} ms`)),
      h('label', { class: 'field' }, h('span', {}, 'Mantener presionado para activar (0 = desactivado)'), range('holdMs', 0, 2000, 100, v => Number(v) ? `${v} ms` : 'No'))),
    h('section', {}, h('h3', {}, '💬 Frase y barra rápida'),
      chk('addToPhrase', 'Agregar cada ficha a la tira de frase'),
      chk('quickBar', 'Mostrar la barra rápida (Quiero, Ayuda, Baño…)'),
      chk('speakFolders', 'Decir el nombre de la carpeta al abrirla')),
    h('section', {}, h('h3', {}, '🔐 Seguridad y pantalla'),
      h('label', { class: 'field' }, h('span', {}, 'PIN para Modo Padres (opcional)'), pinIn),
      chk('wakeLock', 'Mantener la pantalla encendida mientras la app está abierta'),
      chk('logEnabled', 'Guardar registro de uso (palabras y frases)')),
  );
}

// ---------- Respaldo ----------
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBuf(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export async function exportBackup(includeLog = true) {
  const [boards, cards, media, kv, log] = await Promise.all(['boards', 'cards', 'media', 'kv', 'log'].map(st => db.getAll(st)));
  const data = {
    app: 'matias-caa', version: 1, created: new Date().toISOString(),
    boards, cards, kv,
    media: media.map(m => ({ id: m.id, type: m.type, data: bufToB64(m.data) })),
    log: includeLog ? log : [],
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  await shareOrDownload(blob, `matias-respaldo-${today()}.json`);
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast('El archivo no es un respaldo válido'); return; }
  if (data.app !== 'matias-caa' || !Array.isArray(data.cards)) { toast('El archivo no es un respaldo de esta app'); return; }
  const ok = await confirmBox(`Se reemplazará todo el tablero de este equipo por el del respaldo (${data.cards.length} fichas, ${data.media.length} fotos/audios, del ${new Date(data.created).toLocaleDateString('es-PE')}). ¿Continuar?`, { ok: 'Importar', danger: true });
  if (!ok) return;
  const localVoice = S.settings.voiceURI;
  // Respaldos de versiones anteriores guardan "pos": se pasa a fila y columna con la cuadrícula del respaldo
  const bkSettings = { ...DEFAULT_SETTINGS, ...((data.kv || []).find(e => e.key === 'settings')?.value || {}) };
  const bkBoards = new Map(data.boards.map(b => [b.id, b]));
  slotsFromPos(data.cards, id => { const b = bkBoards.get(id); return b && b.cols && b.rows ? { cols: b.cols, rows: b.rows } : { cols: bkSettings.cols, rows: bkSettings.rows }; });
  data.kv = (data.kv || []).filter(e => e.key !== 'slotVersion').concat({ key: 'slotVersion', value: 1 });
  // Sin "misma cuadrícula en todos mis equipos": este equipo conserva sus propios tamaños de pantalla
  const keepGrid = bkSettings.gridSync === false;
  if (keepGrid) {
    for (const b of data.boards) {
      const mine = S.boards.get(b.id);
      delete b.cols; delete b.rows; delete b.manualGrid;
      if (mine && mine.cols && mine.rows) Object.assign(b, { cols: mine.cols, rows: mine.rows, manualGrid: mine.manualGrid });
    }
  }
  for (const st of ['boards', 'cards', 'media', 'kv']) await db.clear(st);
  await db.putMany('boards', data.boards);
  await db.putMany('cards', data.cards);
  await db.putMany('media', data.media.map(m => ({ id: m.id, type: m.type, data: b64ToBuf(m.data) })));
  const own = keepGrid ? { cols: S.settings.cols, rows: S.settings.rows } : {};
  const kv = data.kv.map(e => e.key === 'settings' ? { key: 'settings', value: { ...DEFAULT_SETTINGS, ...e.value, voiceURI: localVoice, ...own } } : e);
  await db.putMany('kv', kv);
  if (data.log && data.log.length) {
    await db.clear('log');
    await db.putMany('log', data.log);
  }
  toast('Respaldo importado');
  setTimeout(() => location.reload(), 600);
}

function openBackup() {
  const m = modal('Respaldo y traspaso', { wide: true });
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  file.onchange = () => { if (file.files[0]) { m.close(); importBackup(file.files[0]); } };
  const logChk = h('input', { type: 'checkbox', checked: true });
  m.body.append(
    h('section', {}, h('h3', {}, '📤 Exportar copia completa'),
      h('p', {}, 'Crea un solo archivo con todas las fichas, carpetas, fotos, voces grabadas, agenda y ajustes. Guárdalo en Drive/iCloud o envíalo por WhatsApp o AirDrop para pasarlo a otro equipo.'),
      h('label', { class: 'check' }, logChk, ' Incluir el registro de uso'),
      h('button', { class: 'btn primary', onclick: () => exportBackup(logChk.checked) }, '📤 Exportar respaldo')),
    h('section', {}, h('h3', {}, '📥 Importar en este equipo'),
      h('p', {}, 'Reemplaza el tablero de este equipo por el del archivo. La voz elegida en este equipo se conserva.'),
      h('button', { class: 'btn', onclick: () => file.click() }, '📥 Importar respaldo'), file),
    h('section', {}, h('h3', {}, '↺ Volver al vocabulario inicial'),
      h('p', { class: 'muted small' }, 'Borra todas las fichas y fotos de este equipo y carga el tablero inicial. Exporta un respaldo antes.'),
      h('button', { class: 'btn danger', onclick: resetAll }, 'Restablecer tablero')),
  );
}

async function resetAll() {
  if (!(await confirmBox('Se borrarán todas las fichas, fotos y voces de este equipo. ¿Seguro?', { ok: 'Borrar y restablecer', danger: true }))) return;
  const keep = S.settings;
  for (const st of ['boards', 'cards', 'media', 'kv']) await db.clear(st);
  await seedDefaults();
  await db.setKV('settings', keep);
  location.reload();
}

// ---------- Actualizaciones ----------
export const APP_VERSION = '2.2';
async function checkUpdate() {
  if (!navigator.onLine) { toast('Necesitas internet para buscar actualizaciones'); return; }
  toast('Buscando actualización…');
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.update();
  } catch (e) {}
  setTimeout(() => location.reload(), 2500);
}

// ---------- Bloqueo y Acerca de ----------
function openLockHelp() {
  const m = modal('Que no salga de la app', { wide: true });
  const fs = h('button', { class: 'btn primary' }, '⛶ Pantalla completa');
  fs.onclick = () => { const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el); m.close(); };
  m.body.append(
    h('section', {}, h('h3', {}, '📱 iPhone / iPad — Acceso guiado'),
      h('ol', {},
        h('li', {}, 'Ajustes → Accesibilidad → Acceso guiado → actívalo.'),
        h('li', {}, 'Toca “Configuración de código” y elige un código que él no sepa.'),
        h('li', {}, 'Abre la app de Matías y presiona 3 veces seguidas el botón lateral (o el botón de inicio).'),
        h('li', {}, 'Toca “Iniciar”. Ahora no podrá salir de la app.'),
        h('li', {}, 'Para salir: presiona 3 veces el botón y escribe tu código.'))),
    h('section', {}, h('h3', {}, '🤖 Android — Fijar pantalla'),
      h('ol', {},
        h('li', {}, 'Ajustes → Seguridad (o Seguridad y privacidad → Más ajustes) → Fijar aplicaciones / Fijar pantalla → actívalo, y activa “Pedir PIN para dejar de fijar”.'),
        h('li', {}, 'Abre la app de Matías y luego el botón de apps recientes (el cuadrado o desliza desde abajo y mantén).'),
        h('li', {}, 'Toca el ícono de la app arriba de la ventana → “Fijar”.'),
        h('li', {}, 'Para salir: mantén presionados Atrás y Recientes (o desliza hacia arriba y mantén) e ingresa tu PIN.'))),
    h('section', {}, h('h3', {}, '💻 Computadora'),
      h('p', {}, 'Puedes poner la app en pantalla completa:'), fs),
  );
}

function openAbout() {
  const m = modal('Acerca de', { wide: true });
  m.body.append(
    h('p', {}, h('b', {}, 'Comunicador de Matías'), ' — aplicación de Comunicación Aumentativa y Alternativa (CAA) con pictogramas.'),
    h('p', {}, '🔒 Privacidad: no tiene anuncios, ni cuentas, ni envía datos a ningún servidor. Todo (fichas, fotos, voces, registro) se guarda solo en este equipo. Solo se usa internet cuando tú buscas pictogramas en ARASAAC.'),
    h('p', {}, '🖼️ Pictogramas: los símbolos pictográficos utilizados son propiedad del Gobierno de Aragón y han sido creados por Sergio Palao para ARASAAC (', h('a', { href: 'https://arasaac.org', target: '_blank', rel: 'noopener' }, 'arasaac.org'), '), que los distribuye bajo Licencia Creative Commons BY-NC-SA.'),
    h('p', {}, '😀 Los dibujos iniciales son los emojis del propio equipo, por eso pueden verse un poco distintos en iPhone, Android y Mac.'),
    h('p', { class: 'muted small' }, 'Colores de borde (código Fitzgerald): amarillo personas, verde acciones, naranja cosas, azul descriptivos, morado lugares, rosa social, rojo negación/urgente.'),
    h('p', { class: 'muted small' }, 'Versión ' + APP_VERSION),
    h('button', { class: 'btn primary', onclick: checkUpdate }, '🔄 Buscar actualización'),
  );
}
