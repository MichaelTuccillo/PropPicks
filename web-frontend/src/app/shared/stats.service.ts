import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment.development';
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

@Injectable({ providedIn: 'root' })
export class StatsService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private base = `${environment.apiBase}/model-stats`;

  fetch(): Observable<StatRow[]> {
    if (!this.auth.user()) return of([]);
    return this.http.get<{ stats: StatRow[] }>(this.base, { withCredentials: true })
      .pipe(
        takeUntil(this.auth.logout$),
        map(r => r?.stats ?? [])
      );
  }
}
