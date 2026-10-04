# 🧊 Gelo Edit VP

Editor de vídeo **web** leve e profissional, pensado para **Android** — funciona
inteiramente no navegador, sem instalar programas e sem precisar de computador.

## ✨ Funcionalidades

| Área | O que faz |
| --- | --- |
| **Importação** | Vídeos da galeria do telemóvel ou gravação direta com a câmara. Vários ficheiros de uma vez. |
| **Pré-visualização** | Ecrã de pré-visualização em tempo real com todos os efeitos aplicados. Arraste para navegar. |
| **Timeline** | Clipes com miniaturas, régua de tempos, playhead. Toque para posicionar, arraste para reordenar, alças laterais para cortar. |
| **Editar** | Cortar início/fim, dividir no playhead, duplicar, apagar, reordenar (arrastar ou botões). |
| **Velocidade** | 0.25x a 4x, câmara lenta, reprodução inversa (reverso) e **speed ramp** (presets Suave/Acelerar/Desacelerar ou curva personalizada). |
| **Efeitos** | Filmes **70 / 80 / 90**, **VHS**, **Glitch**, **Grão**, P&B, Sépia, Quente, Frio, Inverter, **Shake**, **Zoom**, **Flash**, **Vinheta** — combináveis, cada um com intensidade ajustável. |
| **Áudio** | Volume por clipe, silenciar clipe, volume geral, **música de fundo** com volume e **sincronização** (desfasamento ±10 s). |
| **Exportação** | Exporta o vídeo final (WebM) em 480p / 720p / 1080p a 24/30 fps, com efeitos e áudio já aplicados. Download ou partilha nativa do Android. |

## 📱 Como usar no telemóvel

1. Abra o site no **Chrome** (ou qualquer navegador moderno) do Android.
2. Toque em **Importar vídeo** e escolha os ficheiros da galeria (ou grave com a câmara).
3. Monte o vídeo na timeline: arraste as alças para cortar, toque em **Dividir aqui**,
   mantenha premido num clipe para o reordenar.
4. Use os painéis em baixo (**Editar · Velocidade · Efeitos · Áudio**) para aplicar alterações.
5. Toque em **Exportar**, escolha a resolução e comece a exportação.
   No fim, **Baixar vídeo** ou **Partilhar**.

> 💡 Durante a exportação mantenha o ecrã ligado — o vídeo é gravado em tempo real.

## 🖥️ Como executar / hospedar

É uma aplicação estática (HTML + CSS + JS puro, sem dependências nem build).

```bash
# servidor local de testes (qualquer um serve)
python3 -m http.server 8080
# ou
npx serve .
```

Para uso permanente no telemóvel, publique numa hospedagem estática
(GitHub Pages, Netlify, Vercel, Cloudflare Pages…). Depois pode "Adicionar ao
ecrã de início" para usar como app.

## 🗂️ Estrutura do código

```
index.html          Interface (pré-visualização, transporte, timeline, painéis)
css/style.css       Tema visual (escuro, acento "gelo", otimizado para toque)
js/state.js         Estado do projeto, modelo de clipes, mapa velocidade↔tempo
js/player.js        Motor de reprodução (sequenciador, reverso, speed ramp)
js/effects.js       Registo de efeitos + render de frames no canvas
js/timeline.js      Interface da timeline (cortar, reordenar, playhead)
js/importer.js      Importação de vídeos e música do dispositivo
js/audio.js         Grafo de áudio (volumes, música, mistura p/ exportação)
js/exporter.js      Exportação via MediaRecorder (canvas + áudio → WebM)
js/app.js           Ligue a interface aos módulos (ponto de entrada)
icons/favicon.svg   Ícone da app
manifest.webmanifest  Manifesto PWA (instalável no Android)
test/               Testes (ver abaixo)
```

## 🧪 Testes

```bash
# lógica do motor (sem dependências)
node test/state.test.mjs

# arranque da interface num DOM simulado (requer: npm install jsdom)
node test/dom.smoke.mjs
```

## 🧩 Como adicionar novos recursos

**Novo efeito visual** — em `js/effects.js`:

```js
export const EFFECTS = {
  // ...
  neon: {
    label: 'Neon',
    cat: 'cor',
    style: (k) => `saturate(${1 + k}) hue-rotate(${20 * k}deg)`, // efeito de cor
  },
};
```

Se for um efeito de sobreposição (como o VHS), acrescente uma função em
`OVERLAYS`/`drawFrame` e ela será aplicada automaticamente na pré-visualização
**e** na exportação. O painel de efeitos mostra-o sozinho.

**Novo controlo de clipe** — adicione o campo em `createClip()` (`js/state.js`),
o controlo em `index.html` e o respetivo ouvinte em `js/app.js`.

## ⚙️ Notas técnicas / limitações

- **Formato de exportação:** WebM (VP8/VP9 + Opus) — reproduz no Android,
  YouTube, redes sociais e na maioria dos editores. Em Safari/iOS a gravação
  pode ser limitada pelo navegador.
- **Reverso e speed ramp** são calculados quadro a quadro; em vídeos muito
  longos ou muito rápidos a reprodução inversa pode não ser perfeitamente suave.
- O áudio é silenciado em clipes em modo reverso (o vídeo invertido não tem áudio útil).
- A exportação é feita em tempo real (como uma gravação do ecrã) — um vídeo de
  1 minuto demora ~1 minuto a exportar.

## 📄 Licença

Projeto pessoal — utilize e adapte livremente.
