import { Injectable, signal } from '@angular/core';
import { BetRow, EquityPoint, ModelDetailStats, ModelSummary, Sport } from './types';

@Injectable({ providedIn: 'root' })
export class MockDataService {
  sports: Sport[] = ['All', 'NFL', 'NHL', 'NBA', 'MLB', 'WNBA', 'NCAAF', 'ATP/WTA'];
  models: ModelSummary[] = [
    { id:'narrative',   name:'Narrative',   l14_wl:'18–12', l14_roi: 12.4, all_wl:'210–180', all_roi: 8.2 },
    { id:'weird',       name:'Weird',       l14_wl:'15–15', l14_roi:  2.1, all_wl:'205–198', all_roi: 3.7 },
    { id:'random',      name:'Random',      l14_wl:'16–14', l14_roi:  4.9, all_wl:'198–202', all_roi:-1.1 },
    { id:'contrarian',  name:'Contrarian',  l14_wl:'19–11', l14_roi: 14.8, all_wl:'220–190', all_roi:10.3 },
    { id:'micro',       name:'Micro-Edges', l14_wl:'17–13', l14_roi:  7.2, all_wl:'214–185', all_roi: 9.0 },
    { id:'pessimist',   name:'Pessimist',   l14_wl:'14–16', l14_roi: -1.9, all_wl:'200–201', all_roi:-0.5 },
    { id:'heatcheck',   name:'Heat-Check',  l14_wl:'18–12', l14_roi: 12.9, all_wl:'209–190', all_roi: 6.6 },
  ].map(m => ({ ...m, selected: ['contrarian','micro','narrative','weird','random','pessimist','heatcheck'].includes(m.id) }));

  selectedSport = signal<Sport>('All');
  sgpMode = signal<'SGP' | 'SGP+'>('SGP');

  getModelSummaries(sport: Sport, mode: 'Single' | 'SGP' | 'SGP+'): ModelSummary[] {
    const k = mode === 'SGP+' ? 1.15 : 1;
    return this.models.map(m => ({
      ...m,
      l14_roi: +(m.l14_roi * k).toFixed(1),
      all_roi: +(m.all_roi * k).toFixed(1),
    }));
  }

  getCumulative(seriesIds: string[]): {label: string, data: EquityPoint[]}[] {
    const labels = Array.from({length:14}, (_,i)=>`D-${14-i}`);
    return seriesIds.map((id, idx) => {
      let v = 0;
      const data = labels.map(() => {
        v += (Math.random() - 0.45) * (idx % 2 ? 2 : 3);
        return { label: '', value: +v.toFixed(2) };
      });
      return { label: this.models.find(m=>m.id===id)?.name || id, data };
    });
  }

  getRecentBets(limit = 12): BetRow[] {
    const sports: Sport[] = ['NFL', 'NHL', 'NBA', 'MLB','WNBA','NCAAF','ATP/WTA'];
    const models = this.models;
    const now = new Date();
    return Array.from({length: limit}).map((_,i) => {
      const m = models[i % models.length];
      const s = sports[i % sports.length];
      const d = new Date(now.getTime() - i*3600_000);
      const units = +(Math.random()*2 - 1).toFixed(2);
      return {
        date: d.toISOString(),
        modelId: m.id,
        modelName: m.name,
        sport: s,
        event: `${s} Event ${i+1}`,
        betType: i%2 ? 'SGP' : 'SGP+',
        combinedOdds: i%3 ? '+350' : '+425',
        resultUnits: units
      };
    });
  }

  getModelDetailStats(_id: string): ModelDetailStats {
    return {
      l14_wl:'18–12', l14_roi:12.4, all_wl:'210–180', all_roi:8.2,
      avgSgpOdds:'+395', hitRate:53.2, maxDrawdown:-18.4, longestWin:6, longestLoss:4
    };
  }

  getModelEquity(_id: string): EquityPoint[] {
    let v = 0;
    return Array.from({length: 60}, (_,i) => {
      v += (Math.random() - 0.48) * 2.4;
      return { label: `#${i+1}`, value: +v.toFixed(2) };
    });
  }

  getModelBetLog(_id: string, n = 40): BetRow[] {
    return this.getRecentBets(n).map(b => ({ ...b, betType: Math.random()>0.5? 'Under' : 'Over' }));
  }
}
