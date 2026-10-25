// Voz: síntesis en español latino y reproducción de voces grabadas.
import { mediaURL } from './db.js';

const PREFERRED = ['es-PE', 'es-MX', 'es-US', 'es-419', 'es-CO', 'es-CL', 'es-AR'];
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
let voices = [];
let settings = { voiceURI: null, rate: 0.9, pitch: 1 };
const player = new Audio();
player.preload = 'auto';

function norm(lang) { return (lang || '').replace('_', '-'); }

function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices().filter(v => norm(v.lang).toLowerCase().startsWith('es'));
}
if (synth) {
  loadVoices();
  synth.addEventListener?.('voiceschanged', loadVoices);
  // Algunos navegadores tardan en entregar la lista de voces.
  setTimeout(loadVoices, 500);
  setTimeout(loadVoices, 2000);
}

export function spanishVoices() {
  loadVoices();
  return voices.slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function rank(v) {
  const lang = norm(v.lang);
  const i = PREFERRED.findIndex(p => lang.toLowerCase() === p.toLowerCase());
  if (i >= 0) return i * 2 + (v.localService ? 0 : 1);
  return lang.toLowerCase() === 'es-es' ? 40 : 20;
}

export function currentVoice() {
  loadVoices();
  if (settings.voiceURI) {
    const v = voices.find(v => v.voiceURI === settings.voiceURI);
    if (v) return v;
  }
  return spanishVoices()[0] || null;
}

export function configure(s) { settings = s; }
export const ttsAvailable = () => !!synth;

export function stop() {
  try { synth && synth.cancel(); } catch (e) {}
  try { player.pause(); } catch (e) {}
}

export function speak(text) {
  if (!text) return;
  stop();
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = currentVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'es-MX'; }
  u.rate = Number(settings.rate) || 0.9;
  u.pitch = Number(settings.pitch) || 1;
  synth.speak(u);
  // Chrome a veces queda en pausa
  if (synth.paused) synth.resume();
}

export async function playMedia(id, fallbackText) {
  stop();
  const url = await mediaURL(id);
  if (!url) return speak(fallbackText);
  player.src = url;
  try { await player.play(); } catch (e) { speak(fallbackText); }
}

// Dice una ficha: voz grabada si existe, si no, síntesis.
export function sayCard(card) {
  const text = card.speak || card.label;
  if (card.audio) return playMedia(card.audio, text);
  speak(text);
}
