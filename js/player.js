/**
 * player.js — motor de reprodução do projeto.
 *
 * Reproduz a sequência de clipes desenhando cada frame num canvas (via
 * effects.js). Suporta velocidade, speed ramp, reprodução inversa e
 * sincronização de áudio. O mesmo motor alimenta a pré-visualização e a
 * exportação (que acrescenta um "renderer" extra para o canvas de exportação).
 */

import {
  state,
  findClipAt,
  totalDuration,
  getMap,
  srcTimeFor,
  emit,
} from './state.js';
import { renderFrame, renderEmpty } from './effects.js';
import * as audio from './audio.js';

export const player = {
  playing: false,
  time: 0,          // posição na timeline (s)
  activeClipId: null,
  onTick: null,     // callback de UI ({ time, duration, playing })
  renderers: [],    // funções extra ({ video, clip, fxT, localT, ctx, W, H })
};

let rafId = 0;
let lastNow = 0;
let wakeLock = null;

/* ---------------- Ciclo principal ---------------- */

function tick(now) {
  rafId = 0;
  const dt = Math.min(0.25, Math.max(0, (now - lastNow) / 1000));
  lastNow = now;

  if (player.playing) {
    player.time += dt;
    const total = totalDuration();
    if (player.time >= total) {
      player.time = total;
      pause();
      emit('ended');
    }
  }

  syncPlayback();
  drawFrames();
  notify();

  if (player.playing) schedule();
}

function schedule() {
  if (!rafId) {
    lastNow = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function notify() {
  if (player.onTick) {
    player.onTick({ time: player.time, duration: totalDuration(), playing: player.playing });
  }
}

/* ---------------- Sincronização dos elementos de vídeo ---------------- */

function syncPlayback() {
  const loc = findClipAt(player.time);
  if (!loc) {
    stopAllVideos();
    player.activeClipId = null;
    return;
  }

  const { clip, localT } = loc;

  if (player.activeClipId !== clip.id) {
    for (const c of state.clips) {
      if (c !== clip && c.video && !c.video.paused) c.video.pause();
    }
    player.activeClipId = clip.id;
    emit('active-clip', clip);
  }

  const map = getMap(clip);
  const v = clip.video;
  if (!v) return;

  const srcT = srcTimeFor(clip, localT);
  const speed = Math.min(16, Math.max(0.0625, map.speedAt(localT)));

  // Reprodução inversa: avançamos o vídeo "às costas", quadro a quadro.
  if (clip.reverse) {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - srcT) > 0.012) {
      try { v.currentTime = srcT; } catch { /* ignorar */ }
    }
    return;
  }

  // Reprodução normal: deixamos o vídeo correr e corrigimos desvios.
  if (player.playing) {
    if (v.paused && v.readyState >= 2) v.play().catch(() => {});
    try { v.playbackRate = speed; } catch { /* ignorar */ }
    if (Math.abs(v.currentTime - srcT) > 0.3) {
      try { v.currentTime = srcT; } catch { /* ignorar */ }
    }
  } else {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - srcT) > 0.04) {
      try { v.currentTime = srcT; } catch { /* ignorar */ }
    }
  }
}

function stopAllVideos() {
  for (const c of state.clips) {
    try { c.video?.pause(); } catch { /* ignorar */ }
  }
}

/* ---------------- Desenho ---------------- */

function drawFrames() {
  const loc = findClipAt(player.time);
  const extra = player.renderers;

  if (!loc) {
    // Sem clipes: estado vazio em todos os renderers.
    for (const fn of extra) fn({ video: null, clip: null, fxT: player.time, localT: 0 });
    return;
  }

  const { clip, localT } = loc;
  for (const fn of extra) {
    fn({ video: clip.video, clip, fxT: player.time, localT });
  }
}

/** Renderer por omissão para a pré-visualização. */
export function makeCanvasRenderer(canvas) {
  return ({ video, clip, fxT }) => {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    if (!clip) {
      renderEmpty(ctx, W, H, fxT);
      return;
    }
    renderFrame(ctx, video, W, H, clip.effects, fxT);
  };
}

/** Ajusta o canvas à proporção do clipe ativo (e o contentor da pré-visualização). */
export function fitCanvasToClip(canvas, clip) {
  const w = clip?.width || 1280;
  const h = clip?.height || 720;
  const maxW = 1280;
  const scale = Math.min(1, maxW / w);
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  // Ajusta também a caixa da pré-visualização para não distorcer vídeos verticais.
  const wrap = canvas.parentElement;
  if (wrap) wrap.style.aspectRatio = `${w} / ${h}`;
}

/* ---------------- API pública ---------------- */

export function initPlayer({ previewCanvas }) {
  player.renderers = [makeCanvasRenderer(previewCanvas)];
  player.previewCanvas = previewCanvas;
  notify();
}

export function play() {
  if (!state.clips.length) return;
  audio.bindAll();
  audio.ensureAudio();
  if (player.time >= totalDuration() - 0.01) player.time = 0;
  player.playing = true;
  audio.syncMusic(player.time, true);
  requestWakeLock();
  schedule();
  notify();
}

export function pause() {
  player.playing = false;
  stopAllVideos();
  audio.pauseMusic();
  syncPlayback();
  drawFrames();
  notify();
  releaseWakeLock();
}

export function toggle() {
  if (player.playing) pause();
  else play();
}

export function seek(t) {
  const total = totalDuration();
  player.time = Math.max(0, Math.min(total, t));
  audio.syncMusic(player.time, player.playing);
  syncPlayback();
  drawFrames();
  notify();
  if (player.playing) schedule();
}

export function getTime() {
  return player.time;
}

export function isPlaying() {
  return player.playing;
}

/** Redesenha sem alterar a posição (após mudanças de efeitos, por exemplo). */
export function refresh() {
  syncPlayback();
  drawFrames();
  notify();
}

/* ---------------- Wake lock (mantém o ecrã ligado) ---------------- */

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* ignorar */ }
}

function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* ignorar */ }
  wakeLock = null;
}
