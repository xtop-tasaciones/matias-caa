// Registro de uso para padres y terapeutas (solo en el dispositivo).
import * as db from './db.js';
import { S } from './app.js';
import { h, modal, shareOrDownload, today, confirmBox, toast } from './ui.js';

export function logEvent(ev) {
  if (!S.settings.logEnabled || S.parent) return;
  db.add('log', { ts: Date.now(), ...ev }).catch(() => {});
}

const DAY = 86400000;
const fmtDate = ts => new Date(ts).toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = ts => new Date(ts).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

function summarize(events, days) {
  const since = days ? Date.now() - days * DAY : 0;
  const ev = events.filter(e => e.ts >= since);
  const words = new Map();
  const phrases = new Map();
  const perDay = new Map();
  const recent = [];
  for (const e of ev) {
    const d = today(new Date(e.ts));
    const pd = perDay.get(d) || { cards: 0, phrases: 0 };
    if (e.kind === 'card') { words.set(e.label, (words.get(e.label) || 0) + 1); pd.cards++; }
    if (e.kind === 'phrase' && (e.words || 0) >= 2) {
      phrases.set(e.label, (phrases.get(e.label) || 0) + 1);
      pd.phrases++;
      recent.push(e);
    }
    perDay.set(d, pd);
  }
  return {
    total: ev.length,
    words: [...words.entries()].sort((a, b) => b[1] - a[1]),
    phrases: [...phrases.entries()].sort((a, b) => b[1] - a[1]),
    recent: recent.sort((a, b) => b.ts - a.ts),
    perDay,
  };
}

export async function openLog() {
  const m = modal('Registro de uso', { wide: true });
  const events = await db.getAll('log');
  let days = 7;
  const content = h('div');
  const ranges = h('div', { class: 'seg' },
    ...[[7, '7 días'], [30, '30 días'], [0, 'Todo']].map(([d, t]) => {
      const b = h('button', { class: 'btn' + (d === days ? ' on' : '') }, t);
      b.addEventListener('click', () => { days = d; ranges.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); draw(); });
      return b;
    }));

  function bars(rows, max) {
    return h('div', { class: 'bars' }, rows.map(([k, v]) =>
      h('div', { class: 'bar-row' }, h('span', { class: 'bar-k' }, k), h('span', { class: 'bar' }, h('i', { style: { width: Math.max(4, (v / max) * 100) + '%' } })), h('b', {}, v))));
  }

  function draw() {
    const r = summarize(events, days);
    content.innerHTML = '';
    if (!r.total) { content.append(h('p', { class: 'muted' }, 'Todavía no hay registros en este periodo.')); return; }
    const topW = r.words.slice(0, 20);
    const topP = r.phrases.slice(0, 15);
    const nDays = days || Math.max(1, Math.ceil((Date.now() - Math.min(...events.map(e => e.ts))) / DAY));
    const dayRows = [];
    for (let i = Math.min(nDays, 31) - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * DAY);
      const k = today(d);
      const v = r.perDay.get(k) || { cards: 0, phrases: 0 };
      dayRows.push([d.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric' }), v.cards + v.phrases]);
    }
    content.append(
      h('h3', {}, 'Palabras más usadas'),
      topW.length ? bars(topW, topW[0][1]) : h('p', { class: 'muted' }, 'Sin datos.'),
      h('h3', {}, 'Frases de 2 o más palabras'),
      topP.length ? bars(topP, topP[0][1]) : h('p', { class: 'muted' }, 'Todavía no ha formado frases de 2 o más palabras.'),
      r.recent.length ? h('details', {}, h('summary', {}, 'Ver frases con fecha y hora'),
        h('ul', { class: 'plain' }, r.recent.slice(0, 100).map(e => h('li', {}, `${fmtDate(e.ts)} ${fmtTime(e.ts)} — “${e.label}”`)))) : null,
      h('h3', {}, 'Uso por día (toques + frases)'),
      bars(dayRows, Math.max(1, ...dayRows.map(x => x[1]))),
    );
  }
  draw();

  const exportBtn = h('button', { class: 'btn primary' }, '📤 Exportar para la terapeuta');
  exportBtn.addEventListener('click', () => exportLog(events, days));
  const clearBtn = h('button', { class: 'btn danger' }, 'Borrar registro');
  clearBtn.addEventListener('click', async () => {
    if (await confirmBox('¿Borrar todo el registro de uso? No se puede deshacer.', { ok: 'Borrar', danger: true })) {
      await db.clear('log'); m.close(); toast('Registro borrado');
    }
  });
  m.body.append(
    h('div', { class: 'row wrap' }, ranges),
    content,
    h('div', { class: 'row wrap end' }, clearBtn, exportBtn),
    h('p', { class: 'muted small' }, S.settings.logEnabled ? 'El registro está activado. Puedes desactivarlo en Ajustes. No se registra lo que se toca en el Modo Padres.' : 'El registro está desactivado en Ajustes.'),
  );
}

function csvCell(v) { const s = String(v ?? ''); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

async function exportLog(events, days) {
  const r = summarize(events, days);
  const periodo = days ? `últimos ${days} días` : 'todo el registro';
  const lines = [];
  lines.push(`Registro de comunicación — ${periodo}`);
  lines.push(`Generado: ${new Date().toLocaleString('es-PE')}`);
  lines.push('');
  lines.push('PALABRAS MÁS USADAS');
  r.words.slice(0, 40).forEach(([k, v]) => lines.push(`  ${v}  ${k}`));
  lines.push('');
  lines.push('FRASES DE 2 O MÁS PALABRAS (frecuencia)');
  r.phrases.forEach(([k, v]) => lines.push(`  ${v}  ${k}`));
  lines.push('');
  lines.push('USO POR DÍA');
  [...r.perDay.entries()].sort().forEach(([d, v]) => lines.push(`  ${d}: ${v.cards} fichas, ${v.phrases} frases`));
  lines.push('');
  lines.push('DETALLE (fecha;hora;tipo;texto;tablero)');
  const since = days ? Date.now() - days * DAY : 0;
  const csv = ['fecha;hora;tipo;texto;tablero'];
  events.filter(e => e.ts >= since).sort((a, b) => a.ts - b.ts).forEach(e => {
    const row = [today(new Date(e.ts)), fmtTime(e.ts), e.kind === 'phrase' ? 'frase' : 'ficha', e.label, e.board || ''].map(csvCell).join(';');
    csv.push(row);
    lines.push('  ' + row);
  });
  const name = `registro-comunicacion-${today()}`;
  // Un solo archivo de texto legible (incluye el detalle en formato CSV al final)
  await shareOrDownload(new Blob(['﻿' + lines.join('\n')], { type: 'text/plain' }), name + '.txt');
}
