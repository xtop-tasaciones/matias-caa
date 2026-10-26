// Importar muchos pictogramas propios a la vez (por ejemplo, los que ya hizo mamá) y elegir a qué menú va cada uno.
import * as db from './db.js';
import { S, cardsOf, firstFreeSlot, saveCard, saveBoard, render } from './app.js';
import { h, modal, toast } from './ui.js';
import { resizeImage } from './parents.js';

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const isImage = f => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/i.test(f.name);

// "01_lavar-manos.png" → "lavar manos"
function nameFromFile(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ').replace(/^\s*\d+\s+/, '').replace(/\s+/g, ' ').trim();
}

// Menús donde se puede poner una ficha: el Inicio y las carpetas normales (primero las que se ven en el Inicio).
function targets() {
  const onHome = cardsOf('home').filter(c => c.type === 'folder' && c.link && S.boards.has(c.link));
  const list = [{ id: 'home', name: 'Inicio (pantalla principal)' }];
  const seen = new Set(['home', 'quick']);
  for (const c of onHome.filter(c => !c.hidden).concat(onHome.filter(c => c.hidden))) {
    const b = S.boards.get(c.link);
    if (b.special || seen.has(b.id)) continue;
    seen.add(b.id);
    list.push({ id: b.id, name: b.name + (c.hidden ? ' (escondido)' : '') });
  }
  for (const b of S.boards.values()) if (!b.special && !seen.has(b.id)) { seen.add(b.id); list.push({ id: b.id, name: b.name }); }
  return list;
}

// Color PECS del menú: el de su carpeta en el Inicio.
function colorFor(boardId) {
  const owner = [...S.cards.values()].find(c => c.type === 'folder' && c.link === boardId);
  return owner && owner.color !== 'carpeta' ? owner.color : 'cosa';
}

// Si la imagen venía dentro de una carpeta llamada como un menú ("Comida/arroz.png"), se propone ese menú.
function guessBoard(path, list) {
  const dirs = (path || '').split('/').slice(0, -1).reverse();
  for (const d of dirs) {
    const hit = list.find(t => norm(S.boards.get(t.id)?.name) === norm(d));
    if (hit) return hit.id;
  }
  return null;
}

// Archivos de una carpeta arrastrada (Mac).
async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...dt.files].map(f => ({ file: f, path: f.name }));
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, prefix + entry.name + '/');
      } while (batch.length);
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

export function openImport() {
  let items = [];
  const m = modal('Importar pictogramas propios', { wide: true, onClose: () => { items.forEach(it => URL.revokeObjectURL(it.url)); render(); } });
  const list = targets();

  const filesIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const dirIn = h('input', { type: 'file', multiple: true, hidden: true });
  const canDir = 'webkitdirectory' in dirIn && !/iPhone|iPad|Android/i.test(navigator.userAgent);
  if (canDir) dirIn.webkitdirectory = true;

  const boardSelect = (value, extra = []) => {
    const sel = h('select', {}, extra, list.map(t => h('option', { value: t.id, selected: t.id === value }, t.name)),
      h('option', { value: '__new' }, '➕ Menú nuevo…'));
    return sel;
  };

  // Menú nuevo creado desde aquí: carpeta visible en el Inicio
  async function newMenu() {
    const name = (prompt('Nombre del menú nuevo (por ejemplo: Colegio, Ropa, Animales):') || '').trim();
    if (!name) return null;
    const b = { id: db.uid('b'), name };
    await saveBoard(b);
    const slot = firstFreeSlot('home');
    const folder = { id: db.uid('c'), boardId: 'home', ...slot, label: name, speak: '', emoji: '', color: 'cosa',
      type: 'folder', link: b.id, q: '', hidden: false, image: null, audio: null };
    await saveCard(folder);
    if (slot.page > 0) toast(`“${name}” quedó en la página ${slot.page + 1} del Inicio. Para verlo en la primera, agranda el Inicio en “Tamaño de esta pantalla”.`, 6000);
    list.push({ id: b.id, name });
    return b.id;
  }

  const drop = h('div', { class: 'import-drop' },
    h('p', { class: 'big-ico' }, '📥'),
    h('p', {}, h('b', {}, 'Arrastra aquí las imágenes o una carpeta'), ' (en la Mac)'),
    h('div', { class: 'row wrap center' },
      h('button', { class: 'btn primary', onclick: () => filesIn.click() }, '🖼️ Elegir imágenes'),
      canDir ? h('button', { class: 'btn', onclick: () => dirIn.click() }, '📁 Elegir una carpeta') : null),
    h('p', { class: 'muted small' }, 'Puedes elegir muchas a la vez. Si están en carpetas con el nombre del menú (por ejemplo “Comida”), se ponen solas en ese menú.'),
    filesIn, dirIn);
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drop'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drop'));
  drop.addEventListener('drop', async e => { e.preventDefault(); drop.classList.remove('drop'); add(await filesFromDrop(e.dataTransfer)); });
  filesIn.onchange = () => { add([...filesIn.files].map(f => ({ file: f, path: f.name }))); filesIn.value = ''; };
  dirIn.onchange = () => { add([...dirIn.files].map(f => ({ file: f, path: f.webkitRelativePath || f.name }))); dirIn.value = ''; };

  const allSel = boardSelect('', [h('option', { value: '', selected: true }, '— elegir —')]);
  allSel.onchange = async () => {
    let v = allSel.value;
    if (v === '__new') v = await newMenu();
    if (v) { items.forEach(it => { if (it.on) it.board = v; }); draw(); }
    allSel.value = '';
  };
  const count = h('span', { class: 'muted' });
  const goBtn = h('button', { class: 'btn primary' }, 'Guardar');
  const head = h('div', { class: 'import-head row wrap', hidden: true },
    h('label', { class: 'field inline' }, h('span', {}, 'Poner todas las marcadas en'), allSel), count);
  const grid = h('div', { class: 'import-list' });
  const foot = h('div', { class: 'row wrap end', hidden: true },
    h('button', { class: 'btn', onclick: () => { items.forEach(it => URL.revokeObjectURL(it.url)); items = []; draw(); } }, 'Quitar todas'), goBtn);

  function add(found) {
    const imgs = found.filter(x => isImage(x.file));
    if (found.length && !imgs.length) { toast('No encontré imágenes ahí'); return; }
    for (const { file, path } of imgs) {
      items.push({ file, url: URL.createObjectURL(file), label: nameFromFile(file.name), board: guessBoard(path, list) || (S.boards.get(S.board) && !S.boards.get(S.board).special && !['quick', 'home'].includes(S.board) ? S.board : ''), on: true });
    }
    draw();
  }

  function draw() {
    grid.innerHTML = '';
    head.hidden = foot.hidden = !items.length;
    const n = items.filter(it => it.on).length;
    const missing = items.filter(it => it.on && !it.board).length;
    count.textContent = `${items.length} imágenes · ${n} marcadas` + (missing ? ` · ${missing} sin menú` : '');
    goBtn.textContent = n ? `Guardar ${n} fichas` : 'Guardar';
    goBtn.disabled = !n;
    items.forEach((it, i) => {
      const chk = h('input', { type: 'checkbox', checked: it.on });
      chk.onchange = () => { it.on = chk.checked; draw(); };
      const name = h('input', { type: 'text', value: it.label, placeholder: 'Nombre (lo que dice)' });
      name.oninput = () => { it.label = name.value; };
      const sel = boardSelect(it.board, it.board ? [] : [h('option', { value: '', selected: true }, '— ¿a qué menú? —')]);
      sel.onchange = async () => {
        let v = sel.value;
        if (v === '__new') v = await newMenu();
        it.board = v || it.board;
        draw();
      };
      grid.append(h('div', { class: 'import-item' + (it.on ? '' : ' off') + (it.on && !it.board ? ' need' : '') },
        h('label', { class: 'import-pic' }, chk, h('img', { src: it.url, alt: '' })),
        name, sel));
      void i;
    });
  }

  goBtn.onclick = async () => {
    const todo = items.filter(it => it.on);
    const missing = todo.filter(it => !it.board);
    if (missing.length) { toast(`Falta elegir el menú de ${missing.length} imagen(es)`); return; }
    const empty = todo.filter(it => !it.label.trim());
    if (empty.length) { toast(`Falta el nombre de ${empty.length} imagen(es)`); return; }
    goBtn.disabled = true;
    let ok = 0, fail = 0;
    for (const it of todo) {
      goBtn.textContent = `Guardando ${ok + fail + 1} de ${todo.length}…`;
      try {
        const blob = await resizeImage(it.file);
        if (!blob) throw new Error('imagen');
        const mid = await db.saveMedia(blob);
        await db.mediaURL(mid);
        const label = it.label.trim();
        await saveCard({ id: db.uid('c'), boardId: it.board, ...firstFreeSlot(it.board), label, speak: '', emoji: '', color: colorFor(it.board),
          type: 'word', link: null, q: '', hidden: false, image: { kind: 'media', id: mid }, audio: null });
        ok++;
        it.done = true;
      } catch (e) { fail++; }
    }
    items.filter(it => it.done).forEach(it => URL.revokeObjectURL(it.url));
    items = items.filter(it => !it.done);
    draw();
    toast(fail ? `Listo: ${ok} fichas nuevas. ${fail} imágenes no se pudieron leer.` : `Listo: ${ok} fichas nuevas`, 4000);
    if (!items.length) m.close();
  };

  m.body.append(drop, head, grid, foot,
    h('p', { class: 'muted small' }, 'Cada imagen se vuelve una ficha al final del menú elegido, con el color de ese menú, sin mover las que ya están. Después puedes tocarla para cambiar el texto, la voz o el lugar.'));
}
