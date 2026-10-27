import { inject, Injectable } from '@angular/core';
import { ApiClient } from './api-client';

export type ThemePreference = 'light' | 'dark' | 'system';

export interface Profile {
  id: string;
  email?: string;
  firstName: string;
  lastName: string;
  birthDate?: string;
  bio?: string;
  interests: string[];
  publicHeadline?: string;
  role: 'traveler' | 'coordinator' | 'agency' | 'admin';
  status: 'active' | 'suspended' | 'disabled';
  createdAt: string;
}

export interface Preferences {
  theme: ThemePreference;
  onboardingCompletedAt?: string;
}

export interface ActivityEntry {
  action: string;
  entity?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

/** Endpoint `/api/me`: profilo, preferenze, idee salvate, registro, eliminazione account. */
@Injectable({ providedIn: 'root' })
export class AccountApi {
  private readonly api = inject(ApiClient);

  me() { return this.api.get<{ profile: Profile; preferences: Preferences }>('/me'); }
  updateProfile(patch: Partial<Pick<Profile, 'firstName' | 'lastName' | 'bio' | 'interests' | 'publicHeadline'>>) { return this.api.patch<Profile>('/me', patch); }
  updatePreferences(patch: { theme?: ThemePreference; onboardingCompleted?: boolean }) { return this.api.put<Preferences>('/me/preferences', patch); }
  activity() { return this.api.get<ActivityEntry[]>('/me/activity'); }
  savedIdeas() { return this.api.get<string[]>('/me/saved-ideas'); }
  saveIdea(id: string) { return this.api.put<void>(`/me/saved-ideas/${encodeURIComponent(id)}`, {}); }
  removeIdea(id: string) { return this.api.delete(`/me/saved-ideas/${encodeURIComponent(id)}`); }
  deleteAccount() { return this.api.deleteWithBody('/me', { confirm: 'ELIMINA' }); }
}
