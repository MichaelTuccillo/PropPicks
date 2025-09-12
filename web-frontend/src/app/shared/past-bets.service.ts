import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
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
  result?: 'win' | 'loss' | 'push' | '';
  resultUnits?: number;
};

export type SavePastBetPayload = Omit<PastBet, 'id' | 'result' | 'resultUnits'>;

@Injectable({ providedIn: 'root' })
export class PastBetsService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private base = `${environment.apiBase}/past-bets`;

  private headers(): HttpHeaders | undefined {
    const u = this.auth.user();
    return u?.id ? new HttpHeaders({ 'X-PP-User': u.id }) : undefined;
  }

  list(): Observable<PastBet[]> {
    return this.http
      .get<{ bets: PastBet[] }>(this.base, { withCredentials: true, headers: this.headers() })
      .pipe(map(r => r?.bets ?? []));
  }

  save(bet: SavePastBetPayload): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(this.base, bet, { withCredentials: true, headers: this.headers() });
  }

  setResult(id: string, result: 'win' | 'loss' | 'push' | ''): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/result`, { id, result }, { withCredentials: true, headers: this.headers() });
  }
}
