/**
 * timeline.js — interface da timeline: clipes, miniaturas, alças de corte,
 * reordenação por arrastar (toque) e playhead.
 *
 * Largura de cada clipe ≈ duração × PPS, com limites mínimo/máximo.
 */

import {
  state,
  getMap,
  select,
  moveClip,
  notifyClips,
  totalDuration,
  formatTime,
} from './state.js';
import { seek, player, refresh } from './player.js';

const PPS = 72;        // pixels por segundo
const MIN_W = 64;      // largura mínima de um clipe (px)
const MAX_W = 420;     // largura máxima de um clipe (px)

let els = null;
let layout = [];       // [{ clip, x, w }]
let onSeekDrag = null;

export function initTimeline({ scroll, content, ruler, track, playhead, grip }) {
  els = { scroll, content, ruler, track, playhead, grip };

  // Tocar/deslizar no punho do playhead para navegar.
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startTime = player.time;
    let moved = false;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 2) moved = true;
      const dt = dx / PPS;
      seek(startTime + dt);
    };
    const onUp = (ev) => {
      grip.releasePointerCapture?.(ev.pointerId);
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      if (onSeekDrag && moved) onSeekDrag();
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  });

  // Tocar na régua para posicionar o playhead.
  ruler.addEventListener('pointerdown', (e) => {
    const rect = els.content.getBoundingClientRect();
    const t = timeFromX(e.clientX - rect.left);
    seek(t);
  });

  render();
}

export function setSeekDragHandler(fn) {
  onSeekDrag = fn;
}

/* ---------------- Layout ---------------- */

function clipWidth(clip) {
  const w = getMap(clip).total * PPS;
  return Math.max(MIN_W, Math.min(MAX_W, w));
}

function computeLayout() {
  layout = [];
  let x = 0;
  for (const clip of state.clips) {
    const w = clipWidth(clip);
    layout.push({ clip, x, w });
    x += w + 4;
  }
}

/** Converte x (px dentro da timeline) em tempo do projeto. */
export function timeFromX(x) {
  if (!layout.length) return 0;
  for (const item of layout) {
    if (x < item.x + item.w || item === layout[layout.length - 1]) {
      const f = Math.max(0, Math.min(1, (x - item.x) / item.w));
      const total = getMap(item.clip).total;
      const start = layoutStart(item);
      return start + f * total;
    }
  }
  return totalDuration();
}

function layoutStart(item) {
  let t = 0;
  for (const it of layout) {
    if (it === item) break;
    t += getMap(it.clip).total;
  }
  return t;
}

/** Posição em px do playhead para um tempo do projeto. */
export function xFromTime(t) {
  if (!layout.length) return 0;
  let acc = 0;
  for (const item of layout) {
    const total = getMap(item.clip).total;
    if (t < acc + total || item === layout[layout.length - 1]) {
      const f = Math.max(0, Math.min(1, (t - acc) / total));
      return item.x + f * item.w;
    }
    acc += total;
  }
  return layout[layout.length - 1].x + layout[layout.length - 1].w;
}

/* ---------------- Render ---------------- */

export function render() {
  if (!els) return;
  computeLayout();

  // Clipes
  els.track.innerHTML = '';
  for (const item of layout) {
    els.track.appendChild(buildClipEl(item));
  }

  // Régua: marcas no início de cada clipe + intermédias
  els.ruler.innerHTML = '';
  let acc = 0;
  for (const item of layout) {
    const total = getMap(item.clip).total;
    const mark = document.createElement('div');
    mark.className = 'ruler-mark';
    mark.style.left = `${item.x}px`;
    mark.textContent = formatTime(acc);
    els.ruler.appendChild(mark);

    // marca intermédia a meio do clipe
    const mid = document.createElement('div');
    mid.className = 'ruler-mark';
    mid.style.left = `${item.x + item.w / 2}px`;
    mid.style.borderLeftStyle = 'dotted';
    mid.textContent = '';
    els.ruler.appendChild(mid);

    acc += total;
  }

  const width = layout.length ? layout[layout.length - 1].x + layout[layout.length - 1].w + 8 : 0;
  els.content.style.width = `${Math.max(width, els.scroll.clientWidth - 24)}px`;
  updatePlayhead();
}

function buildClipEl(item) {
  const { clip, w } = item;
  const el = document.createElement('div');
  el.className = 'clip' + (clip.id === state.selectionId ? ' selected' : '');
  el.style.width = `${w}px`;
  if (clip.thumb) el.style.backgroundImage = `url(${clip.thumb})`;
  el.dataset.id = clip.id;

  const shade = document.createElement('div');
  shade.className = 'clip-shade';
  el.appendChild(shade);

  const badges = document.createElement('div');
  badges.className = 'clip-badge';
  const map = getMap(clip);
  const speedBadge = clip.reverse ? 'REV' : clip.speed !== 1 ? `${clip.speed.toFixed(2).replace(/\.?0+$/, '')}x` : '';
  if (speedBadge) {
    const b = document.createElement('span');
    b.textContent = speedBadge;
    badges.appendChild(b);
  }
  if (clip.effects.length) {
    const b = document.createElement('span');
    b.textContent = `FX ${clip.effects.length}`;
    badges.appendChild(b);
  }
  if (clip.muted) {
    const b = document.createElement('span');
    b.textContent = 'MUTE';
    badges.appendChild(b);
  }
  el.appendChild(badges);

  const label = document.createElement('div');
  label.className = 'clip-label';
  label.textContent = `${clip.name} · ${map.total.toFixed(1)}s`;
  el.appendChild(label);

  // Alças de corte (visíveis apenas quando selecionado)
  const left = document.createElement('div');
  left.className = 'trim-handle left';
  const right = document.createElement('div');
  right.className = 'trim-handle right';
  el.appendChild(left);
  el.appendChild(right);

  wireClipInteractions(el, clip, left, right);
  return el;
}

export function updatePlayhead() {
  if (!els) return;
  const x = xFromTime(player.time);
  els.playhead.style.left = `${x}px`;

  // Auto-scroll para manter o playhead visível durante a reprodução.
  if (player.playing) {
    const sc = els.scroll;
    const rel = x - sc.scrollLeft;
    if (rel > sc.clientWidth * 0.72 || rel < 0) {
      sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.4);
    }
  }
}

export function scrollIntoView(t) {
  if (!els) return;
  const x = xFromTime(t);
  els.scroll.scrollLeft = Math.max(0, x - els.scroll.clientWidth * 0.4);
}

/* ---------------- Interações ---------------- */

function wireClipInteractions(el, clip, handleL, handleR) {
  // --- Corte pelas alças ---
  for (const [handle, side] of [[handleL, 'left'], [handleR, 'right']]) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startIn = clip.in;
      const startOut = clip.out;
      const map = getMap(clip);
      const pxPerProj = Math.max(20, clipWidth(clip) / Math.max(0.1, map.total));
      const labelEl = el.querySelector('.clip-label');

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dProj = dx / pxPerProj;
        const speed = Math.max(0.05, map.speedAt(side === 'left' ? 0 : map.total));
        const dSrc = dProj * speed;

        if (side === 'left') {
          clip.in = Math.max(0, Math.min(startOut - 0.2, startIn + dSrc));
        } else {
          clip.out = Math.max(startIn + 0.2, Math.min(clip.duration, startOut + dSrc));
        }
        clip._map = null;

        // Atualização em direto (sem reconstruir a timeline durante o arraste).
        const w = clipWidth(clip);
        el.style.width = `${w}px`;
        if (labelEl) labelEl.textContent = `${clip.name} · ${getMap(clip).total.toFixed(1)}s`;
        refresh();
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        notifyClips(); // re-render completo no fim do gesto
        refresh();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  // --- Selecionar / procurar / reordenar ---
  el.addEventListener('pointerdown', (e) => {
    if (e.target === handleL || e.target === handleR) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const pointerType = e.pointerType;
    let mode = null; // 'drag' | 'scroll' | null
    let targetIndex = state.clips.findIndex((c) => c.id === clip.id);

    // Reordenação: no toque, espera-se um "long press"; no rato, basta arrastar.
    const longPress = pointerType === 'mouse'
      ? 0
      : setTimeout(() => {
          if (!mode) startDrag();
        }, 320);

    function startDrag() {
      mode = 'drag';
      if (navigator.vibrate) navigator.vibrate(12);
      el.classList.add('dragging');
      targetIndex = state.clips.findIndex((c) => c.id === clip.id);
    }

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      if (!mode) {
        if (pointerType === 'mouse' && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
          startDrag();
        } else if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
          // O utilizador está a fazer scroll — cancelamos a intenção de arrastar.
          clearTimeout(longPress);
          mode = 'scroll';
        }
        return;
      }

      if (mode === 'drag') {
        ev.preventDefault();
        el.style.transform = `translateX(${dx}px) scale(1.03)`;

        // Calcula o índice de destino pela posição do dedo.
        const rect = els.track.getBoundingClientRect();
        const x = ev.clientX - rect.left + els.scroll.scrollLeft - 4;
        let idx = layout.length;
        for (let i = 0; i < layout.length; i++) {
          const it = layout[i];
          if (x < it.x + it.w / 2) {
            idx = i;
            break;
          }
        }
        targetIndex = idx;
      }
    };

    const onUp = (ev) => {
      clearTimeout(longPress);
      el.releasePointerCapture?.(ev.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.style.transform = '';

      if (mode === 'drag') {
        el.classList.remove('dragging');
        const from = state.clips.findIndex((c) => c.id === clip.id);
        let to = targetIndex;
        if (to > from) to -= 1; // o item sai da posição original
        if (to !== from && to >= 0) {
          moveClip(clip.id, to);
        }
        return;
      }

      if (mode) return; // scroll — não selecionamos

      // Toque simples: seleciona e posiciona o playhead nesse ponto.
      // (Medimos ANTES de selecionar — selecionar reconstrói a timeline.)
      const rect = el.getBoundingClientRect();
      const f = rect.width > 0 ? Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)) : 0;
      const item = layout.find((it) => it.clip.id === clip.id);
      const startT = item ? layoutStart(item) : 0;
      const total = getMap(clip).total;
      select(clip.id);
      seek(startT + f * total);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });
}

export function getSelectedClipElement(id) {
  return els?.track.querySelector(`.clip[data-id="${id}"]`) || null;
}
