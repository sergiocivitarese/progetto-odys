import { parseTripExport, serializeTripExport, type Itinerary } from '@odys/domain';
import { HttpError } from '../../shared/http';
import type { AccountRepository, StoredTrip, TripChangeKind, TripsRepository, TripVersion, TripVersionSummary } from '../../shared/data';

const CHANGE_LABELS: Record<TripChangeKind, string> = {
  created: 'Viaggio creato',
  edited: 'Itinerario modificato',
  dates: 'Date e arrivo aggiornati',
  budget: 'Budget confermato',
  lodging: 'Alloggio o punto di partenza aggiornato',
  geography: 'Posizione confermata',
  progress: 'Avanzamento del viaggio',
  route: 'Percorso calcolato online',
  import: 'Importato da file',
  restore: 'Versione precedente ripristinata',
  copied: 'Creato a partire da un viaggio pubblicato',
};

/**
 * Casi d'uso sui viaggi dell'utente autenticato: salvataggio con storico,
 * import/export, eliminazione morbida, cronologia e ripristino delle versioni.
 * Le azioni importanti finiscono nel registro attività (S-06).
 */
export class TripsService {
  constructor(private readonly trips: TripsRepository, private readonly account: AccountRepository) {}

  list(): Promise<StoredTrip[]> {
    return this.trips.list();
  }

  async get(id: string): Promise<StoredTrip> {
    const trip = await this.trips.get(id);
    if (!trip) throw new HttpError(404, 'Viaggio non trovato.');
    return trip;
  }

  async create(itinerary: Itinerary, title?: string): Promise<StoredTrip> {
    const trip = await this.trips.save({ itinerary, title, changeKind: 'created', summary: CHANGE_LABELS.created });
    await this.account.record({ action: 'trip.create', entity: 'trip', entityId: trip.id, metadata: { destination: trip.itinerary.destination } });
    return trip;
  }

  async update(id: string, itinerary: Itinerary, options: { title?: string; changeKind?: TripChangeKind; summary?: string; recordVersion?: boolean } = {}): Promise<StoredTrip> {
    await this.get(id);
    const changeKind = options.changeKind ?? 'edited';
    const trip = await this.trips.save({ tripId: id, itinerary, title: options.title, changeKind, summary: options.summary ?? CHANGE_LABELS[changeKind], recordVersion: options.recordVersion });
    if (options.recordVersion !== false) await this.account.record({ action: `trip.${changeKind}`, entity: 'trip', entityId: id, metadata: { version: trip.currentVersion } });
    return trip;
  }

  async rename(id: string, title: string): Promise<StoredTrip> {
    const trimmed = title.trim();
    if (!trimmed) throw new HttpError(400, 'Il nome del viaggio non può essere vuoto.');
    if (trimmed.length > 160) throw new HttpError(400, 'Il nome del viaggio può avere al massimo 160 caratteri.');
    const trip = await this.trips.rename(id, trimmed);
    if (!trip) throw new HttpError(404, 'Viaggio non trovato.');
    await this.account.record({ action: 'trip.rename', entity: 'trip', entityId: id, metadata: { title: trimmed } });
    return trip;
  }

  async remove(id: string): Promise<void> {
    if (!(await this.trips.softDelete(id))) throw new HttpError(404, 'Viaggio non trovato.');
    await this.account.record({ action: 'trip.delete', entity: 'trip', entityId: id });
  }

  async exportJson(id: string): Promise<{ filename: string; json: string }> {
    const trip = await this.get(id);
    const slug = trip.itinerary.destination.toLocaleLowerCase('it').replace(/[^a-z0-9]+/g, '-') || 'viaggio';
    const { currentVersion: _version, ...exported } = trip;
    return { filename: `${slug}-odys.json`, json: serializeTripExport({ ...exported, planVersion: 5 }) };
  }

  /** Valida un export senza salvarlo e segnala se sostituirebbe un viaggio esistente. */
  async previewImport(raw: string) {
    const { trip, error } = parseTripExport(raw);
    if (error || !trip) throw new HttpError(422, error ?? 'Non è stato possibile leggere questo export.');
    const existing = (await this.trips.get(trip.id)) ?? (await this.trips.findByLegacyId(trip.id));
    return { trip, replacesExisting: Boolean(existing), existingId: existing?.id };
  }

  async import(raw: string): Promise<{ trip: StoredTrip; replaced: boolean }> {
    const { trip, existingId } = await this.previewImport(raw);
    const saved = await this.trips.save({
      tripId: existingId,
      itinerary: trip.itinerary,
      title: trip.title,
      changeKind: 'import',
      summary: CHANGE_LABELS.import,
      legacyId: existingId ? undefined : trip.id,
    });
    await this.account.record({ action: 'trip.import', entity: 'trip', entityId: saved.id, metadata: { replaced: Boolean(existingId) } });
    return { trip: saved, replaced: Boolean(existingId) };
  }

  async versions(id: string): Promise<TripVersionSummary[]> {
    await this.get(id);
    return this.trips.listVersions(id);
  }

  async version(id: string, version: number): Promise<TripVersion> {
    const found = await this.trips.getVersion(id, version);
    if (!found) throw new HttpError(404, 'Versione non trovata.');
    return found;
  }

  /** Il ripristino non cancella nulla: crea una nuova versione uguale a quella scelta. */
  async restore(id: string, version: number): Promise<StoredTrip> {
    const target = await this.version(id, version);
    return this.update(id, target.itinerary, { changeKind: 'restore', summary: `Ripristinata la versione ${version}` });
  }
}
