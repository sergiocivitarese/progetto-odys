import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  deriveDayMapSnapshot,
  deriveMapSnapshot,
  filterMapSnapshot,
  MAP_LOCAL_ATTRIBUTION,
  type Itinerary,
  type LocationNode,
  type MapViewMode,
} from '@odys/domain';
import { ServicesApi } from '../../../core/api/services.api';
import { ConfigStore } from '../../../core/state/config.store';
import { ButtonComponent, IconComponent } from '../../../shared/ui';

const VIEW_W = 320;
const VIEW_H = 180;
const PADDING = 24;
/** Lato di una tile nel riquadro: metà della risoluzione reale, così resta nitida quando la mappa si allarga. */
const TILE = 128;
const MIN_ZOOM = 2;
const MAX_ZOOM = 15;

const VIEW_MODES: Array<{ mode: MapViewMode; label: string }> = [
  { mode: 'day', label: 'Oggi' },
  { mode: 'trip', label: 'Tutto il viaggio' },
  { mode: 'arrival-return', label: 'Arrivo/rientro' },
  { mode: 'activities', label: 'Attività' },
];

/**
 * Mappa di nodi e tratte (ex RouteMapPreview). Disegna solo posizioni con
 * coordinate reali, sopra la cartografia OpenStreetMap.
 */
@Component({
  selector: 'odys-map-preview',
  imports: [FormsModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './map-preview.component.html',
  styleUrl: './map-preview.component.scss',
})
export class MapPreviewComponent {
  private readonly services = inject(ServicesApi);
  protected readonly config = inject(ConfigStore);

  readonly itinerary = input.required<Itinerary>();
  readonly selectedDay = input<number>();
  readonly selectedNodeId = input<string>();
  readonly selectedSegmentId = input<string>();
  readonly selectDay = output<number>();
  readonly selectNode = output<string>();
  readonly selectSegment = output<string>();
  readonly addResult = output<LocationNode>();

  protected readonly modes = VIEW_MODES;
  protected readonly viewMode = signal<MapViewMode>('day');
  /** Tile non raggiungibili (offline): restano nodi e tratte senza sfondo. */
  protected readonly tilesFailed = signal(false);
  protected readonly query = signal('');
  protected readonly results = signal<LocationNode[]>([]);
  protected readonly searchMessage = signal('');
  protected readonly searching = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    void this.config.ensureLoaded();
    inject(DestroyRef).onDestroy(() => clearTimeout(this.searchTimer));
  }

  protected readonly visible = computed(() => {
    const itinerary = this.itinerary();
    const mode = this.viewMode();
    const day = this.selectedDay() ?? itinerary.days[0]?.day;
    if (mode === 'day' && day) return deriveDayMapSnapshot(itinerary, day, itinerary.mapSnapshot);
    return filterMapSnapshot(deriveMapSnapshot(itinerary, itinerary.mapSnapshot), mode, day);
  });

  /**
   * Proiezione Web Mercator nel riquadro 320×180 con lo sfondo di tile OpenStreetMap
   * (gratuite, con attribuzione): nodi e tratte cadono nel punto giusto della mappa.
   */
  protected readonly drawing = computed(() => {
    const { markers, routeLinks } = this.visible();
    const world = (longitude: number, latitude: number, zoom: number) => {
      const size = TILE * 2 ** zoom;
      const sin = Math.sin((Math.max(-85, Math.min(85, latitude)) * Math.PI) / 180);
      return { x: ((longitude + 180) / 360) * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
    };
    // Lo zoom più alto che fa stare tutti i punti nel riquadro, con un margine.
    let zoom = MAX_ZOOM;
    if (markers.length > 1) {
      for (; zoom > MIN_ZOOM; zoom--) {
        const points = markers.map((marker) => world(marker.longitude, marker.latitude, zoom));
        const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
        const height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
        if (width <= VIEW_W - 2 * PADDING && height <= VIEW_H - 2 * PADDING) break;
      }
    }
    const projected = markers.map((marker) => world(marker.longitude, marker.latitude, zoom));
    const centerX = (Math.min(...projected.map((p) => p.x)) + Math.max(...projected.map((p) => p.x))) / 2;
    const centerY = (Math.min(...projected.map((p) => p.y)) + Math.max(...projected.map((p) => p.y))) / 2;
    const offsetX = VIEW_W / 2 - centerX;
    const offsetY = VIEW_H / 2 - centerY;
    const point = (longitude: number, latitude: number) => {
      const p = world(longitude, latitude, zoom);
      return { x: p.x + offsetX, y: p.y + offsetY };
    };
    const count = 2 ** zoom;
    const tiles: Array<{ key: string; href: string; x: number; y: number }> = [];
    for (let ty = Math.floor((centerY - VIEW_H / 2) / TILE); ty <= Math.floor((centerY + VIEW_H / 2) / TILE); ty++) {
      if (ty < 0 || ty >= count) continue;
      for (let tx = Math.floor((centerX - VIEW_W / 2) / TILE); tx <= Math.floor((centerX + VIEW_W / 2) / TILE); tx++) {
        const wrapped = ((tx % count) + count) % count;
        tiles.push({ key: `${zoom}/${tx}/${ty}`, href: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${ty}.png`, x: tx * TILE + offsetX, y: ty * TILE + offsetY });
      }
    }
    const byId = new Map(markers.map((marker) => [marker.nodeId, marker]));
    return {
      tiles: this.tilesFailed() ? [] : tiles,
      markers: markers.map((marker) => ({ ...marker, ...point(marker.longitude, marker.latitude) })),
      lines: routeLinks.flatMap((link) => {
        const from = byId.get(link.fromNodeId), to = byId.get(link.toNodeId);
        if (!from || !to) return [];
        const a = point(from.longitude, from.latitude), b = point(to.longitude, to.latitude);
        return [{ id: link.id, segmentId: link.segmentId, x1: a.x, y1: a.y, x2: b.x, y2: b.y }];
      }),
    };
  });

  protected readonly attribution = computed(() => this.drawing().tiles.length ? 'Mappa © OpenStreetMap contributors' : MAP_LOCAL_ATTRIBUTION);
  protected readonly confirmedDestination = computed(() => this.itinerary().destinationNode?.geoStatus === 'CONFIRMED');
  protected readonly selectedLabel = computed(() => this.visible().markers.find((marker) => marker.nodeId === this.selectedNodeId())?.label);

  protected onQuery(value: string): void {
    this.query.set(value);
    clearTimeout(this.searchTimer);
    if (!value.trim()) {
      this.results.set([]);
      this.searchMessage.set('');
      return;
    }
    this.searchTimer = setTimeout(() => void this.search(value), 450);
  }

  private async search(value: string): Promise<void> {
    this.searching.set(true);
    try {
      const result = await this.services.searchPlace(value);
      this.results.set(result.candidates);
      this.searchMessage.set(result.message ?? (result.candidates.length ? 'Risultati online: verifica il luogo prima di salvarlo.' : 'Nessun risultato. Puoi inserire un punto manuale.'));
    } catch {
      this.searchMessage.set('Ricerca non disponibile in questo momento.');
    } finally {
      this.searching.set(false);
    }
  }

  protected add(node: LocationNode): void {
    this.addResult.emit(node);
    this.results.set([]);
    this.query.set('');
    this.searchMessage.set('');
  }
}
