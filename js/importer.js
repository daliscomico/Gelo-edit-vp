/**
 * importer.js — importação de vídeos e música do dispositivo.
 *
 * No Android, o <input type="file"> abre a galeria/ficheiros. Um botão
 * separado com capture="environment" permite gravar diretamente com a câmara.
 */

import { state, createClip, addClip } from './state.js';
import * as audio from './audio.js';

/** Carrega metadados de um ficheiro de vídeo e gera miniatura. */
function loadVideoFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.playsInline = true;
    video.muted = false;
    video.crossOrigin = 'anonymous';
    video.src = url;

    const fail = (msg) => {
      URL.revokeObjectURL(url);
      reject(new Error(msg || `Não foi possível abrir ${file.name}`));
    };

    video.addEventListener('error', () => fail(), { once: true });

    video.addEventListener('loadedmetadata', async () => {
      // Alguns ficheiros WebM reportam duração "Infinity" até ser forçada.
      let duration = video.duration;
      if (!isFinite(duration) || duration <= 0) {
        duration = await new Promise((res) => {
          const onDur = () => {
            if (isFinite(video.duration) && video.duration > 0) {
              video.removeEventListener('durationchange', onDur);
              res(video.duration);
            }
          };
          video.addEventListener('durationchange', onDur);
          try { video.currentTime = 1e7; } catch { res(0); }
          setTimeout(() => {
            video.removeEventListener('durationchange', onDur);
            res(isFinite(video.duration) && video.duration > 0 ? video.duration : 0);
          }, 3000);
        });
        try { video.currentTime = 0; } catch { /* ignorar */ }
      }
      if (!(duration > 0)) return fail('Vídeo sem duração válida');

      const clip = createClip({
        file,
        url,
        video,
        name: file.name.replace(/\.[^.]+$/, ''),
        width: video.videoWidth || 1280,
        height: video.videoHeight || 720,
        duration,
      });

      // Miniatura: tenta um frame aos 10% (ou 0.5 s).
      const makeThumb = () => {
        try {
          const c = document.createElement('canvas');
          const tw = 160;
          c.width = tw;
          c.height = Math.round(tw * (video.videoHeight / video.videoWidth) || 90);
          const x = c.getContext('2d');
          x.drawImage(video, 0, 0, c.width, c.height);
          clip.thumb = c.toDataURL('image/jpeg', 0.7);
        } catch { /* sem miniatura */ }
        video.pause();
        try { video.currentTime = 0; } catch { /* ignorar */ }
        resolve(clip);
      };

      const target = Math.min(Math.max(0.5, duration * 0.1), Math.max(0.1, duration - 0.1));
      let done = false;
      const onSeeked = () => {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', onSeeked);
        makeThumb();
      };
      video.addEventListener('seeked', onSeeked);
      // Timeout de segurança: nem todos os formatos emitem 'seeked' a tempo.
      setTimeout(() => {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', onSeeked);
        makeThumb();
      }, 2500);

      try { video.currentTime = target; } catch { onSeeked(); }
    });
  });
}

/** Importa vários ficheiros de vídeo. Devolve o número de clipes adicionados. */
export async function importVideoFiles(fileList, { toast } = {}) {
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|3gp|m4v)$/i.test(f.name));
  if (!files.length) {
    toast?.('Nenhum vídeo válido encontrado.');
    return 0;
  }

  let added = 0;
  for (const file of files) {
    try {
      toast?.(`A carregar ${file.name}…`);
      const clip = await loadVideoFile(file);
      addClip(clip);
      audio.bindVideo(clip);
      added++;
    } catch (err) {
      console.error(err);
      toast?.(`Falha ao carregar ${file.name}.`);
    }
  }
  if (added) toast?.(`${added} vídeo${added > 1 ? 's' : ''} importado${added > 1 ? 's' : ''}.`);
  return added;
}

/** Importa um ficheiro de música. */
export function importMusicFile(file, { toast } = {}) {
  if (!file) return false;
  const url = URL.createObjectURL(file);
  const el = new Audio();
  el.src = url;
  el.preload = 'auto';
  el.loop = true;

  audio.setMusic({
    file,
    url,
    el,
    name: file.name,
    volume: 0.8,
    muted: false,
    offset: 0,
  });
  toast?.(`Música carregada: ${file.name}`);
  return true;
}
