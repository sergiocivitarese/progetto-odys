/*
 * Preparazione dei media nel browser prima del caricamento (M-02, M-03, M-07):
 *   - foto: versione "display" (lato lungo 1440 px, WebP) e miniatura quadrata 480 px;
 *   - video: nessuna transcodifica (non disponibile), miniatura dal primo secondo.
 * L'originale viene conservato così com'è.
 */

export const MAX_MEDIA_PER_POST = 10;
const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const VIDEO_MAX_MS = 60_000;
const DISPLAY_SIDE = 1440;
const THUMB_SIDE = 480;

export interface PreparedMedia {
  file: File;
  kind: 'image' | 'video';
  mimeType: string;
  extension: string;
  width?: number;
  height?: number;
  durationMs?: number;
  display?: Blob;
  thumbnail: Blob;
}

function extensionOf(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
  return file.type.split('/')[1] ?? 'bin';
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Conversione non riuscita.')), 'image/webp', quality));
}

/** Disegna la sorgente: intera (scalata) oppure ritagliata al centro in un quadrato (copertina, C-24/C-25). */
function draw(source: CanvasImageSource, width: number, height: number, mode: 'fit' | 'square', side: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  if (mode === 'fit') {
    const scale = Math.min(1, side / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  } else {
    const crop = Math.min(width, height);
    canvas.width = canvas.height = Math.min(side, crop);
    canvas.getContext('2d')!.drawImage(source, (width - crop) / 2, (height - crop) / 2, crop, crop, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

async function prepareImage(file: File): Promise<PreparedMedia> {
  if (file.size > IMAGE_MAX_BYTES) throw new Error(`"${file.name}" supera i 15 MB.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`"${file.name}" non è leggibile da questo browser: prova a convertirla in JPG.`);
  }
  const { width, height } = bitmap;
  const display = await toBlob(draw(bitmap, width, height, 'fit', DISPLAY_SIDE), 0.86);
  const thumbnail = await toBlob(draw(bitmap, width, height, 'square', THUMB_SIDE), 0.8);
  bitmap.close();
  return { file, kind: 'image', mimeType: file.type || 'image/jpeg', extension: extensionOf(file), width, height, display, thumbnail };
}

async function prepareVideo(file: File): Promise<PreparedMedia> {
  if (file.size > VIDEO_MAX_BYTES) throw new Error(`"${file.name}" supera i 100 MB.`);
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error(`"${file.name}" non è un video leggibile.`)); });
    const durationMs = Math.round(video.duration * 1000);
    if (durationMs > VIDEO_MAX_MS) throw new Error(`"${file.name}" dura più di 60 secondi.`);
    video.currentTime = Math.min(1, video.duration / 2);
    await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
    const thumbnail = await toBlob(draw(video, video.videoWidth, video.videoHeight, 'square', THUMB_SIDE), 0.8);
    return { file, kind: 'video', mimeType: file.type || 'video/mp4', extension: extensionOf(file), width: video.videoWidth, height: video.videoHeight, durationMs, thumbnail };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function prepareMedia(file: File): Promise<PreparedMedia> {
  if (file.type.startsWith('image/')) return prepareImage(file);
  if (file.type.startsWith('video/')) return prepareVideo(file);
  return Promise.reject(new Error(`"${file.name}": formato non supportato.`));
}
