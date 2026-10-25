// Pictogramas planos y neutros (sin 3D ni relieve), dibujados en un solo tono.
const S = 'fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="currentColor"';

export const ICONS = {
  familia: `
    <circle cx="27" cy="26" r="9" ${F}/><path d="M13 78 V52 q0-14 14-14 q14 0 14 14 V78 z" ${F}/>
    <circle cx="73" cy="26" r="9" ${F}/><path d="M59 78 V52 q0-14 14-14 q14 0 14 14 V78 z" ${F}/>
    <circle cx="50" cy="48" r="7" ${F}/><path d="M40 82 V67 q0-10 10-10 q10 0 10 10 V82 z" ${F}/>`,
  comida: `
    <circle cx="50" cy="52" r="24" ${S}/><circle cx="50" cy="52" r="13" ${S}/>
    <path d="M14 22 V44 M8 22 V36 q0 8 6 8 q6 0 6-8 V22 M14 44 V82" ${S}/>
    <path d="M86 22 q-8 6 -8 22 h8 M86 22 V82" ${S}/>`,
  lugares: `
    <path d="M14 48 L50 18 L86 48" ${S}/><path d="M24 42 V82 H76 V42" ${S}/>
    <path d="M43 82 V60 H57 V82" ${S}/>`,
  intereses: `
    <path d="M50 14 L60 38 L86 40 L66 57 L72 83 L50 69 L28 83 L34 57 L14 40 L40 38 Z" ${S}/>`,
  duele: `
    <circle cx="50" cy="52" r="32" ${S}/><circle cx="39" cy="46" r="4" ${F}/><circle cx="61" cy="46" r="4" ${F}/>
    <path d="M37 70 q13 -10 26 0" ${S}/><path d="M56 22 L80 34" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>`,
  bano: `
    <path d="M22 18 H44 V48" ${S}/><path d="M18 48 H82 q0 22 -22 26 L64 86 H36 L40 74 q-22 -4 -22 -26 z" ${S}/>`,
  agua: `
    <path d="M50 14 C50 14 24 46 24 62 a26 26 0 0 0 52 0 C76 46 50 14 50 14 Z" ${S}/>`,
  ayuda: `
    <path d="M30 86 V50 M30 50 V24 q0-6 6-6 q6 0 6 6 V46 M42 46 V16 q0-6 6-6 q6 0 6 6 V46 M54 46 V20 q0-6 6-6 q6 0 6 6 V50 M66 50 V32 q0-6 6-6 q6 0 6 6 V62 q0 24 -24 24 H44 q-10 0 -16 -10 L16 58 q-4 -6 2 -10 q6 -4 12 2" ${S}/>`,
  si: `<path d="M18 52 L40 74 L84 28" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`,
  no: `<path d="M24 24 L76 76 M76 24 L24 76" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round"/>`,
};

export function iconSVG(name) {
  const body = ICONS[name];
  if (!body) return null;
  return `<svg viewBox="0 0 100 100" class="flat-icon" aria-hidden="true">${body}</svg>`;
}
