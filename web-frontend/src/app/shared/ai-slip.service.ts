import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment.development';
import type { GameDTO } from './games.service';

export interface AiFilters {
  sport: string;
  mode: 'Single' | 'SGP' | 'SGP+';
  legs: number;
  minOdds: number;
  maxOdds: number;
  model: string; // exactly one selected
  boostPct?: number;
  games: GameDTO[]
}

export interface AiSlipLeg {
  market: string;
  pick: string;
  line?: string;
  odds?: string;
  notes?: string;
}

export interface AiBetSlip {
  title: string;
  event: string;
  legs: AiSlipLeg[];
  combinedOdds?: string;
  rationale?: string;
  createdAt?: string;
}

@Injectable({ providedIn: 'root' })
export class AiSlipService {
  private base = (environment as any)?.apiBase || '/api';
  constructor(private http: HttpClient) {}

  generateSlip(filters: AiFilters) {
    return this.http.post<AiBetSlip>(`${this.base}/generate-slip`, { filters });
  }
}
