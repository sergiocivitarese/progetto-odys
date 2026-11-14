import { SOCIAL_FORMATS, wrapWords, type SocialFormat, type SocialKitContent } from '@odys/domain';

/** Colori Orbit Route (docs/riferimenti/odys-specifiche-per-ruolo.pdf, pagina 13). */
const BLUE = '#3355FF';
const LIME = '#D9F54A';
const CORAL = '#FF6B57';
const INK = '#121212';
const CREAM = '#F8F6F2';
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Carica la copertina in modo che il canvas resti esportabile; null se il server non lo consente. */
export function loadCover(url: string | undefined): Promise<HTMLImageElement | null> {
  if (!url || !/^https:\/\//.test(url)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** Aspetta Inter nei pesi usati, così la prima grafica non esce con il carattere di sistema. */
export async function loadKitFonts(): Promise<void> {
  try {
    await Promise.all(['900 100px Inter', '800 40px Inter', '700 40px Inter', '600 40px Inter'].map((font) => document.fonts.load(font)));
  } catch {
    // Senza Font Loading API si usa il carattere di riserva.
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Puntatore ad anello: anello aperto e punto corallo. */
function drawRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, stroke: string, width: number, dot = true): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI * 0.28, Math.PI * 1.62);
  ctx.stroke();
  if (!dot) { ctx.restore(); return; }
  ctx.fillStyle = CORAL;
  ctx.beginPath();
  ctx.arc(cx + radius * Math.cos(-Math.PI * 0.4), cy + radius * Math.sin(-Math.PI * 0.4), width * 0.95, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Copertina ritagliata come `object-fit: cover`. */
function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, w: number, h: number): void {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Dimensione massima del carattere perché il testo stia in una riga. */
function fitSize(ctx: CanvasRenderingContext2D, text: string, weight: number, max: number, min: number, width: number): number {
  for (let size = max; size > min; size -= 4) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= width) return size;
  }
  return min;
}

function pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, background: string, color: string): number {
  ctx.font = `800 ${size}px ${FONT}`;
  const padX = size * 0.75;
  const height = size * 2;
  const width = ctx.measureText(text).width + padX * 2;
  ctx.fillStyle = background;
  roundRect(ctx, x, y, width, height, height / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + height / 2 + size * 0.04);
  ctx.textBaseline = 'alphabetic';
  return width;
}

/** Disegna la grafica del formato richiesto e restituisce il canvas. */
export function renderSocialKit(format: SocialFormat, content: SocialKitContent, cover: HTMLImageElement | null): HTMLCanvasElement {
  const { width: W, height: H } = SOCIAL_FORMATS[format];
  const story = format === 'story';
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const M = 72; // margine

  // Fondo: copertina scurita, oppure blu Odys con l'anello grande.
  if (cover) {
    drawCover(ctx, cover, W, H);
    const shade = ctx.createLinearGradient(0, 0, 0, H);
    shade.addColorStop(0, 'rgba(18,18,18,0.55)');
    shade.addColorStop(0.35, 'rgba(18,18,18,0.10)');
    shade.addColorStop(0.62, 'rgba(18,18,18,0.55)');
    shade.addColorStop(1, 'rgba(18,18,18,0.92)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = BLUE;
    ctx.fillRect(0, 0, W, H);
    // Anello decorativo senza punto: il punto corallo resta quello del marchio.
    drawRing(ctx, W * 0.78, H * (story ? 0.34 : 0.28), W * 0.42, 'rgba(255,255,255,0.14)', W * 0.06, false);
  }

  // Marchio in alto.
  drawRing(ctx, M + 26, M + 30, 22, LIME, 9);
  ctx.fillStyle = '#fff';
  ctx.font = `900 46px ${FONT}`;
  ctx.fillText('ODYS', M + 64, M + 47);
  if (content.kicker) {
    ctx.font = `800 28px ${FONT}`;
    const kickerWidth = ctx.measureText(content.kicker).width + 42;
    pill(ctx, content.kicker, W - M - kickerWidth, M + 4, 28, LIME, INK);
  }

  // Blocco testi, ancorato in basso: si calcola dal fondo verso l'alto.
  const cardH = story ? 360 : 300;
  const cardY = H - M - cardH;
  const textWidth = W - M * 2;

  // Scheda in basso: prezzo, posti, coordinatore, link.
  ctx.fillStyle = CREAM;
  roundRect(ctx, M, cardY, textWidth, cardH, 40);
  ctx.fill();
  const pad = 48;
  let y = cardY + pad + (story ? 64 : 56);
  ctx.fillStyle = INK;
  ctx.font = `900 ${story ? 72 : 64}px ${FONT}`;
  ctx.fillText(content.price || 'Quota in arrivo', M + pad, y);
  if (content.seats) {
    const urgent = /Ultim|esaurito/.test(content.seats);
    ctx.font = `800 28px ${FONT}`;
    const seatsWidth = ctx.measureText(content.seats).width + 42;
    pill(ctx, content.seats, W - M - pad - seatsWidth, y - 50, 28, urgent ? CORAL : INK, urgent ? INK : '#fff');
  }
  y += story ? 64 : 54;
  ctx.fillStyle = '#4a4a4a';
  ctx.font = `600 ${story ? 36 : 32}px ${FONT}`;
  ctx.fillText([content.dates, content.coordinator].filter(Boolean).join('  ·  '), M + pad, y, textWidth - pad * 2);
  // Link per la bio in una pillola nera a tutta larghezza.
  const linkH = story ? 92 : 84;
  const linkY = cardY + cardH - pad - linkH + 8;
  ctx.fillStyle = INK;
  roundRect(ctx, M + pad - 8, linkY, textWidth - pad * 2 + 16, linkH, linkH / 2);
  ctx.fill();
  ctx.fillStyle = LIME;
  ctx.font = `800 ${story ? 34 : 30}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('Prenota il tuo posto →', M + pad + 24, linkY + linkH / 2 + 1);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `600 ${story ? 26 : 24}px ${FONT}`;
  ctx.textAlign = 'right';
  // Sulla grafica basta il dominio («link in bio»); l'indirizzo completo è nel testo per la bio.
  ctx.fillText(content.link.split('/')[0], M + textWidth - pad - 16, linkY + linkH / 2 + 1, textWidth * 0.42);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Interessi sopra la scheda.
  let tagsY = cardY - (story ? 48 : 36) - 56;
  if (content.tags.length) {
    let x = M;
    for (const tag of content.tags) x += pill(ctx, tag, x, tagsY, 28, 'rgba(255,255,255,0.18)', '#fff') + 14;
  } else {
    tagsY = cardY - 20;
  }

  // Titolo (al massimo 2 righe) e meta in grande, verso l'alto.
  ctx.font = `700 ${story ? 50 : 44}px ${FONT}`;
  const titleSize = story ? 50 : 44;
  const titleLines = wrapWords(content.title, textWidth, (text) => ctx.measureText(text).width, 2);
  let titleY = tagsY - (story ? 40 : 28) - (titleLines.length - 1) * titleSize * 1.2;
  ctx.fillStyle = '#fff';
  for (const line of titleLines) {
    ctx.fillText(line, M, titleY);
    titleY += titleSize * 1.2;
  }
  const destSize = fitSize(ctx, content.destination, 900, story ? 230 : 190, 72, textWidth);
  ctx.font = `900 ${destSize}px ${FONT}`;
  ctx.fillStyle = cover ? '#fff' : LIME;
  const destY = tagsY - (story ? 40 : 28) - (titleLines.length - 1) * titleSize * 1.2 - titleSize * 1.15 - 8;
  // Spaziatura stretta sulle mete, come nei mockup.
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${-Math.round(destSize * 0.03)}px`;
  ctx.fillText(content.destination, M - destSize * 0.04, destY, textWidth + destSize * 0.04);
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Immagine non generata.'))), 'image/png'));
}
