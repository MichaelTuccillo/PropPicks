import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type { GameDTO } from './games.service';
import { environment } from '../../environments/environment.prod';

export interface AiFilters {
  sport: string;
  mode: 'Single' | 'SGP' | 'SGP+';
  legs: number;
  minOdds: number;
  maxOdds: number;
  model: string;          // exactly one selected
  boostPct?: number;
  games?: GameDTO[];
}

export interface AiBetSlip {
  title?: string;
  event?: string;
  legs: { market: string; pick: string; line?: string; odds?: string; notes?: string }[];
  combinedOdds?: string;
  estimatedPayout?: {
    preBoostMultiple: number;
    preBoostAmerican: string;
    postBoostMultiple: number;
    postBoostAmerican: string;
    assumptions: string;
  };
  rationale?: string;
}

@Injectable({ providedIn: 'root' })
export class AiSlipService {
  constructor(private http: HttpClient) {}
  private base = `${environment.apiBase}`;

  generateSlip(filters: AiFilters): Observable<AiBetSlip> {
    return this.http.post<AiBetSlip>(`${this.base}/generate-slip`, { filters });
  }
}
