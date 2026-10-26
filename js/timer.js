// Temporizador visual "Esperar": un disco que se va vaciando muestra cuánto falta. Sin sonidos de efectos.
import { S, picEl, bindActivate } from './app.js';
import * as voice from './speech.js';
import { h } from './ui.js';

export const TIMER_MINUTES = [1, 2, 5, 10];
const ESPERAR = { image: { kind: 'picto', id: 'a-esperar' }, emoji: '⏳', label: 'esperar' };
const LISTO = { image: { kind: 'picto', id: 'q-termine' }, emoji: '🏁', label: 'terminé' };
const minText = n => n === 1 ? '1 minuto' : `${n} minutos`;

// Disco tipo "Time Timer": la parte de color es el tiempo que falta (frac de 0 a 1)
function diskSVG(frac) {
  const r = 45, c = 50;
  const f = Math.max(0, Math.min(1, frac));
  let wedge = '';
  if (f >= 0.9999) wedge = `<circle cx="${c}" cy="${c}" r="${r}" class="t-left"/>`;
  else if (f > 0) {
    const a = 2 * Math.PI * f;
    const x = c + r * Math.sin(a), y = c - r * Math.cos(a);
    wedge = `<path class="t-left" d="M${c} ${c} L${c} ${c - r} A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z"/>`;
  }
  return `<svg viewBox="0 0 100 100" class="t-disk" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" class="t-bg"/>${wedge}<circle cx="${c}" cy="${c}" r="3" class="t-dot"/></svg>`;
}

// Tablero especial "Esperar": elegir cuánto tiempo
export function renderTimerBoard(main) {
  const grid = h('div', { class: 'choice c4 timer-choice' });
  for (const n of TIMER_MINUTES) {
    const el = h('div', { class: 'card c-accion', role: 'button', 'aria-label': minText(n) },
      h('div', { class: 'pic has-icon', html: diskSVG(n / 10) }),
      h('div', { class: 'label' }, minText(n)));
    bindActivate(el, () => openTimer(n));
    grid.append(el);
  }
  main.append(grid);
}

// Pantalla completa con el disco. Para cerrarla antes de tiempo hay que mantener ✕ un segundo.
export function openTimer(minutes) {
  const total = minutes * 60000;
  const end = Date.now() + total;
  const disk = h('div', { class: 't-disk-wrap', html: diskSVG(1) });
  const left = h('div', { class: 't-left-text' });
  const pic = h('div', { class: 't-pic' }, picEl(ESPERAR));
  const word = h('div', { class: 't-word' }, 'Esperar');
  const closeBtn = h('button', { class: 'btn t-close', 'aria-label': 'Cerrar (mantener presionado)' }, '✕');
  const box = h('div', { class: 'timer-overlay', role: 'dialog', 'aria-label': 'Esperar' },
    closeBtn, h('div', { class: 't-main' }, disk, h('div', { class: 't-side' }, pic, word, left)));
  document.body.append(box);
  voice.speak(`Esperar ${minText(minutes)}`);

  let timer = null;
  const close = () => { clearInterval(timer); box.remove(); };
  const tick = () => {
    const ms = end - Date.now();
    if (ms <= 0) return finish();
    disk.innerHTML = diskSVG(ms / total);
    const m = Math.ceil(ms / 60000);
    left.textContent = ms < 60000 ? 'Falta poquito' : `Faltan ${minText(m)}`;
  };
  const finish = () => {
    clearInterval(timer);
    disk.innerHTML = diskSVG(0);
    pic.replaceChildren(picEl(LISTO));
    word.textContent = '¡Listo!';
    left.textContent = '';
    closeBtn.remove();
    const back = h('button', { class: 'btn primary t-back' }, 'Volver');
    back.onclick = close;
    box.querySelector('.t-side').append(back);
    voice.speak('¡Listo! Terminó la espera');
  };
  // Mantener ✕ un segundo: un toque casual del niño no la cierra
  let hold = null;
  closeBtn.addEventListener('pointerdown', () => { hold = setTimeout(close, S.parent ? 0 : 1000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) closeBtn.addEventListener(ev, () => clearTimeout(hold));
  tick();
  timer = setInterval(tick, 1000);
  return { close };
}
