/**
 * state.js — estado global do projeto e modelo de dados.
 *
 * Um projeto é uma lista ordenada de clipes. Cada clipe referencia o seu
 * ficheiro de vídeo (elemento <video> próprio), pontos de entrada/saída,
 * velocidade, speed ramp, efeitos e volume.
 *
 * Eventos emitidos: 'clips', 'selection', 'music', 'settings'.
 */

/* ---------------- Estado ---------------- */

export const state = {
  clips: [],          // lista de clipes (ver createClip)
  music: null,        // { file, url, el, volume, muted, offset }
  selectionId: null,  // id do clipe selecionado
  masterVolume: 1,
  masterMuted: false,
  exportSettings: { height: 720, fps: 30 },
};

let uidCounter = 0;
export function uid() {
  return `clip_${Date.now().toString(36)}_${(uidCounter++).toString(36)}`;
}

export function createClip({ file, url, video, name, width, height, duration }) {
  return {
    id: uid(),
    file,
    url,
    name: name || 'Vídeo',
    video,            // elemento <video> dedicado a este clipe
    width, height,    // dimensões naturais
    duration,         // duração total do ficheiro (s)
    in: 0,            // ponto de entrada no ficheiro (s)
    out: duration,    // ponto de saída no ficheiro (s)
    speed: 1,         // velocidade base (0.25 – 4)
    reverse: false,   // reproduzir ao contrário
    ramp: null,       // [{ t: 0..1, speed }] ou null
    effects: [],      // [{ id, intensity }]
    volume: 1,
    muted: false,
    thumb: null,      // dataURL da miniatura
    _map: null,       // cache do mapa de tempos (interno)
  };
}

/* ---------------- Pub/sub ---------------- */

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function emit(event, data) {
  listeners.get(event)?.forEach((fn) => {
    try { fn(data); } catch (err) { console.error(`[state] erro em listener '${event}'`, err); }
  });
}

/* ---------------- Operações sobre clipes ---------------- */

export function getClip(id) {
  return state.clips.find((c) => c.id === id) || null;
}

export function getSelected() {
  return getClip(state.selectionId);
}

export function select(id) {
  if (state.selectionId === id) return;
  state.selectionId = id;
  emit('selection', id);
}

export function addClip(clip, index = state.clips.length) {
  state.clips.splice(index, 0, clip);
  if (!state.selectionId) state.selectionId = clip.id;
  emit('clips', state.clips);
}

export function removeClip(id) {
  const i = state.clips.findIndex((c) => c.id === id);
  if (i < 0) return;
  const [clip] = state.clips.splice(i, 1);
  try { clip.video?.pause(); } catch { /* ignorar */ }
  if (state.selectionId === id) {
    state.selectionId = state.clips[Math.min(i, state.clips.length - 1)]?.id ?? null;
    emit('selection', state.selectionId);
  }
  emit('clips', state.clips);
}

function cloneVideoEl(clip) {
  // Elemento <video> próprio para a cópia (partilhar o mesmo elemento
  // causaria conflitos de reprodução e de áudio).
  if (typeof document === 'undefined') return clip.video;
  const v = document.createElement('video');
  v.preload = 'auto';
  v.playsInline = true;
  v.src = clip.url;
  return v;
}

export function duplicateClip(id) {
  const clip = getClip(id);
  if (!clip) return null;
  const copy = {
    ...clip,
    id: uid(),
    video: cloneVideoEl(clip),
    _map: null,
    effects: clip.effects.map((e) => ({ ...e })),
  };
  const i = state.clips.findIndex((c) => c.id === id);
  state.clips.splice(i + 1, 0, copy);
  emit('clips', state.clips);
  emit('selection', copy.id);
  return copy;
}

export function moveClip(id, newIndex) {
  const i = state.clips.findIndex((c) => c.id === id);
  if (i < 0) return;
  newIndex = Math.max(0, Math.min(state.clips.length - 1, newIndex));
  if (i === newIndex) return;
  const [clip] = state.clips.splice(i, 1);
  state.clips.splice(newIndex, 0, clip);
  emit('clips', state.clips);
}

export function splitClip(id, localT) {
  const clip = getClip(id);
  if (!clip) return null;
  const map = getMap(clip);
  if (localT <= 0.12 || localT >= map.total - 0.12) return null;

  // Tempo no ficheiro onde ocorre a divisão.
  let srcT = map.srcAt(localT);
  if (clip.reverse) srcT = clip.in + clip.out - srcT;
  srcT = Math.max(clip.in + 0.05, Math.min(clip.out - 0.05, srcT));

  const right = {
    ...clip,
    id: uid(),
    _map: null,
    effects: clip.effects.map((e) => ({ ...e })),
    in: srcT,
  };
  clip.out = srcT;
  clip._map = null;

  const i = state.clips.findIndex((c) => c.id === id);
  state.clips.splice(i + 1, 0, right);
  emit('clips', state.clips);
  emit('selection', clip.id);
  return right;
}

export function notifyClips() {
  emit('clips', state.clips);
}

/* ---------------- Mapa de tempos (velocidade / ramp / reverso) ----------------
 *
 * Converte entre "tempo do projeto" (a timeline) e "tempo no ficheiro".
 * Com velocidade constante s: duração do projeto = (out - in) / s.
 * Com speed ramp: duração = ∫ 1/s(u) du — aproximada numericamente.
 */

function rampSpeed(clip, u) {
  const base = clip.speed > 0 ? clip.speed : 1;
  if (!clip.ramp || clip.ramp.length < 2) return base;
  const keys = clip.ramp;
  if (u <= keys[0].t) return keys[0].speed;
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i].t) {
      const a = keys[i - 1];
      const b = keys[i];
      const f = (u - a.t) / Math.max(1e-6, b.t - a.t);
      return a.speed + (b.speed - a.speed) * f;
    }
  }
  return keys[keys.length - 1].speed;
}

export function getMap(clip) {
  const sig = [
    clip.in.toFixed(4),
    clip.out.toFixed(4),
    clip.speed.toFixed(4),
    clip.ramp ? clip.ramp.map((k) => `${k.t.toFixed(3)}:${k.speed.toFixed(3)}`).join(',') : '-',
  ].join('|');

  if (clip._map && clip._map.sig === sig) return clip._map;

  const srcLen = Math.max(0.05, clip.out - clip.in);
  const n = 128;
  const step = srcLen / n;
  const cum = new Float64Array(n + 1);
  const sp = new Float64Array(n + 1);

  for (let i = 0; i <= n; i++) {
    const u = i / n;
    sp[i] = Math.min(16, Math.max(0.05, rampSpeed(clip, u)));
    if (i > 0) cum[i] = cum[i - 1] + step / sp[i];
  }
  const total = Math.max(0.05, cum[n]);

  function locate(t) {
    const tc = Math.max(0, Math.min(total, t));
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < tc) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const t0 = cum[i - 1];
    const t1 = cum[i];
    const f = t1 > t0 ? (tc - t0) / (t1 - t0) : 0;
    return { i: i - 1 + f, u: (i - 1 + f) / n };
  }

  clip._map = {
    sig,
    total,
    /** Tempo no ficheiro para um tempo local do projeto (sem reverso). */
    srcAt(t) {
      return clip.in + locate(t).u * srcLen;
    },
    /** Velocidade instantânea num tempo local do projeto. */
    speedAt(t) {
      const { i } = locate(t);
      const lo = Math.floor(i);
      const hi = Math.min(n, lo + 1);
      const f = i - lo;
      return sp[lo] + (sp[hi] - sp[lo]) * f;
    },
  };
  return clip._map;
}

/** Tempo no ficheiro para um tempo local do projeto, já a considerar reverso. */
export function srcTimeFor(clip, localT) {
  const map = getMap(clip);
  const t = Math.max(0, Math.min(map.total, localT));
  const fwd = map.srcAt(t);
  return clip.reverse ? clip.in + clip.out - fwd : fwd;
}

/* ---------------- Durações e procura ---------------- */

export function clipStart(index) {
  let t = 0;
  for (let i = 0; i < index && i < state.clips.length; i++) {
    t += getMap(state.clips[i]).total;
  }
  return t;
}

export function totalDuration() {
  let t = 0;
  for (const c of state.clips) t += getMap(c).total;
  return t;
}

export function findClipAt(t) {
  if (!state.clips.length) return null;
  let acc = 0;
  for (let i = 0; i < state.clips.length; i++) {
    const clip = state.clips[i];
    const total = getMap(clip).total;
    if (t < acc + total || i === state.clips.length - 1) {
      return {
        clip,
        index: i,
        start: acc,
        localT: Math.max(0, Math.min(total, t - acc)),
      };
    }
    acc += total;
  }
  return null;
}

/* ---------------- Utilitários ---------------- */

export function formatTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const d = Math.floor((s * 10) % 10);
  return `${m}:${String(sec).padStart(2, '0')}.${d}`;
}
