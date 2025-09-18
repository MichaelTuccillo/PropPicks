import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment.prod';
import { Observable, map } from 'rxjs';

export type BetLeg = {
  team?: string;
  player?: string;
  market: string;   // e.g. "PTS", "AST", "ML"
  line?: string;    // e.g. "25+", "25.5"
  odds?: string;    // e.g. "+140", "-110"
  result?: 'win' | 'loss' | 'push';
};

export type PastBet = {
  id: string;
  type: 'Single' | 'SGP' | 'SGP+';
  date: string;
  model: string;
  sport: string;
  event: string;
  legs?: BetLeg[];            // NEW: legs shown under the event
  odds: string;
  units?: number;             // stake (units)
  result?: 'win' | 'loss' | 'push' | '';
  resultUnits?: number;       // +/- units for this bet’s stake
};

export type SavePastBetPayload = Omit<PastBet, 'id' | 'result' | 'resultUnits'>;

@Injectable({ providedIn: 'root' })
export class PastBetsService {
  private http = inject(HttpClient);
  // Keep using your current env var name; change to apiBaseUrl if that’s what you use elsewhere.
  private base = `${environment.apiBase}/past-bets`;

  /** Fetch most recent bets (backend currently trims to 15 regardless). */
  list(limit: number = 15): Observable<PastBet[]> {
    const url = `${this.base}?limit=${limit}`;
    return this.http
      .get<{ bets: PastBet[] }>(url, { withCredentials: true })
      .pipe(map(r => r?.bets ?? []));
  }

  /** Save a bet (supports optional legs). Backend returns { ok, bet }. */
  save(bet: SavePastBetPayload): Observable<{ ok: boolean; bet?: PastBet }> {
    return this.http.post<{ ok: boolean; bet?: PastBet }>(this.base, bet, {
      withCredentials: true
    });
  }

  /** Grade a bet. Backend returns { ok, bet }. */
  setResult(id: string, result: 'win' | 'loss' | 'push' | ''): Observable<{ ok: boolean; bet?: PastBet }> {
    return this.http.post<{ ok: boolean; bet?: PastBet }>(`${this.base}/result`, { id, result }, {
      withCredentials: true
    });
  }
}
