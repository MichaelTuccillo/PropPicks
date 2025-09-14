import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment.development';
import { Observable, map } from 'rxjs';
import { AuthService } from './auth.service';

export type PastBet = {
  id: string;
  type: 'Single' | 'SGP' | 'SGP+';
  date: string;
  model: string;
  sport: string;
  event: string;
  odds: string;
  units?: number;                 // NEW: stake (units)
  result?: 'win' | 'loss' | 'push' | '';
  resultUnits?: number;           // +/- units for this bet’s stake
};

export type SavePastBetPayload = Omit<PastBet, 'id' | 'result' | 'resultUnits'>;

@Injectable({ providedIn: 'root' })
export class PastBetsService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private base = `${environment.apiBase}/past-bets`;
  
  /** Fetch most recent bets. Default (and desired) is 15 for the graph. */
  list(limit: number = 15): Observable<PastBet[]> {
    const url = `${this.base}?limit=${limit}`;
    return this.http
      .get<{ bets: PastBet[] }>(url, { withCredentials: true })
      .pipe(map(r => r?.bets ?? []));
  }

  save(bet: SavePastBetPayload): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(this.base, bet, {
      withCredentials: true
    });
  }

  setResult(id: string, result: 'win' | 'loss' | 'push' | ''): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/result`, { id, result }, {
      withCredentials: true
    });
  }
}
