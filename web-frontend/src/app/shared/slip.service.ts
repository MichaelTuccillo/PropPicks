// web-frontend/src/app/shared/slip.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BetSlip } from './models';
import { environment } from '../../environments/environment.development';

@Injectable({ providedIn: 'root' })
export class SlipService {
  private base = (environment as any)?.apiUrl || '/api';

  constructor(private http: HttpClient) {}

  generateSlip(filters: any) {
    return this.http.post<BetSlip>(`${this.base}/generate-slip`, { filters });
  }
}
