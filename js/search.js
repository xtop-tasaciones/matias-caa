// Buscador rápido: escribir una palabra ("esperar"), ver el pictograma en grande y decirlo.
import { S, COLORS, cardEl, picEl, addToPhrase } from './app.js';
import * as voice from './speech.js';
import { h } from './ui.js';

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const arasaacImg = id => S.settings.arasaacColor
  ? `https://static.arasaac.org/pictograms/${id}/${id}_300.png`
  : `https://api.arasaac.org/v1/pictograms/${id}?color=false&resolution=500&download=false`;

function findCards(q) {
  const n = norm(q);
  if (!n) return [];
  const scored = [];
  const seen = new Set();
  for (const c of S.cards.values()) {
    if (c.type === 'folder' || !c.label) continue;
    const l = norm(c.label), sp = norm(c.speak);
    let score = l === n ? 0 : l.startsWith(n) ? 1 : l.split(' ').some(w => w.startsWith(n)) ? 2 : l.includes(n) || sp.includes(n) ? 3 : -1;
    if (score < 0) continue;
    if (c.hidden) score += 0.5;
    if (seen.has(l)) continue; // la misma palabra en dos menús: basta una
    seen.add(l);
    scored.push([score, c]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label, 'es')).slice(0, 24).map(x => x[1]);
}

export function openSearch() {
  const box = h('div', { class: 'search-overlay', role: 'dialog', 'aria-label': 'Buscar pictograma' });
  const input = h('input', { type: 'search', class: 'search-in', placeholder: 'Escribe una palabra… (ej.: esperar)', autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'search' });
  const close = () => { box.remove(); };
  const head = h('div', { class: 'search-head' },
    h('span', { class: 'search-ico' }, '🔎'), input,
    h('button', { class: 'btn', onclick: close }, '✕ Cerrar'));
  const results = h('div', { class: 'search-results' });
  const online = h('div', { class: 'search-online' });
  const body = h('div', { class: 'search-body' }, results, online);
  box.append(head, body);
  document.body.append(box);
  setTimeout(() => input.focus(), 30);

  // Vista grande: un solo pictograma en el centro, para mostrárselo
  function show({ label, pic, color, card }) {
    voice.stop();
    if (card) voice.sayCard(card); else voice.speak(label);
    const big = h('div', { class: 'search-show' },
      h('div', { class: `card show-card c-${COLORS[color] ? color : 'cosa'}` }, pic, h('div', { class: 'label' }, label)),
      h('div', { class: 'row wrap center' },
        h('button', { class: 'btn primary', onclick: () => card ? voice.sayCard(card) : voice.speak(label) }, '🔊 Repetir'),
        card ? h('button', { class: 'btn', onclick: () => { addToPhrase({ label: card.label, cardId: card.id, color: card.color, emoji: card.emoji, image: card.image, icon: card.icon }); close(); } }, '➕ A la frase') : null,
        h('button', { class: 'btn', onclick: () => { big.remove(); input.focus(); } }, '← Buscar otro'),
        h('button', { class: 'btn', onclick: close }, '✕ Cerrar')));
    box.append(big);
  }

  let timer = null, seq = 0;
  function draw() {
    const q = input.value;
    results.innerHTML = '';
    online.innerHTML = '';
    const found = findCards(q);
    if (!norm(q)) { results.append(h('p', { class: 'muted search-hint' }, 'Escribe lo que quieres decirle. Toca el pictograma para mostrarlo en grande y que se escuche.')); return; }
    for (const c of found) {
      const el = cardEl(c);
      el.addEventListener('click', () => show({ label: c.label, pic: picEl(c), color: c.color, card: c }));
      results.append(el);
    }
    if (!found.length) results.append(h('p', { class: 'muted search-hint' }, `No hay una ficha “${q}” en la app.`));
    // Con internet, también se buscan pictogramas en ARASAAC
    clearTimeout(timer);
    if (norm(q).length < 3 || !navigator.onLine) return;
    const my = ++seq;
    timer = setTimeout(async () => {
      try {
        const r = await fetch(`https://api.arasaac.org/v1/pictograms/es/search/${encodeURIComponent(q.trim())}`);
        if (my !== seq || !r.ok) return;
        const list = (await r.json()).slice(0, 12);
        if (!list.length) return;
        const grid = h('div', { class: 'search-results' });
        for (const p of list) {
          const kw = (p.keywords && p.keywords[0] && p.keywords[0].keyword) || q;
          const mk = () => h('div', { class: 'pic' }, h('img', { src: arasaacImg(p._id), alt: '' }));
          const el = h('div', { class: 'card c-cosa', role: 'button' }, mk(), h('div', { class: 'label' }, kw));
          el.addEventListener('click', () => show({ label: kw, pic: mk(), color: 'cosa' }));
          grid.append(el);
        }
        online.append(h('h3', {}, 'Más pictogramas de ARASAAC (con internet)'), grid);
      } catch (e) { /* sin conexión: solo las fichas de la app */ }
    }, 450);
  }
  input.addEventListener('input', draw);
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') { const first = results.querySelector('.card'); if (first) first.click(); }
  });
  draw();
}
