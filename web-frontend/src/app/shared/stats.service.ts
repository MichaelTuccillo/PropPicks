import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment.development';
import { Observable, map } from 'rxjs';

export interface StatRow {
  model: string;  // e.g., "narrative"
  sport: string;  // "NFL" | "NBA" | "NHL" | "MLB" | "ALL"
  wins: number;
  losses: number;
  pushes: number;
  bets: number;
  units: number;
  roiPct: number;
}

@Injectable({ providedIn: 'root' })
export class StatsService {
  private http = inject(HttpClient);
  private base = `${environment.apiBase}`;

  fetch(): Observable<StatRow[]> {
    return this.http
      .get<{stats: StatRow[]}>(`${this.base}/model-stats`, { withCredentials: true })
      .pipe(map(r => r?.stats ?? []));
  }
}
