/**
 * app.js — arranque e ligação da interface ao motor do editor.
 *
 * Este módulo apenas liga botões/sliders ao estado e aos módulos funcionais.
 * Para adicionar novos controlos: crie o elemento em index.html, ligue-o aqui
 * e, se necessário, acrescente a lógica num módulo próprio.
 */

import {
  state,
  on,
  getSelected,
  removeClip,
  duplicateClip,
  moveClip,
  splitClip,
  notifyClips,
  totalDuration,
  findClipAt,
  clipStart,
  formatTime,
} from './state.js';
import { EFFECTS, defaultIntensity } from './effects.js';
import { player, initPlayer, toggle, pause, seek, refresh, fitCanvasToClip } from './player.js';
import { initTimeline, render as renderTimeline, updatePlayhead, setSeekDragHandler, scrollIntoView } from './timeline.js';
import { importVideoFiles, importMusicFile } from './importer.js';
import * as audio from './audio.js';
import { exportProject, deliverBlob } from './exporter.js';

/* ---------------- Utilitários de UI ---------------- */

const $ = (id) => document.getElementById(id);

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------------- Arranque ---------------- */

const preview = $('preview');

initPlayer({ previewCanvas: preview });

initTimeline({
  scroll: $('timeline-scroll'),
  content: $('timeline-content'),
  ruler: $('ruler'),
  track: $('track'),
  playhead: $('playhead'),
  grip: document.querySelector('#playhead .playhead-grip'),
});

setSeekDragHandler(() => {});

player.onTick = ({ time, duration, playing }) => {
  $('time-now').textContent = formatTime(time);
  $('time-total').textContent = formatTime(duration);
  $('icon-play').classList.toggle('hidden', playing);
  $('icon-pause').classList.toggle('hidden', !playing);
  updatePlayhead();
};

/* ---------------- Importação ---------------- */

const videoInput = $('video-input');
const cameraInput = $('camera-input');
const musicInput = $('music-input');

function openVideoPicker() {
  videoInput.value = '';
  videoInput.click();
}

$('btn-import').addEventListener('click', openVideoPicker);
$('btn-import-2').addEventListener('click', openVideoPicker);
$('btn-camera').addEventListener('click', () => {
  cameraInput.value = '';
  cameraInput.click();
});

videoInput.addEventListener('change', async () => {
  const added = await importVideoFiles(videoInput.files, { toast });
  if (added) onClipsChanged();
});

cameraInput.addEventListener('change', async () => {
  const added = await importVideoFiles(cameraInput.files, { toast });
  if (added) onClipsChanged();
});

$('btn-music').addEventListener('click', () => {
  musicInput.value = '';
  musicInput.click();
});

musicInput.addEventListener('change', () => {
  const file = musicInput.files?.[0];
  if (file) {
    importMusicFile(file, { toast });
    audio.bindAll();
    syncMusicUI();
  }
});

/* ---------------- Transporte ---------------- */

$('btn-play').addEventListener('click', () => {
  if (!state.clips.length) {
    toast('Importe um vídeo primeiro.');
    return;
  }
  toggle();
});

$('btn-prev').addEventListener('click', () => seek(0));
$('btn-next').addEventListener('click', () => seek(totalDuration()));

$('btn-mute').addEventListener('click', () => {
  state.masterMuted = !state.masterMuted;
  audio.applyVolumes();
  $('icon-vol').classList.toggle('hidden', state.masterMuted);
  $('icon-vol-off').classList.toggle('hidden', !state.masterMuted);
  toast(state.masterMuted ? 'Som desligado' : 'Som ligado');
});

// Arrastar sobre a pré-visualização faz scrub.
let scrubbing = false;
preview.addEventListener('pointerdown', (e) => {
  if (!state.clips.length) return;
  scrubbing = true;
  preview.setPointerCapture(e.pointerId);
});
preview.addEventListener('pointermove', (e) => {
  if (!scrubbing) return;
  const rect = preview.getBoundingClientRect();
  const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  seek(f * totalDuration());
});
const endScrub = (e) => {
  if (!scrubbing) return;
  scrubbing = false;
  preview.releasePointerCapture?.(e.pointerId);
};
preview.addEventListener('pointerup', endScrub);
preview.addEventListener('pointercancel', endScrub);

// Atalhos de teclado (para testes no computador).
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    toggle();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (getSelected()) deleteSelected();
  } else if (e.key.toLowerCase() === 's') {
    splitAtPlayhead();
  } else if (e.key === 'ArrowLeft') {
    seek(player.time - (e.shiftKey ? 0.1 : 1));
  } else if (e.key === 'ArrowRight') {
    seek(player.time + (e.shiftKey ? 0.1 : 1));
  }
});

/* ---------------- Painéis (tabs) ---------------- */

document.querySelectorAll('.dock-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.dock-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $(`panel-${tab.dataset.panel}`).classList.add('active');
  });
});

/* ---------------- Painel: Editar ---------------- */

function splitAtPlayhead() {
  const sel = getSelected();
  if (!sel) return toast('Selecione um clipe.');
  const loc = findClipAt(player.time);
  if (!loc || loc.clip !== sel) {
    return toast('Posicione o playhead dentro do clipe selecionado.');
  }
  const right = splitClip(sel.id, loc.localT);
  if (!right) toast('Muito perto da extremidade para dividir.');
  else {
    toast('Clipe dividido.');
    refresh();
  }
}

function deleteSelected() {
  const sel = getSelected();
  if (!sel) return;
  removeClip(sel.id);
  toast('Clipe apagado.');
  onClipsChanged();
}

$('btn-split').addEventListener('click', splitAtPlayhead);
$('btn-del').addEventListener('click', deleteSelected);

$('btn-trim-in').addEventListener('click', () => {
  const sel = getSelected();
  if (!sel) return;
  const loc = findClipAt(player.time);
  if (!loc || loc.clip !== sel) return toast('Posicione o playhead dentro do clipe.');
  const srcT = Math.min(sel.out - 0.15, Math.max(0, sel.in + (player.time - loc.start) * Math.max(0.05, sel.speed)));
  sel.in = srcT;
  sel._map = null;
  notifyClips();
  refresh();
  toast('Início cortado no playhead.');
});

$('btn-trim-out').addEventListener('click', () => {
  const sel = getSelected();
  if (!sel) return;
  const loc = findClipAt(player.time);
  if (!loc || loc.clip !== sel) return toast('Posicione o playhead dentro do clipe.');
  const srcT = Math.max(sel.in + 0.15, Math.min(sel.duration, sel.in + (player.time - loc.start) * Math.max(0.05, sel.speed)));
  sel.out = srcT;
  sel._map = null;
  notifyClips();
  refresh();
  toast('Fim cortado no playhead.');
});

$('btn-dup').addEventListener('click', () => {
  const sel = getSelected();
  if (!sel) return;
  duplicateClip(sel.id);
  toast('Clipe duplicado.');
  refresh();
});

$('btn-move-left').addEventListener('click', () => {
  const sel = getSelected();
  if (!sel) return;
  const i = state.clips.findIndex((c) => c.id === sel.id);
  if (i > 0) {
    moveClip(sel.id, i - 1);
    refresh();
    scrollIntoView(clipStart(i - 1));
  }
});

$('btn-move-right').addEventListener('click', () => {
  const sel = getSelected();
  if (!sel) return;
  const i = state.clips.findIndex((c) => c.id === sel.id);
  if (i < state.clips.length - 1) {
    moveClip(sel.id, i + 1);
    refresh();
    scrollIntoView(clipStart(i + 1));
  }
});

/* ---------------- Painel: Velocidade ---------------- */

const speedRange = $('speed-range');

function syncSpeedUI() {
  const sel = getSelected();
  const disabled = !sel;
  speedRange.disabled = disabled;
  document.querySelectorAll('.speed-chip').forEach((c) => (c.disabled = disabled));
  $('btn-reverse').disabled = disabled;
  $('btn-ramp-toggle').disabled = disabled;
  document.querySelectorAll('.ramp-chip').forEach((c) => (c.disabled = disabled));

  if (!sel) {
    $('speed-val').textContent = '—';
    return;
  }

  speedRange.value = sel.speed;
  $('speed-val').textContent = `${sel.speed.toFixed(2)}x`;
  document.querySelectorAll('.speed-chip').forEach((c) => {
    c.classList.toggle('active', Math.abs(parseFloat(c.dataset.speed) - sel.speed) < 0.001);
  });
  $('btn-reverse').classList.toggle('active', sel.reverse);

  const rampOn = !!sel.ramp;
  $('btn-ramp-toggle').classList.toggle('on', rampOn);
  $('btn-ramp-toggle').setAttribute('aria-checked', String(rampOn));
  $('ramp-sliders').classList.toggle('hidden', !(rampOn && sel.rampCustom));
  document.querySelectorAll('.ramp-chip').forEach((c) => {
    c.classList.toggle('active', rampOn && sel.rampPreset === c.dataset.ramp);
  });

  if (rampOn && sel.ramp) {
    document.querySelectorAll('.ramp-range').forEach((r, i) => {
      const k = sel.ramp[i];
      if (k) {
        r.value = k.speed;
        r.nextElementSibling.textContent = `${k.speed.toFixed(1)}x`;
      }
    });
  }
}

speedRange.addEventListener('input', () => {
  const sel = getSelected();
  if (!sel) return;
  sel.speed = parseFloat(speedRange.value);
  $('speed-val').textContent = `${sel.speed.toFixed(2)}x`;
  onClipSettingsChanged();
});

document.querySelectorAll('.speed-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const sel = getSelected();
    if (!sel) return;
    sel.speed = parseFloat(chip.dataset.speed);
    syncSpeedUI();
    onClipSettingsChanged();
    toast(`Velocidade ${sel.speed}x`);
  });
});

$('btn-reverse').addEventListener('click', () => {
  const sel = getSelected();
  if (!sel) return;
  sel.reverse = !sel.reverse;
  syncSpeedUI();
  onClipSettingsChanged();
  toast(sel.reverse ? 'Reprodução inversa ativada' : 'Reprodução normal');
});

const RAMP_PRESETS = {
  smooth: [
    { t: 0, speed: 1 },
    { t: 0.5, speed: 2.5 },
    { t: 1, speed: 1 },
  ],
  up: [
    { t: 0, speed: 1 },
    { t: 1, speed: 3 },
  ],
  down: [
    { t: 0, speed: 3 },
    { t: 1, speed: 1 },
  ],
};

$('btn-ramp-toggle').addEventListener('click', () => {
  const sel = getSelected();
  if (!sel) return;
  if (sel.ramp) {
    sel.ramp = null;
    sel.rampPreset = null;
    sel.rampCustom = false;
  } else {
    sel.ramp = RAMP_PRESETS.smooth.map((k) => ({ ...k }));
    sel.rampPreset = 'smooth';
    sel.rampCustom = false;
    toast('Speed ramp ativado (Suave)');
  }
  syncSpeedUI();
  onClipSettingsChanged();
});

document.querySelectorAll('.ramp-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const sel = getSelected();
    if (!sel) return;
    const preset = chip.dataset.ramp;
    sel.rampPreset = preset;

    if (preset === 'custom') {
      sel.rampCustom = true;
      if (!sel.ramp || sel.ramp.length !== 4) {
        sel.ramp = [
          { t: 0, speed: sel.speed },
          { t: 0.333, speed: sel.speed },
          { t: 0.666, speed: sel.speed },
          { t: 1, speed: sel.speed },
        ];
      }
    } else {
      sel.rampCustom = false;
      sel.ramp = RAMP_PRESETS[preset].map((k) => ({ ...k }));
    }
    syncSpeedUI();
    onClipSettingsChanged();
  });
});

document.querySelectorAll('.ramp-range').forEach((range) => {
  range.addEventListener('input', () => {
    const sel = getSelected();
    if (!sel || !sel.ramp) return;
    const i = parseInt(range.dataset.idx, 10);
    if (sel.ramp[i]) {
      sel.ramp[i].speed = parseFloat(range.value);
      range.nextElementSibling.textContent = `${range.value}x`;
      onClipSettingsChanged();
    }
  });
});

/* ---------------- Painel: Efeitos ---------------- */

const FX_ICONS = {
  film70: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 12h18"/></svg>',
  film80: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M3 15h18"/></svg>',
  film90: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
  vhs: '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="11" rx="2"/><path d="M6 12h4M14 12h4"/></svg>',
  glitch: '<svg viewBox="0 0 24 24"><path d="M4 6h9l-2 4h5l-7 8 2-6H6z"/></svg>',
  grain: '<svg viewBox="0 0 24 24"><circle cx="7" cy="7" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="17" cy="7" r="1"/><circle cx="7" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="17" cy="12" r="1"/><circle cx="7" cy="17" r="1"/><circle cx="12" cy="17" r="1"/><circle cx="17" cy="17" r="1"/></svg>',
  bw: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/></svg>',
  sepia: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/></svg>',
  warm: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  cool: '<svg viewBox="0 0 24 24"><path d="M12 2v20M4.9 6l14.2 12M4.9 18 19.1 6"/></svg>',
  invert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4v16"/></svg>',
  shake: '<svg viewBox="0 0 24 24"><path d="M4 12h2M9 6v12M14 8v8M19 10v4"/></svg>',
  zoom: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5M11 8v6M8 11h6"/></svg>',
  flash: '<svg viewBox="0 0 24 24"><path d="M13 2 5 14h6l-1 8 8-12h-6z"/></svg>',
  vignette: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="7" y="9" width="10" height="6" rx="1"/></svg>',
};

function renderFxGrid() {
  const grid = $('fx-grid');
  grid.innerHTML = '';
  for (const [id, def] of Object.entries(EFFECTS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fx-item';
    btn.dataset.id = id;
    btn.innerHTML = `${FX_ICONS[id] || '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>'}<span>${def.label}</span>`;
    btn.addEventListener('click', () => toggleEffect(id));
    grid.appendChild(btn);
  }
}

function toggleEffect(id) {
  const sel = getSelected();
  if (!sel) return toast('Selecione um clipe primeiro.');
  const i = sel.effects.findIndex((e) => e.id === id);
  if (i >= 0) sel.effects.splice(i, 1);
  else sel.effects.push({ id, intensity: defaultIntensity() });
  syncFxUI();
  notifyClips();
  refresh();
}

function setEffectIntensity(id, value) {
  const sel = getSelected();
  if (!sel) return;
  const e = sel.effects.find((x) => x.id === id);
  if (e) {
    e.intensity = parseFloat(value);
    refresh();
  }
}

function removeEffect(id) {
  const sel = getSelected();
  if (!sel) return;
  sel.effects = sel.effects.filter((e) => e.id !== id);
  syncFxUI();
  notifyClips();
  refresh();
}

function syncFxUI() {
  const sel = getSelected();
  document.querySelectorAll('.fx-item').forEach((btn) => {
    const active = !!sel?.effects.some((e) => e.id === btn.dataset.id);
    btn.classList.toggle('active', active);
  });

  const wrap = $('fx-active');
  wrap.innerHTML = '';
  if (!sel) return;

  for (const e of sel.effects) {
    const def = EFFECTS[e.id];
    if (!def) continue;
    const row = document.createElement('div');
    row.className = 'fx-slider-row';
    row.innerHTML = `
      <span class="fx-name">${def.label}</span>
      <input type="range" min="0.05" max="1" step="0.01" value="${e.intensity ?? 0.7}">
      <output>${Math.round((e.intensity ?? 0.7) * 100)}%</output>
      <button type="button" class="fx-off" title="Remover">✕</button>`;
    const range = row.querySelector('input');
    range.addEventListener('input', () => {
      row.querySelector('output').textContent = `${Math.round(range.value * 100)}%`;
      setEffectIntensity(e.id, range.value);
    });
    row.querySelector('.fx-off').addEventListener('click', () => removeEffect(e.id));
    wrap.appendChild(row);
  }
}

renderFxGrid();

/* ---------------- Painel: Áudio ---------------- */

$('clip-vol').addEventListener('input', () => {
  const sel = getSelected();
  if (!sel) return;
  sel.volume = parseFloat($('clip-vol').value);
  $('clip-vol-val').textContent = `${Math.round(sel.volume * 100)}%`;
  audio.applyVolumes();
});

$('btn-clip-mute').addEventListener('click', () => {
  const sel = getSelected();
  if (!sel) return;
  sel.muted = !sel.muted;
  $('btn-clip-mute').classList.toggle('active', sel.muted);
  $('btn-clip-mute').textContent = sel.muted ? 'Ativar som do clipe' : 'Silenciar clipe';
  audio.applyVolumes();
  notifyClips();
});

$('master-vol').addEventListener('input', () => {
  state.masterVolume = parseFloat($('master-vol').value);
  $('master-vol-val').textContent = `${Math.round(state.masterVolume * 100)}%`;
  audio.applyVolumes();
});

function syncMusicUI() {
  const m = state.music;
  $('music-info').textContent = m ? `♪ ${m.name}` : 'Sem música carregada.';
  $('music-controls').classList.toggle('hidden', !m);
  if (m) {
    $('music-vol').value = m.volume;
    $('music-vol-val').textContent = `${Math.round(m.volume * 100)}%`;
    $('music-off').value = m.offset;
    $('music-off-val').textContent = `${m.offset.toFixed(1)} s`;
    $('btn-music-mute').classList.toggle('active', m.muted);
    $('btn-music-mute').textContent = m.muted ? 'Ativar música' : 'Silenciar música';
  }
}

$('music-vol').addEventListener('input', () => {
  if (!state.music) return;
  state.music.volume = parseFloat($('music-vol').value);
  $('music-vol-val').textContent = `${Math.round(state.music.volume * 100)}%`;
  audio.applyVolumes();
});

$('music-off').addEventListener('input', () => {
  if (!state.music) return;
  state.music.offset = parseFloat($('music-off').value);
  $('music-off-val').textContent = `${state.music.offset.toFixed(1)} s`;
  audio.syncMusic(player.time, player.playing);
});

$('btn-music-mute').addEventListener('click', () => {
  if (!state.music) return;
  state.music.muted = !state.music.muted;
  syncMusicUI();
  audio.applyVolumes();
});

$('btn-music-remove').addEventListener('click', () => {
  audio.removeMusic();
  syncMusicUI();
  toast('Música removida.');
});

/* ---------------- Exportação ---------------- */

const modal = $('export-modal');
let exporting = false;
let lastExportUrl = null;

function openExportModal() {
  if (!state.clips.length) {
    toast('Importe vídeos antes de exportar.');
    return;
  }
  pause();
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  updateExportInfo();
  resetExportUI();
}

function closeExportModal() {
  if (exporting) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function updateExportInfo() {
  const { height, fps } = state.exportSettings;
  const d = totalDuration();
  $('export-info').textContent =
    `Duração: ${formatTime(d)} · ${height}p · ${fps} fps · formato WebM`;
}

function resetExportUI() {
  $('export-progress-wrap').classList.add('hidden');
  $('export-progress').style.width = '0%';
  $('btn-export-start').classList.remove('hidden');
  $('btn-export-start').disabled = false;
  $('btn-export-start').textContent = 'Começar exportação';
  $('btn-download').classList.add('hidden');
  $('btn-share').classList.add('hidden');
}

$('btn-export').addEventListener('click', openExportModal);
$('btn-export-close').addEventListener('click', closeExportModal);

document.querySelectorAll('.res-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.res-chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.exportSettings.height = parseInt(chip.dataset.h, 10);
    updateExportInfo();
  });
});

document.querySelectorAll('.fps-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.fps-chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.exportSettings.fps = parseInt(chip.dataset.fps, 10);
    updateExportInfo();
  });
});

$('btn-export-start').addEventListener('click', async () => {
  if (exporting) return;
  exporting = true;

  $('btn-export-start').classList.add('hidden');
  $('export-progress-wrap').classList.remove('hidden');
  $('export-overlay').classList.remove('hidden');
  $('export-status').textContent = 'A exportar… mantenha o ecrã ligado.';
  $('btn-export-close').disabled = true;

  const blob = await exportProject(state.exportSettings, {
    onProgress: (f, t, d) => {
      $('export-progress').style.width = `${(f * 100).toFixed(1)}%`;
      $('export-status').textContent = `A exportar ${formatTime(t)} / ${formatTime(d)}`;
    },
    onError: (msg) => toast(msg, 4000),
    onStart: (w, h, mime) => {
      $('export-status').textContent = `A gravar ${w}×${h} (${mime.split(';')[0]})…`;
    },
  });

  $('export-overlay').classList.add('hidden');
  exporting = false;
  $('btn-export-close').disabled = false;

  if (!blob) {
    resetExportUI();
    toast('Exportação cancelada ou falhou.');
    return;
  }

  const { url, name } = deliverBlob(blob);
  if (lastExportUrl) URL.revokeObjectURL(lastExportUrl);
  lastExportUrl = url;

  $('export-progress').style.width = '100%';
  $('export-status').textContent = `Vídeo pronto (${(blob.size / 1048576).toFixed(1)} MB).`;

  const dl = $('btn-download');
  dl.href = url;
  dl.download = name;
  dl.textContent = 'Baixar vídeo';
  dl.classList.remove('hidden');

  const share = $('btn-share');
  if (navigator.canShare && navigator.canShare({ files: [new File([blob], name, { type: blob.type })] })) {
    share.classList.remove('hidden');
    share.onclick = async () => {
      try {
        await navigator.share({ files: [new File([blob], name, { type: blob.type })], title: 'Gelo Edit VP' });
      } catch { /* ignorar */ }
    };
  }

  toast('Exportação concluída!');
});

/* ---------------- Reações a mudanças de estado ---------------- */

function onClipsChanged() {
  renderTimeline();
  const sel = getSelected();
  if (sel) fitCanvasToClip(preview, sel);
  else if (state.clips.length) fitCanvasToClip(preview, state.clips[0]);
  $('empty-state').classList.toggle('hidden', state.clips.length > 0);
  syncSelectionUI();
  syncSpeedUI();
  syncFxUI();
  syncAudioUI();
  seek(Math.min(player.time, totalDuration()));
  refresh();
}

function onClipSettingsChanged() {
  renderTimeline();
  refresh();
}

function syncSelectionUI() {
  const sel = getSelected();
  const has = !!sel;
  ['btn-split', 'btn-trim-in', 'btn-trim-out', 'btn-dup', 'btn-del', 'btn-move-left', 'btn-move-right'].forEach((id) => {
    $(id).disabled = !has;
  });
  $('clip-vol').disabled = !has;
  $('btn-clip-mute').disabled = !has;

  if (sel) {
    $('sel-name').textContent = sel.name;
    const loc = state.clips.findIndex((c) => c.id === sel.id);
    $('sel-meta').textContent =
      `Clique ${loc + 1} de ${state.clips.length} · ${formatTime(sel.out - sel.in)} de origem` +
      (sel.reverse ? ' · reverso' : ` · ${sel.speed}x`);
  } else {
    $('sel-name').textContent = 'Nenhum clipe selecionado';
    $('sel-meta').textContent = state.clips.length
      ? 'Toque num clipe da timeline para o editar.'
      : 'Importe um vídeo e toque num clipe da timeline.';
  }
}

function syncAudioUI() {
  const sel = getSelected();
  if (sel) {
    $('clip-vol').value = sel.volume;
    $('clip-vol-val').textContent = `${Math.round(sel.volume * 100)}%`;
    $('btn-clip-mute').classList.toggle('active', sel.muted);
    $('btn-clip-mute').textContent = sel.muted ? 'Ativar som do clipe' : 'Silenciar clipe';
  }
  $('master-vol').value = state.masterVolume;
  $('master-vol-val').textContent = `${Math.round(state.masterVolume * 100)}%`;
}

on('clips', onClipsChanged);
on('selection', () => {
  syncSelectionUI();
  syncSpeedUI();
  syncFxUI();
  syncAudioUI();
  const sel = getSelected();
  if (sel) fitCanvasToClip(preview, sel);
  renderTimeline();
  refresh();
});

// Ao mudar para um clipe ativo diferente, ajusta o canvas à sua proporção.
on('active-clip', (clip) => {
  if (clip) fitCanvasToClip(preview, clip);
});

/* ---------------- Inicialização ---------------- */

syncMusicUI();
syncAudioUI();
onClipsChanged();
refresh();
