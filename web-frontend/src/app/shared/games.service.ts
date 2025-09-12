import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface GameDTO {
  id: string;
  sport: string;
  start: string; // RFC3339
  home: string;
  away: string;
  label: string;
}

@Injectable({ providedIn: 'root' })
export class GamesService {
  private base = '/api'; // dev proxy will forward to 8080
  constructor(private http: HttpClient) {}

  listGames(sport: string, days = 7): Observable<{ games: GameDTO[] }> {
    const params = new HttpParams().set('sport', sport).set('days', days);
    return this.http.get<{ games: GameDTO[] }>(`${this.base}/games`, { params });
  }
}
