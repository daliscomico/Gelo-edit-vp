/**
 * audio.js — áudio do projeto: volume dos clipes, música de fundo,
 * sincronização e mistura (para exportação).
 *
 * Usa a Web Audio API:
 *   vídeo de cada clipe ─▶ ganho do clipe ─┐
 *   música ─▶ ganho da música ─────────────┼─▶ master ─▶ colunas + gravação
 */

import { state } from './state.js';

let ctx = null;
let masterGain = null;
let musicGain = null;
let mixDest = null;      // MediaStreamDestination (para exportação)
const boundElements = new WeakSet();

/** Cria (ou retoma) o contexto de áudio. Chamar a partir de um gesto do utilizador. */
export function ensureAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    mixDest = ctx.createMediaStreamDestination();
    masterGain.connect(mixDest);
    musicGain = ctx.createGain();
    musicGain.connect(masterGain);

    // Liga vídeos e música já existentes.
    for (const clip of state.clips) bindVideo(clip);
    if (state.music) bindMusicEl(state.music.el);

    applyVolumes();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function bindNode(el, dest) {
  if (!ctx || boundElements.has(el)) return null;
  try {
    const src = ctx.createMediaElementSource(el);
    src.connect(dest);
    boundElements.add(el);
    return src;
  } catch (err) {
    console.warn('[audio] não foi possível ligar elemento', err);
    return null;
  }
}

/** Liga o <video> de um clipe ao grafo de áudio (uma única vez por elemento). */
export function bindVideo(clip) {
  if (!clip?.video || !ctx) return null;
  if (!clip._gain) {
    clip._gain = ctx.createGain();
    clip._gain.connect(masterGain);
  }
  return bindNode(clip.video, clip._gain);
}

function bindMusicEl(el) {
  if (!el || !ctx) return null;
  return bindNode(el, musicGain);
}

/** Liga todos os clipes que ainda não estão ligados. */
export function bindAll() {
  ensureAudio();
  for (const clip of state.clips) bindVideo(clip);
  if (state.music) bindMusicEl(state.music.el);
}

/* ---------------- Volumes ---------------- */

export function applyVolumes() {
  if (!ctx) return;

  for (const clip of state.clips) {
    if (!clip._gain) continue;
    clip._gain.gain.value = clip.muted || state.masterMuted ? 0 : clip.volume;
  }

  if (musicGain && state.music) {
    musicGain.gain.value = state.music.muted || state.masterMuted ? 0 : state.music.volume;
  }
  if (masterGain) {
    masterGain.gain.value = state.masterVolume;
  }
}

/* ---------------- Reprodução da música ---------------- */

/** Sincroniza a música com o tempo do projeto (chamar ao reproduzir/seek). */
export function syncMusic(projectTime, playing) {
  const m = state.music;
  if (!m?.el) return;
  ensureAudio();
  const t = Math.max(0, projectTime + (m.offset || 0));
  if (playing) {
    try {
      if (Math.abs(m.el.currentTime - t) > 0.45) m.el.currentTime = t % (m.el.duration || 1e9);
    } catch { /* ignorar */ }
    if (m.el.paused) m.el.play().catch(() => {});
  } else {
    m.el.pause();
    try { m.el.currentTime = t; } catch { /* ignorar */ }
  }
}

export function pauseMusic() {
  state.music?.el?.pause();
}

/* ---------------- Música ---------------- */

export function setMusic(music) {
  state.music = music;
  if (music?.el) {
    ensureAudio();
    bindMusicEl(music.el);
    applyVolumes();
  }
  applyVolumes();
}

export function removeMusic() {
  if (state.music?.el) {
    try {
      state.music.el.pause();
      URL.revokeObjectURL(state.music.url);
    } catch { /* ignorar */ }
  }
  state.music = null;
  applyVolumes();
}

/* ---------------- Exportação ---------------- */

/** Stream de áudio misturado (vídeo + música) para juntar à gravação. */
export function getMixedStream() {
  ensureAudio();
  return mixDest ? mixDest.stream : null;
}

export function isReady() {
  return !!ctx;
}
