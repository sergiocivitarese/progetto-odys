/*
 * Proiezione Web Mercator su tile OpenStreetMap (gratuite, con attribuzione),
 * in un riquadro di dimensioni fisse: i punti cadono nel posto giusto della cartina.
 */

export interface MercatorTile {
  key: string;
  href: string;
  x: number;
  y: number;
}

export interface MercatorView {
  zoom: number;
  tileSize: number;
  tiles: MercatorTile[];
  project(longitude: number, latitude: number): { x: number; y: number };
}

export interface MercatorOptions {
  width: number;
  height: number;
  padding: number;
  /** Lato di una tile nel riquadro (metà della risoluzione reale: resta nitida ingrandendo). */
  tileSize?: number;
  minZoom?: number;
  maxZoom?: number;
}

export const OSM_ATTRIBUTION_URL = 'https://www.openstreetmap.org/copyright';

function world(longitude: number, latitude: number, zoom: number, tileSize: number) {
  const size = tileSize * 2 ** zoom;
  const sin = Math.sin((Math.max(-85, Math.min(85, latitude)) * Math.PI) / 180);
  return { x: ((longitude + 180) / 360) * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
}

/** Lo zoom più alto che fa stare tutti i punti nel riquadro, le tile che lo coprono e la proiezione. */
export function fitMercator(points: Array<[number, number]>, options: MercatorOptions): MercatorView {
  const { width, height, padding } = options;
  const tileSize = options.tileSize ?? 128;
  const minZoom = options.minZoom ?? 2;
  const maxZoom = options.maxZoom ?? 15;
  let zoom = maxZoom;
  if (points.length > 1) {
    for (; zoom > minZoom; zoom--) {
      const projected = points.map(([lon, lat]) => world(lon, lat, zoom, tileSize));
      const spanX = Math.max(...projected.map((p) => p.x)) - Math.min(...projected.map((p) => p.x));
      const spanY = Math.max(...projected.map((p) => p.y)) - Math.min(...projected.map((p) => p.y));
      if (spanX <= width - 2 * padding && spanY <= height - 2 * padding) break;
    }
  }
  const projected = points.map(([lon, lat]) => world(lon, lat, zoom, tileSize));
  const centerX = projected.length ? (Math.min(...projected.map((p) => p.x)) + Math.max(...projected.map((p) => p.x))) / 2 : 0;
  const centerY = projected.length ? (Math.min(...projected.map((p) => p.y)) + Math.max(...projected.map((p) => p.y))) / 2 : 0;
  const offsetX = width / 2 - centerX;
  const offsetY = height / 2 - centerY;
  const count = 2 ** zoom;
  const tiles: MercatorTile[] = [];
  for (let ty = Math.floor((centerY - height / 2) / tileSize); ty <= Math.floor((centerY + height / 2) / tileSize); ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor((centerX - width / 2) / tileSize); tx <= Math.floor((centerX + width / 2) / tileSize); tx++) {
      const wrapped = ((tx % count) + count) % count;
      tiles.push({ key: `${zoom}/${tx}/${ty}`, href: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${ty}.png`, x: tx * tileSize + offsetX, y: ty * tileSize + offsetY });
    }
  }
  return {
    zoom,
    tileSize,
    tiles,
    project: (longitude, latitude) => {
      const p = world(longitude, latitude, zoom, tileSize);
      return { x: p.x + offsetX, y: p.y + offsetY };
    },
  };
}
