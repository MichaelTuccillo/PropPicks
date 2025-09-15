import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment.prod';
import { Observable, of, map, takeUntil } from 'rxjs';
import { AuthService } from './auth.service';

export type StatRow = {
  model: string;
  sport: string;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  units: number;
  roiPct: number;
};

export type Mode = 'Single' | 'SGP' | 'SGP+' | 'ALL';

@Injectable({ providedIn: 'root' })
export class StatsService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private base = `${environment.apiBase}/model-stats`;

  fetch(mode: 'Single'|'SGP'|'SGP+'|'ALL' = 'ALL'): Observable<StatRow[]> {
    if (!this.auth.user()) return of([]);
    const q = encodeURIComponent(mode);
    return this.http.get<{ stats: StatRow[] }>(`${this.base}?mode=${q}`, { withCredentials: true })
      .pipe(
        takeUntil(this.auth.logout$),
        map(r => r?.stats ?? [])
      );
  }
}
