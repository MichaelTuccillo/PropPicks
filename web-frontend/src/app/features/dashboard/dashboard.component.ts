import { Component, computed, inject, signal, DestroyRef, effect } from '@angular/core';
import { NgFor, NgIf, DatePipe, NgClass, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { RouterLink } from '@angular/router';

import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';

import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

import { MockDataService } from '../../shared/mock-data.service';
import { DemoStateService } from '../../shared/demo-state.service';
import { Sport } from '../../shared/types';
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

const SERIES_COLORS = ['#60a5fa','#22c55e','#eab308','#2dd4bf','#94a3b8','#f87171','#fb923c'];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    NgFor, NgIf, DatePipe, NgClass, RouterLink,
    MatButtonToggleModule, MatChipsModule, MatCardModule, MatCheckboxModule, MatTableModule, MatIconModule,
    NgChartsModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent {
  public data = inject(MockDataService); // model list / defaults
  private demoSvc = inject(DemoStateService);
  private statsApi = inject(StatsService);
  private pastApi = inject(PastBetsService);
  private destroyRef = inject(DestroyRef);

  isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  demo = this.demoSvc.demo;

  sport = signal<Sport>('MLB');                 // 'MLB' | 'NFL' | ... | 'ALL'
  mode  = signal<'Single' | 'SGP' | 'SGP+'>('SGP');

  private stats = signal<StatRow[] | null>(null); // /api/model-stats?mode=...
  private bets  = signal<PastBet[] | null>(null); // /api/past-bets (latest 15)

  grading = new Set<string>();

  // Refetch stats whenever the selected mode changes
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
    this.pastApi.list(15) // <-- ensure only last 15 bets are loaded
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: rows => this.bets.set(rows) });
  }

  /** Re-fetch stats (used after grading a bet) */
  private refreshStats() {
    this.statsApi.fetch(this.mode())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: rows => this.stats.set(rows) });
  }

  /** ======== SUMMARY CARDS ======== 
   * If sport === 'ALL', aggregate across all sports for the selected mode.
   * Otherwise, show the row for the selected sport (fallback to 0s if none).
   */
  summaries = computed<CardVM[]>(() => {
    const rows = this.stats() ?? [];
    const currentSport = String(this.sport()).toUpperCase(); // e.g., 'MLB' or 'ALL'

    // Group stats rows by model for quick access
    const byModel = new Map<string, StatRow[]>();
    for (const r of rows) {
      const key = r.model.toLowerCase();
      const arr = byModel.get(key) ?? [];
      arr.push(r);
      byModel.set(key, arr);
    }

    return this.data.models.map(m => {
      const list = byModel.get(m.id.toLowerCase()) ?? [];

      let wins = 0, losses = 0, units = 0;

      if (currentSport === 'ALL') {
        // Aggregate across all sports for this model
        for (const r of list) {
          wins   += r.wins   ?? 0;
          losses += r.losses ?? 0;
          units  += r.units  ?? 0;
        }
      } else {
        // Use only the row for the selected sport (if present)
        const row = list.find(r => r.sport === currentSport);
        wins   = row?.wins   ?? 0;
        losses = row?.losses ?? 0;
        units  = row?.units  ?? 0;
      }

      const unitsStr = `${units >= 0 ? '+' : ''}${units.toFixed(2)}u`;
      return {
        id: m.id,
        name: m.name,
        all_wl: `${wins}–${losses}`,
        all_units: units,
        all_units_str: unitsStr,
      };
    });
  });

  selectedIds = signal<Set<string>>(new Set(
    this.data.models.filter(m => m.selected).map(m => m.id)
  ));

    /** ======== CUMULATIVE UNITS (last 15 graded bets across selected models) ======== */
  lineCfg = computed<ChartConfiguration<'line'>>(() => {
    const list = this.bets() ?? [];
    const currentMode = this.mode();

    // Build a set with selected model IDs and Names (lowercased) for robust matching
    const selected = this.selectedIds();
    const idSetLC = new Set<string>(Array.from(selected).map(s => s.toLowerCase()));
    const nameByIdLC = new Map<string, string>(
      this.data.models.map(m => [m.id.toLowerCase(), m.name.toLowerCase()])
    );
    const nameFromId = (idLC: string) => nameByIdLC.get(idLC);
    const allowedLC = new Set<string>([
      ...idSetLC,
      ...Array.from(idSetLC).map((id) => nameFromId(id) || '').filter(Boolean) as string[]
    ]);

    // Keep only graded bets in the current mode for selected models (match by id or name)
    const graded = list.filter(b => {
      if (!b || !b.result || (b.result !== 'win' && b.result !== 'loss' && b.result !== 'push')) return false;
      if (b.type !== currentMode) return false;
      const bm = (b.model || '').toLowerCase();
      const isMatch =
        allowedLC.has(bm) ||
        (nameByIdLC.has(bm) && allowedLC.has(nameByIdLC.get(bm)!)) ||
        Array.from(nameByIdLC.entries()).some(([id, nm]) => nm === bm && allowedLC.has(id));
      return isMatch;
    });

    // Sort oldest->newest and take the last 15
    graded.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const last15 = graded.slice(-15);

    // Build cumulative series
    let cum = 0;
    const labels = last15.map(b => {
      const d = new Date(b.date);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });
    const values = last15.map(b => {
      const u = typeof b.resultUnits === 'number' ? b.resultUnits : 0;
      cum += u;
      return cum;
    });

    return {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Cumulative Units (Last 15)',
          data: values,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
          borderColor: SERIES_COLORS[0],
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { x: { grid: { display: false } } }
      }
    };
  });


  recent = computed<RecentRow[]>(() => {
    const list = this.bets() ?? [];
    return list.map(b => ({
      id: b.id,
      date: b.date,
      modelName: b.model,
      sport: b.sport,
      event: b.event,
      betType: b.type,
      combinedOdds: b.odds,
      result: (b.result ?? '') as any || null,
      resultUnits: typeof b.resultUnits === 'number' ? b.resultUnits : null
    }));
  });

  displayedColumns = ['date','model','sport','event','type','odds','grade','result'];

  setSport(s: Sport) { this.sport.set(s); }
  setMode(m: 'Single' | 'SGP' | 'SGP+') { this.mode.set(m); } // effect() refetches stats

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
      next: () => {
        this.reloadBets();   // refresh recent list (and chart source)
        this.refreshStats(); // refresh summary cards immediately
      },
      error: () => { /* optionally toast */ },
      complete: () => this.grading.delete(row.id),
    });
  }

  // Result column helpers
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
