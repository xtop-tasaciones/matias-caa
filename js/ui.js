// Pequeñas utilidades de interfaz.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// Ventana modal. Devuelve { el, body, close }.
export function modal(title, { wide = false, onClose } = {}) {
  const body = h('div', { class: 'modal-body' });
  const closeBtn = h('button', { class: 'btn ghost modal-x', 'aria-label': 'Cerrar' }, '✕');
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' }, h('h2', {}, title), closeBtn), body);
  const back = h('div', { class: 'modal-back' }, box);
  document.body.append(back);
  const close = () => { back.remove(); onClose && onClose(); };
  closeBtn.addEventListener('click', close);
  return { el: box, body, close };
}

export function toast(msg, ms = 2500) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export function confirmBox(message, { ok = 'Sí', cancel = 'Cancelar', danger = false } = {}) {
  return new Promise(resolve => {
    const m = modal('Confirmar', { onClose: () => resolve(false) });
    m.body.append(
      h('p', { class: 'confirm-msg' }, message),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => { m.close(); } }, cancel),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { resolve(true); m.close(); } }, ok)));
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Compartir (útil en iPhone para "Guardar en Archivos" o enviar por WhatsApp)
export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  downloadBlob(blob, filename);
}

export function today(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
