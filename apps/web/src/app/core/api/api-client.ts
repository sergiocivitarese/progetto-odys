import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, InjectionToken } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Base URL del backend. In sviluppo `/api` passa dal proxy di `ng serve` (proxy.conf.json). */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', { factory: () => '/api' });

/** Estrae il messaggio leggibile restituito dal backend (`{ error }`). */
export function apiErrorMessage(error: unknown, fallback = 'Qualcosa non ha funzionato. Riprova.'): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'Server Odys non raggiungibile. Controlla che il backend sia avviato.';
    if (error.status === 401) return 'Accedi per continuare.';
    const message = (error.error as { error?: unknown } | null)?.error;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

/** Client HTTP minimale basato su Promise: più leggibile di RxJS per chi inizia con Angular. */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
    const clean = Object.fromEntries(Object.entries(params ?? {}).filter(([, value]) => value !== undefined)) as Record<string, string>;
    return firstValueFrom(this.http.get<T>(`${this.baseUrl}${path}`, { params: clean }));
  }

  getText(path: string): Promise<string> {
    return firstValueFrom(this.http.get(`${this.baseUrl}${path}`, { responseType: 'text' }));
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T>(`${this.baseUrl}${path}`, body));
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.put<T>(`${this.baseUrl}${path}`, body));
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(`${this.baseUrl}${path}`, body));
  }

  delete<T = void>(path: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(`${this.baseUrl}${path}`));
  }

  deleteWithBody(path: string, body: unknown): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.baseUrl}${path}`, { body }));
  }

  url(path: string): string {
    return `${this.baseUrl}${path}`;
  }
}
