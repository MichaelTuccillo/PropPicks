import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment.development';
import { Observable, map, of, takeUntil } from 'rxjs';
import { AuthService } from './auth.service';

export type PastBet = {
  id: string;
  type: 'Single' | 'SGP' | 'SGP+';
  date: string;
  model: string;
  sport: string;
  event: string;
  odds: string;
  result?: 'win' | 'loss' | 'push' | '';
  resultUnits?: number;
};

export type SavePastBetPayload = Omit<PastBet, 'id' | 'result' | 'resultUnits'>;

@Injectable({ providedIn: 'root' })
export class PastBetsService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private base = `${environment.apiBase}/past-bets`;

  private isAuthed() { return !!this.auth.user(); }

  list(): Observable<PastBet[]> {
    if (!this.isAuthed()) return of([]);
    return this.http
      .get<{ bets: PastBet[] }>(this.base, { withCredentials: true })
      .pipe(
        takeUntil(this.auth.logout$),
        map(r => r?.bets ?? [])
      );
  }

  save(bet: SavePastBetPayload): Observable<{ ok: boolean }> {
    if (!this.isAuthed()) return of({ ok: false });
    return this.http.post<{ ok: boolean }>(this.base, bet, { withCredentials: true })
      .pipe(takeUntil(this.auth.logout$));
  }

  /** Grade a bet. Accepts 'win'|'loss'|'push' in any casing; normalizes to lower-case. */
  setResult(id: string, result: 'win' | 'loss' | 'push' | ''): Observable<{ ok: boolean }> {
    if (!this.isAuthed()) return of({ ok: false });
    const normalized = (result || '').toString().trim().toLowerCase() as 'win'|'loss'|'push'|'';
    return this.http.post<{ ok: boolean }>(
      `${this.base}/result`,
      { id, result: normalized },
      { withCredentials: true }
    ).pipe(takeUntil(this.auth.logout$));
  }
}
