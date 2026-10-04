/**
 * Smoke test da interface (opcional) — arranca o app.js num DOM simulado.
 * Requer jsdom:  npm install jsdom   (fora do projeto, ou devDependency)
 * Uso:  node test/dom.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const dom = new JSDOM(html, {
  url: 'https://gelo.test/',
  pretendToBeVisual: true,
});

const { window } = dom;

/* ---- Stubs mínimos para canvas / rAF / storage ---- */
const fakeCtx = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop() {} });
      }
      if (prop === 'createPattern') return () => null;
      if (prop === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (prop === 'measureText') return () => ({ width: 0 });
      return () => undefined;
    },
    set: () => true,
  },
);
window.HTMLCanvasElement.prototype.getContext = () => fakeCtx;
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
window.URL.createObjectURL = () => 'blob:fake';
window.URL.revokeObjectURL = () => {};
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
}

/* ---- Instala as variáveis globais usadas pelos módulos ---- */
const globals = {
  window, document: window.document, navigator: window.navigator,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  performance: globalThis.performance,
  URL: window.URL, Blob: window.Blob, File: window.File ?? class {},
  HTMLElement: window.HTMLElement, Audio: window.Audio,
  Event: window.Event, MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent ?? window.MouseEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
};
for (const [k, v] of Object.entries(globals)) {
  try { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); }
  catch { /* já existe */ }
}

/* ---- Verificação estática: todos os ids usados em JS existem no HTML ---- */
const idsInHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
let missing = 0;
for (const file of fs.readdirSync(path.join(root, 'js'))) {
  const src = fs.readFileSync(path.join(root, 'js', file), 'utf8');
  for (const m of src.matchAll(/\$\('([^']+)'\)/g)) {
    if (!idsInHtml.has(m[1])) {
      console.error(`  ✘ id inexistente no HTML: #${m[1]} (usado em js/${file})`);
      missing++;
    }
  }
}
if (missing === 0) console.log('  ✔ todos os ids referenciados no JS existem no HTML');
else process.exitCode = 1;

/* ---- Arranque real do app.js ---- */
try {
  await import(pathToFileURL(path.join(root, 'js', 'app.js')).href);
  console.log('  ✔ app.js arrancou sem exceções');

  const doc = window.document;
  if (!doc.querySelector('.fx-item')) throw new Error('grelha de efeitos não foi criada');
  console.log(`  ✔ painel de efeitos criado (${doc.querySelectorAll('.fx-item').length} efeitos)`);

  // Tabs
  doc.querySelector('.dock-tab[data-panel="speed"]').click();
  if (!doc.getElementById('panel-speed').classList.contains('active')) {
    throw new Error('tab Velocidade não ativou o painel');
  }
  console.log('  ✔ navegação por tabs funciona');

  // Exportar sem clipes → toast
  doc.getElementById('btn-export').click();
  const toast = doc.getElementById('toast');
  if (!/Importe/i.test(toast.textContent)) throw new Error(`toast inesperado: "${toast.textContent}"`);
  console.log(`  ✔ exportação sem clipes mostra aviso ("${toast.textContent}")`);

  // Botões de edição desativados sem seleção
  if (!doc.getElementById('btn-split').disabled) throw new Error('btn-split devia estar desativado');
  console.log('  ✔ controlos de edição desativados sem clipe selecionado');

  console.log('\nSmoke test da interface: OK');
} catch (err) {
  console.error('  ✘ falha no arranque:', err);
  process.exitCode = 1;
}
