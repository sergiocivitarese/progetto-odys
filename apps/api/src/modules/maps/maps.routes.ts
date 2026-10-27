import { Router } from 'express';
import { handle, HttpError } from '../../shared/http';

/**
 * Proxy della mappa statica MapTiler: il browser chiede un'immagine al backend
 * e la chiave resta sul server.
 */
export function mapsRouter(maptilerKey: string): Router {
  const router = Router();

  router.get('/static', handle(async (req, res) => {
    if (!maptilerKey) throw new HttpError(404, 'Cartografia non configurata.');
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const zoom = Math.min(16, Math.max(3, Number(req.query.zoom ?? 12) || 12));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, 'Coordinate non valide.');
    const response = await fetch(`https://api.maptiler.com/maps/streets-v2/static/${lon},${lat},${zoom}/700x380.png?key=${encodeURIComponent(maptilerKey)}`);
    if (!response.ok) throw new HttpError(502, 'Mappa non disponibile in questo momento.');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.type('image/png').send(Buffer.from(await response.arrayBuffer()));
  }));

  return router;
}
