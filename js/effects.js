/**
 * effects.js — filtros e efeitos visuais.
 *
 * Todos os efeitos são aplicados sobre um canvas, o que permite pré-visualizar
 * e exportar exatamente o mesmo resultado.
 *
 * Para adicionar um novo efeito:
 *   1. Adicione uma entrada em EFFECTS (label, cat e, se for de cor, style).
 *   2. Se for um efeito de sobreposição (overlay), adicione a função em OVERLAYS.
 * A interface em js/app.js mostra automaticamente os efeitos registados aqui.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/* ---------------- Registo de efeitos ---------------- */

export const EFFECTS = {
  // Estilos de filme
  film70: {
    label: 'Filme 70',
    cat: 'filme',
    style: (k) =>
      `sepia(${(0.38 * k).toFixed(3)}) saturate(${(1 + 0.35 * k).toFixed(3)}) contrast(${(1 - 0.08 * k).toFixed(3)}) brightness(${(1 + 0.07 * k).toFixed(3)})`,
  },
  film80: {
    label: 'Filme 80',
    cat: 'filme',
    style: (k) =>
      `saturate(${(1 + 0.6 * k).toFixed(3)}) contrast(${(1 + 0.2 * k).toFixed(3)}) hue-rotate(${(-8 * k).toFixed(1)}deg) brightness(${(1 + 0.03 * k).toFixed(3)})`,
  },
  film90: {
    label: 'Filme 90',
    cat: 'filme',
    style: (k) =>
      `saturate(${(1 - 0.15 * k).toFixed(3)}) contrast(${(1 - 0.1 * k).toFixed(3)}) brightness(${(1 + 0.08 * k).toFixed(3)}) hue-rotate(${(12 * k).toFixed(1)}deg)`,
  },

  // Retrô
  vhs: { label: 'VHS', cat: 'retro' },
  glitch: { label: 'Glitch', cat: 'retro' },
  grain: { label: 'Grão', cat: 'retro' },

  // Cor
  bw: { label: 'P&B', cat: 'cor', style: (k) => `grayscale(${k.toFixed(3)})` },
  sepia: { label: 'Sépia', cat: 'cor', style: (k) => `sepia(${(0.7 * k).toFixed(3)})` },
  warm: {
    label: 'Quente',
    cat: 'cor',
    style: (k) => `sepia(${(0.22 * k).toFixed(3)}) saturate(${(1 + 0.25 * k).toFixed(3)})`,
  },
  cool: {
    label: 'Frio',
    cat: 'cor',
    style: (k) => `hue-rotate(${(14 * k).toFixed(1)}deg) saturate(${(1 + 0.08 * k).toFixed(3)}) brightness(${(1 + 0.03 * k).toFixed(3)})`,
  },
  invert: { label: 'Inverter', cat: 'cor', style: (k) => `invert(${k.toFixed(3)})` },

  // Movimento
  shake: { label: 'Shake', cat: 'movimento' },
  zoom: { label: 'Zoom', cat: 'movimento' },

  // Luz
  flash: { label: 'Flash', cat: 'luz' },
  vignette: { label: 'Vinheta', cat: 'luz' },
};

export function defaultIntensity() {
  return 0.7;
}

/* ---------------- Construção do filtro CSS ---------------- */

export function buildFilterString(effects) {
  const parts = [];
  for (const e of effects || []) {
    const def = EFFECTS[e.id];
    if (def?.style) parts.push(def.style(clamp01(e.intensity ?? 0.7)));
  }
  return parts.length ? parts.join(' ') : 'none';
}

function fx(effects, id) {
  return (effects || []).find((e) => e.id === id) || null;
}

function amp(effect, scale = 1) {
  return effect ? (0.35 + 0.65 * clamp01(effect.intensity ?? 0.7)) * scale : 0;
}

/* ---------------- Ruído (grão) ---------------- */

let noiseCanvas = null;
function getNoise() {
  if (noiseCanvas) return noiseCanvas;
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const x = c.getContext('2d');
  const img = x.createImageData(96, 96);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  noiseCanvas = c;
  return c;
}

/* ---------------- Desenho base ---------------- */

export function drawCover(ctx, video, W, H, scale = 1, dx = 0, dy = 0) {
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const s = Math.max(W / vw, H / vh) * scale;
  const w = vw * s;
  const h = vh * s;
  ctx.drawImage(video, (W - w) / 2 + dx, (H - h) / 2 + dy, w, h);
}

/* ---------------- Overlays ---------------- */

function drawVignette(ctx, W, H, k) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${(0.55 * k).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawGrain(ctx, W, H, k, t) {
  const pat = ctx.createPattern(getNoise(), 'repeat');
  if (!pat) return;
  ctx.save();
  ctx.globalAlpha = 0.12 * k;
  ctx.globalCompositeOperation = 'overlay';
  // Desloca o padrão em cada frame para o grão "viver".
  const ox = ((t * 611) | 0) % 96;
  const oy = ((t * 389) | 0) % 96;
  ctx.translate(-ox, -oy);
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, W + 96, H + 96);
  ctx.restore();
}

function drawVhs(ctx, video, W, H, k, t) {
  // Fantasma de croma (magenta/ciano deslocado)
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.10 * k;
  ctx.filter = 'hue-rotate(-40deg) saturate(2.2)';
  drawCover(ctx, video, W, H, 1.002, -5 * k, 0);
  ctx.filter = 'hue-rotate(150deg) saturate(2.2)';
  drawCover(ctx, video, W, H, 1.002, 5 * k, 0);
  ctx.restore();

  // Linhas de varrimento
  ctx.save();
  ctx.globalAlpha = 0.16 * k;
  ctx.fillStyle = '#000';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1.6);
  ctx.restore();

  // Faixa de tracking a atravessar o ecrã
  const y0 = ((t * 95) % (H + 260)) - 130;
  const g = ctx.createLinearGradient(0, y0, 0, y0 + 96);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, `rgba(255,255,255,${(0.14 * k).toFixed(3)})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, W, 96);

  // Leve instabilidade horizontal
  ctx.save();
  ctx.globalAlpha = 0.06 * k;
  ctx.fillStyle = '#7fdcff';
  for (let i = 0; i < 3; i++) {
    const y = ((t * (73 + i * 41)) % H) | 0;
    ctx.fillRect(0, y, W, 2);
  }
  ctx.restore();
}

function drawGlitch(ctx, W, H, k, t) {
  // Comporta temporal: o glitch aparece em rajadas.
  const gate = Math.sin(t * 2.7) * 0.5 + Math.sin(t * 7.3) * 0.25 + 0.5;
  if (gate < 0.72) return;

  const slices = 3 + ((gate * 6) | 0);
  for (let i = 0; i < slices; i++) {
    const sy = Math.random() * H;
    const sh = 8 + Math.random() * H * 0.09;
    const dx = (Math.random() - 0.5) * W * 0.14 * k;
    try { ctx.drawImage(ctx.canvas, 0, sy, W, sh, dx, sy, W, sh); } catch { /* ignorar */ }
  }

  // Separação RGB aproximada
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.22 * k;
  try {
    ctx.drawImage(ctx.canvas, -7 * k, 0);
    ctx.drawImage(ctx.canvas, 7 * k, 0);
  } catch { /* ignorar */ }
  ctx.restore();

  // Bloco digital
  if (Math.random() < 0.35) {
    ctx.save();
    ctx.globalAlpha = 0.25 * k;
    ctx.fillStyle = Math.random() < 0.5 ? '#5cc8ff' : '#ff4d6d';
    const bh = 6 + Math.random() * 30;
    ctx.fillRect(0, Math.random() * H, W, bh);
    ctx.restore();
  }
}

function drawFlash(ctx, W, H, k, t) {
  const period = 2.3 - 1.3 * k;
  const ph = ((t % period) + period) % period;
  const dur = 0.1;
  if (ph >= dur) return;
  const a = (1 - ph / dur) * 0.85 * k;
  ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
}

/* ---------------- Render de um frame completo ---------------- */

/**
 * Desenha um frame do vídeo com todos os efeitos aplicados.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLVideoElement} video
 * @param {number} W largura do canvas
 * @param {number} H altura do canvas
 * @param {Array} effects lista [{id, intensity}]
 * @param {number} t tempo global (s) — usado para animações dos efeitos
 */
export function renderFrame(ctx, video, W, H, effects, t) {
  const list = effects || [];
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  if (video && video.readyState >= 2) {
    // Transformações: shake + zoom
    let scale = 1;
    let dx = 0;
    let dy = 0;

    const shake = fx(list, 'shake');
    if (shake) {
      const a = amp(shake, 0.016) * Math.min(W, H);
      dx = Math.sin(t * 23.3) * a + Math.sin(t * 41.7) * 0.6 * a;
      dy = Math.cos(t * 19.1) * a + Math.cos(t * 33.9) * 0.6 * a;
    }

    const zoom = fx(list, 'zoom');
    if (zoom) {
      scale = 1 + amp(zoom, 0.22) * (0.5 + 0.5 * Math.sin(t * 0.8));
    }

    ctx.filter = buildFilterString(list);
    drawCover(ctx, video, W, H, scale, dx, dy);
    ctx.filter = 'none';
  }

  // Overlays
  const vhs = fx(list, 'vhs');
  if (vhs && video && video.readyState >= 2) drawVhs(ctx, video, W, H, amp(vhs), t);

  const glitch = fx(list, 'glitch');
  if (glitch) drawGlitch(ctx, W, H, amp(glitch), t);

  const flash = fx(list, 'flash');
  if (flash) drawFlash(ctx, W, H, amp(flash), t);

  const grain = fx(list, 'grain');
  if (grain) drawGrain(ctx, W, H, amp(grain), t);

  const vig = fx(list, 'vignette');
  if (vig) drawVignette(ctx, W, H, amp(vig));

  ctx.restore();
}

/** Desenha o estado vazio do canvas (sem clipes). */
export function renderEmpty(ctx, W, H, t) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#10151d');
  g.addColorStop(1, '#0b0e13');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
