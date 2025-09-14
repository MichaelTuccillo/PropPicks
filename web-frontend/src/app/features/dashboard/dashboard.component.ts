import { Component, computed, inject, signal, DestroyRef, effect } from '@angular/core';
import { NgFor, NgIf, DatePipe, NgClass, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';

import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';

import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

import { Sport, SPORTS, MODEL_OPTIONS } from '../../shared/types';
import { StatsService, StatRow } from '../../shared/stats.service';
import { PastBetsService, PastBet } from '../../shared/past-bets.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

type RecentRow = {
  id: string;
  date: string;
  modelName: string;
  sport: string;
  event: string;
  betType: 'Single' | 'SGP' | 'SGP+';
  combinedOdds: string;
  result: 'win' | 'loss' | 'push' | null;
  resultUnits: number | null;
};

type CardVM = {
  id: string;
  name: string;
  all_wl: string;
  all_units: number;
  all_units_str: string;
};

type ModelVM = { id: string; name: string; selected?: boolean };

const SERIES_COLORS = ['#60a5fa','#22c55e','#eab308','#2dd4bf','#94a3b8','#f87171','#fb923c'];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    NgFor, NgIf, DatePipe, NgClass,
    MatButtonToggleModule, MatChipsModule, MatCardModule, MatCheckboxModule, MatTableModule, MatIconModule,
    NgChartsModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent {
  private statsApi = inject(StatsService);
  private pastApi = inject(PastBetsService);
  private destroyRef = inject(DestroyRef);

  isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // Sports/models come from shared types (canonical)
  readonly sports = computed<string[]>(() => ['All', ...SPORTS]);
  readonly models = computed<ModelVM[]>(() => MODEL_OPTIONS.map(m => ({ id: m.id, name: m.name, selected: !!m.selected })));

  sport = signal<Sport>('MLB');
  mode  = signal<'Single' | 'SGP' | 'SGP+'>('SGP');

  private stats = signal<StatRow[] | null>(null);
  private bets  = signal<PastBet[] | null>(null);

  selectedIds = signal<Set<string>>(new Set());
  private initSelected = effect(() => {
    const ms = this.models();
    if (this.selectedIds().size === 0 && ms.length) {
      this.selectedIds.set(new Set(ms.map(m => m.id)));
    }
  });

  grading = new Set<string>();

  // Fetch stats when mode changes
  private statsOnModeChange = effect(() => {
    if (!this.isBrowser) return;
    const m = this.mode();
    this.statsApi.fetch(m)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: rows => this.stats.set(rows) });
  });

  async ngOnInit() {
    if (!this.isBrowser) return;
    this.reloadBets();
  }

  private reloadBets() {
    this.pastApi.list(15)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: rows => this.bets.set(rows) });
  }

  private refreshStats() {
    this.statsApi.fetch(this.mode())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: rows => this.stats.set(rows) });
  }

  /** Summary cards built from canonical models; stats may be missing → show 0s */
  summaries = computed<CardVM[]>(() => {
    const rows = this.stats() ?? [];
    const currentSport = String(this.sport());

    // group rows by model id (lowercased)
    const byModel = new Map<string, StatRow[]>();
    for (const r of rows) {
      const key = (r.model || '').toLowerCase();
      const list = byModel.get(key) ?? [];
      list.push(r);
      byModel.set(key, list);
    }

    return this.models().map(m => {
      const list = byModel.get(m.id.toLowerCase()) ?? [];
      let wins = 0, losses = 0, units = 0;

      if (currentSport === 'All') {
        // Aggregate across all sports (include any 'ALL' summary rows too)
        for (const r of list) {
          wins   += r.wins   ?? 0;
          losses += r.losses ?? 0;
          units  += r.units  ?? 0;
        }
      } else {
        // Match specific sport (case-insensitive); ignore 'ALL' here
        const row = list.find(r => (r.sport || '').toUpperCase() === currentSport.toUpperCase());
        wins   = row?.wins   ?? 0;
        losses = row?.losses ?? 0;
        units  = row?.units  ?? 0;
      }

      const unitsStr = `${units >= 0 ? '+' : ''}${units.toFixed(2)}u`;
      return { id: m.id, name: m.name, all_wl: `${wins}–${losses}`, all_units: units, all_units_str: unitsStr };
    });
  });

  /** Whether we have any graded bets to plot (last 15 for current mode & selected models) */
  hasRecentChartData = computed<boolean>(() => {
    const list = this.bets() ?? [];
    const currentMode = this.mode();
    const allowedLC = new Set<string>(Array.from(this.selectedIds()).map(s => s.toLowerCase()));

    const graded = list.filter(b => {
      if (!b || !b.result || (b.result !== 'win' && b.result !== 'loss' && b.result !== 'push')) return false;
      if (b.type !== currentMode) return false;
      return allowedLC.has((b.model || '').toLowerCase());
    });

    graded.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const last15 = graded.slice(-15);
    return last15.length > 0;
  });

  /** Cumulative Units (Last 15 graded bets across selected models) */
  lineCfg = computed<ChartConfiguration<'line'>>(() => {
    const list = this.bets() ?? [];
    const currentMode = this.mode();
    const allowedLC = new Set<string>(Array.from(this.selectedIds()).map(s => s.toLowerCase()));

    const graded = list.filter(b => {
      if (!b || !b.result || (b.result !== 'win' && b.result !== 'loss' && b.result !== 'push')) return false;
      if (b.type !== currentMode) return false;
      return allowedLC.has((b.model || '').toLowerCase());
    });

    graded.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const last15 = graded.slice(-15);

    let cum = 0;
    const labels = last15.map(b => new Date(b.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    const values = last15.map(b => (cum += (typeof b.resultUnits === 'number' ? b.resultUnits : 0)));

    return {
      type: 'line',
      data: {
        labels,
        datasets: [{ label: 'Cumulative Units (Last 15)', data: values, tension: 0.35, pointRadius: 0, borderWidth: 2, borderColor: SERIES_COLORS[0] }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false } } } }
    };
  });

  recent = computed<RecentRow[]>(() => {
    const list = this.bets() ?? [];
    return list.map(b => ({
      id: b.id, date: b.date, modelName: b.model, sport: b.sport, event: b.event,
      betType: b.type, combinedOdds: b.odds,
      result: (b.result ?? '') as any || null,
      resultUnits: typeof b.resultUnits === 'number' ? b.resultUnits : null
    }));
  });

  displayedColumns = ['date','model','sport','event','type','odds','grade','result'];

  setSport(s: string) { this.sport.set(s as Sport); }
  setMode(m: 'Single' | 'SGP' | 'SGP+') { this.mode.set(m); }

  toggleModel(id: string, checked: boolean) {
    this.selectedIds.update(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }

  grade(row: RecentRow, outcome: '' | 'win' | 'loss' | 'push') {
    if (!row?.id || this.grading.has(row.id)) return;
    this.grading.add(row.id);
    this.pastApi.setResult(row.id, outcome).subscribe({
      next: () => { this.reloadBets(); this.refreshStats(); },
      complete: () => this.grading.delete(row.id),
    });
  }

  resultClass(row: RecentRow): string {
    switch (row.result) {
      case 'win':  return 'res res-win';
      case 'loss': return 'res res-loss';
      case 'push': return 'res res-push';
      default:     return 'res res-none';
    }
  }
  formatUnits(row: RecentRow): string {
    if (row.result === 'win' || row.result === 'loss') {
      const u = row.resultUnits ?? 0;
      const sign = u > 0 ? '+' : (u < 0 ? '' : '+');
      return `${sign}${u.toFixed(2)}u`;
    }
    if (row.result === 'push') return '0.00u';
    return '—';
  }

  trackModel = (_: number, m: any) => m.id as string;
}
