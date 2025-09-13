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
  public data = inject(MockDataService); // still used for the model list / defaults
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
    this.pastApi.list()
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

  /** ======== CUMULATIVE GAINS CHART (live from real bets) ========
   * Builds cumulative units over time per selected model & current mode.
   * Only graded bets (win/loss/push) are included; ungraded are ignored.
   * Dates are grouped by day to keep the X axis tidy.
   */
  lineCfg = computed<ChartConfiguration<'line'>>(() => {
    const list = this.bets() ?? [];
    if (!list.length) {
      return {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false } } } }
      };
    }

    const chosen = new Set(this.selectedIds());
    const currentMode = this.mode();

    // Helper: YYYY-MM-DD from ISO
    const dayKey = (iso: string) => {
      const d = new Date(iso);
      // Normalize to local date. If you want UTC, use getUTC* instead.
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const pretty = (key: string) => {
      const d = new Date(key);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };

    // Collect graded bets per model & date for the current mode
    const perModelPerDay = new Map<string, Map<string, number>>(); // model -> day -> unitsSum
    const allDays = new Set<string>();

    for (const b of list) {
      if (!b || !b.result || (b.result !== 'win' && b.result !== 'loss' && b.result !== 'push')) continue;
      if (b.type !== currentMode) continue;
      if (!chosen.has(b.model)) continue; // b.model is already an id/name in your data
      const dk = dayKey(b.date);
      allDays.add(dk);
      const m = (perModelPerDay.get(b.model) ?? new Map<string, number>());
      m.set(dk, (m.get(dk) ?? 0) + (typeof b.resultUnits === 'number' ? b.resultUnits : 0));
      perModelPerDay.set(b.model, m);
    }

    const sortedDays = Array.from(allDays).sort((a, b) => a.localeCompare(b));
    const labels = sortedDays.map(pretty);

    // Build datasets: carry forward the last cumulative value on days with no change
    const datasets = Array.from(chosen).map((modelId, idx) => {
      const dayMap = perModelPerDay.get(modelId) ?? new Map<string, number>();
      let cum = 0;
      const values = sortedDays.map(dk => {
        cum += (dayMap.get(dk) ?? 0);
        return cum;
      });
      // Find a nice label for modelId (fallback to id)
      const display = this.data.models.find(m => m.id === modelId)?.name || modelId;
      return {
        label: display,
        data: values,
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2,
        borderColor: SERIES_COLORS[idx % SERIES_COLORS.length]
      };
    }).filter(ds => ds.data.some(v => v !== 0)); // hide empty-flat series

    return {
      type: 'line',
      data: { labels, datasets },
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
