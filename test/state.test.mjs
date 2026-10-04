/**
 * Teste de fumo da lógica central (state.js) — executa em Node sem browser.
 * Uso: node test/state.test.mjs
 */
import {
  state, createClip, addClip, removeClip, duplicateClip, moveClip, splitClip,
  getMap, srcTimeFor, findClipAt, totalDuration, clipStart, select, getSelected,
} from '../js/state.js';

let pass = 0;
let fail = 0;

function ok(cond, msg) {
  if (cond) { pass++; console.log(`  ✔ ${msg}`); }
  else { fail++; console.error(`  ✘ ${msg}`); }
}

function close(a, b, eps, msg) {
  ok(Math.abs(a - b) < eps, `${msg} (≈ ${a.toFixed(3)} vs ${b.toFixed(3)})`);
}

function fakeVideo() {
  return { pause() {}, play() { return Promise.resolve(); }, currentTime: 0, paused: true, readyState: 4 };
}

function mkClip(duration = 10) {
  return createClip({
    file: {}, url: 'blob:x', video: fakeVideo(), name: 'teste',
    width: 1280, height: 720, duration,
  });
}

console.log('\n— Mapa de tempos: velocidade constante —');
{
  const c = mkClip(10);
  c.in = 2; c.out = 8; c.speed = 2;
  const map = getMap(c);
  close(map.total, 3, 0.01, 'duração projeto = (out-in)/speed = 3s');
  close(map.srcAt(0), 2, 0.01, 'src no início = in');
  close(map.srcAt(3), 8, 0.01, 'src no fim = out');
  close(map.srcAt(1.5), 5, 0.02, 'src ao meio');
  close(map.speedAt(1), 2, 0.01, 'speedAt = 2');
}

console.log('\n— Speed ramp —');
{
  const c = mkClip(10);
  c.in = 0; c.out = 10; c.ramp = [
    { t: 0, speed: 1 }, { t: 1, speed: 3 },
  ];
  const map = getMap(c);
  // s(u)=1+2u → duração = ∫0..10 dv/s(v/10) = 5·ln(3) ≈ 5.493s
  close(map.total, 5 * Math.log(3), 0.05, 'ramp 1→3: duração = 5·ln(3) ≈ 5.49s');
  ok(map.speedAt(0) < 1.15, 'velocidade no início ≈ 1');
  ok(map.speedAt(map.total - 0.01) > 2.8, 'velocidade no fim ≈ 3');
  // srcAt deve ser monótono
  let mono = true;
  let prev = -1;
  for (let t = 0; t <= map.total; t += map.total / 20) {
    const s = map.srcAt(t);
    if (s < prev - 1e-6) mono = false;
    prev = s;
  }
  ok(mono, 'srcAt monótono');
  close(map.srcAt(map.total), 10, 0.05, 'srcAt(fim) = out');
}

console.log('\n— Reverso —');
{
  const c = mkClip(10);
  c.in = 0; c.out = 10; c.reverse = true; c.speed = 1;
  close(srcTimeFor(c, 0), 10, 0.01, 'inverso: início do projeto = fim do vídeo');
  close(srcTimeFor(c, 10), 0, 0.01, 'inverso: fim do projeto = início do vídeo');
  close(srcTimeFor(c, 5), 5, 0.01, 'inverso: meio = meio');
}

console.log('\n— Sequência de clipes: findClipAt / clipStart / totalDuration —');
{
  state.clips.length = 0;
  state.selectionId = null;
  const a = mkClip(10); a.in = 0; a.out = 4; a.speed = 1;   // 4s
  const b = mkClip(10); b.in = 0; b.out = 8; b.speed = 2;   // 4s
  const c = mkClip(10); c.in = 1; c.out = 5; c.speed = 0.5; // 8s
  addClip(a); addClip(b); addClip(c);
  close(totalDuration(), 16, 0.01, 'duração total = 16s');
  close(clipStart(1), 4, 0.01, 'clip 2 começa aos 4s');
  close(clipStart(2), 8, 0.01, 'clip 3 começa aos 8s');

  let loc = findClipAt(2);
  ok(loc.clip === a && Math.abs(loc.localT - 2) < 0.01, 't=2 → clipe A, local 2s');
  loc = findClipAt(5.5);
  ok(loc.clip === b && Math.abs(loc.localT - 1.5) < 0.01, 't=5.5 → clipe B, local 1.5s');
  loc = findClipAt(12);
  ok(loc.clip === c && Math.abs(loc.localT - 4) < 0.01, 't=12 → clipe C, local 4s');

  console.log('\n— Split —');
  const right = splitClip(b.id, 2);
  ok(!!right, 'split criou o clipe da direita');
  ok(state.clips.length === 4, 'agora há 4 clipes');
  // b: in=0, out=8, speed=2 → 4s de projeto. Split a localT=2 → meio → src=4s.
  close(b.out - b.in, 4, 0.05, 'clipe da esquerda: 4s de origem (2s de projeto)');
  close(right.out - right.in, 4, 0.05, 'clipe da direita: 4s de origem (2s de projeto)');
  close(getMap(b).total, 2, 0.05, 'clipe da esquerda: 2s na timeline');
  close(totalDuration(), 16, 0.01, 'duração total mantém-se 16s');

  console.log('\n— Reordenar / duplicar / apagar —');
  moveClip(c.id, 0);
  ok(state.clips[0] === c, 'moveClip colocou C primeiro');
  const dup = duplicateClip(c.id);
  ok(state.clips.length === 5 && state.clips[1] === dup, 'duplicar inseriu cópia a seguir');
  close(dup.out - dup.in, c.out - c.in, 0.001, 'cópia tem os mesmos pontos in/out');
  removeClip(dup.id);
  ok(state.clips.length === 4, 'apagar removeu a cópia');

  console.log('\n— Seleção —');
  select(a.id);
  ok(getSelected() === a, 'selecionar devolve o clipe certo');
}

console.log(`\nResultado: ${pass} passaram, ${fail} falharam.`);
process.exit(fail ? 1 : 0);
