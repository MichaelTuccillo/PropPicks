import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment.development';
import { Observable, map } from 'rxjs';

export type PastBet = {
  id: string;
  type: 'Single' | 'SGP' | 'SGP+';
  date: string;            // ISO string
  model: string;           // e.g. "narrative"
  sport: string;           // e.g. "MLB"
  event: string;           // text
  odds: string;            // e.g. "+450"
  result?: 'win' | 'loss' | 'push' | '';
  resultUnits?: number;    // +/- units if graded
};

// Payload used when saving a new bet (server assigns id/result)
export type SavePastBetPayload = Omit<PastBet, 'id' | 'result' | 'resultUnits'>;

@Injectable({ providedIn: 'root' })
export class PastBetsService {
  private http = inject(HttpClient);
  private base = `${environment.apiBase}/past-bets`;

  /** Load newest 15 bets for the authed user from the API. */
  list(): Observable<PastBet[]> {
    return this.http
      .get<{ bets: PastBet[] }>(this.base, { withCredentials: true })
      .pipe(map(r => r?.bets ?? []));
  }

    /** Save a newly generated bet. */
  save(bet: SavePastBetPayload): Observable<{ ok: boolean }> {
    // IMPORTANT: server expects the raw object, not { bet: ... }
    return this.http.post<{ ok: boolean }>(this.base, bet, { withCredentials: true });
  }


  /** Update result (win/loss/push) – optional endpoint */
  setResult(id: string, result: 'win' | 'loss' | 'push' | '') {
    return this.http.post<{ ok: boolean }>(`${this.base}/result`, { id, result }, { withCredentials: true });
  }
}
