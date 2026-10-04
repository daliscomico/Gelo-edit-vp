/**
 * exporter.js — exportação do projeto para um ficheiro de vídeo.
 *
 * Pipeline: reproduz a sequência em tempo real desenhando-a num canvas de
 * exportação (com os efeitos aplicados) e grava o canvas + áudio misturado
 * com o MediaRecorder → ficheiro WebM (compatível com Android/Chrome).
 */

import { state, totalDuration } from './state.js';
import { renderFrame } from './effects.js';
import { player, pause, seek, play } from './player.js';
import * as audio from './audio.js';

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm',
  'video/mp4',
];

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch { /* ignorar */ }
  }
  return null;
}

function bitrateFor(height) {
  if (height >= 1080) return 8_000_000;
  if (height >= 720) return 5_000_000;
  return 2_500_000;
}

/**
 * Exporta o projeto.
 * @param {{height:number, fps:number}} settings
 * @param {{onProgress?: (f:number, t:number, d:number)=>void}} hooks
 * @returns {Promise<Blob|null>} blob do vídeo (ou null se cancelado/indisponível)
 */
export async function exportProject(settings, hooks = {}) {
  const { height = 720, fps = 30 } = settings;
  const mime = pickMime();
  if (!mime) {
    hooks.onError?.('O navegador não suporta gravação de vídeo (MediaRecorder).');
    return null;
  }
  if (!state.clips.length) {
    hooks.onError?.('Importe pelo menos um vídeo antes de exportar.');
    return null;
  }

  audio.bindAll();
  audio.ensureAudio();

  // Canvas de exportação com a proporção do primeiro clipe.
  const first = state.clips[0];
  const aspect = (first.width || 16) / (first.height || 9);
  const canvas = document.createElement('canvas');
  canvas.height = height & ~1;
  canvas.width = Math.round(height * aspect) & ~1;
  const ctx = canvas.getContext('2d');

  // Stream de vídeo + áudio
  const stream = canvas.captureStream(fps);
  const audioStream = audio.getMixedStream();
  if (audioStream) {
    for (const track of audioStream.getAudioTracks()) stream.addTrack(track);
  }

  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: bitrateFor(height),
    audioBitsPerSecond: 128_000,
  });

  const chunks = [];
  let cancelled = false;

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });

  // Renderer de exportação: desenha cada frame no canvas de exportação.
  const exportRenderer = ({ video, clip, fxT }) => {
    if (!clip) {
      ctx.fillStyle = '#0b0e13';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    renderFrame(ctx, video, canvas.width, canvas.height, clip.effects, fxT);
  };

  const prevRenderers = player.renderers.slice();
  const prevOnTick = player.onTick;

  player.renderers = [...prevRenderers, exportRenderer];

  hooks.onStart?.(canvas.width, canvas.height, mime);
  recorder.start(250);

  const duration = totalDuration();

  await new Promise((resolve) => {
    let started = false;
    player.onTick = (info) => {
      if (prevOnTick) prevOnTick(info);
      const f = duration > 0 ? Math.min(1, info.time / duration) : 0;
      hooks.onProgress?.(f, info.time, duration);
      if (!started) return;
      if (!player.playing || info.time >= duration - 0.02 || cancelled) {
        resolve();
      }
    };
    seek(0);
    // pequena pausa para o primeiro frame entrar no canvas
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (cancelled) {
          resolve();
          return;
        }
        started = true;
        play();
      }, 120);
    });
  });

  pause();
  player.renderers = prevRenderers;
  player.onTick = prevOnTick;

  // Garante que o último frame é capturado antes de parar.
  await new Promise((r) => setTimeout(r, 150));
  try { recorder.stop(); } catch { /* ignorar */ }
  await stopped;

  if (cancelled || !chunks.length) return null;

  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  return blob;
}

/** Guarda/apresenta o blob exportado para o utilizador. */
export function deliverBlob(blob, { filename } = {}) {
  const ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
  const name = filename || `gelo-edit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
  return { url: URL.createObjectURL(blob), name };
}
