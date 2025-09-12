import { Component, computed, inject, signal, DestroyRef } from '@angular/core';
import { NgFor, NgIf, DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
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
  all_roi: number;
};

const SERIES_COLORS = ['#60a5fa','#22c55e','#eab308','#2dd4bf','#94a3b8','#f87171','#fb923c'];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    NgFor, NgIf, DatePipe, DecimalPipe, RouterLink,
    MatButtonToggleModule, MatChipsModule, MatCardModule, MatCheckboxModule, MatTableModule, MatIconModule,
    NgChartsModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent {
  public data = inject(MockDataService);
  private demoSvc = inject(DemoStateService);
  private statsApi = inject(StatsService);
  private pastApi = inject(PastBetsService);

  isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  demo = this.demoSvc.demo;

  sport = signal<Sport>('MLB');
  mode  = signal<'Single' | 'SGP' | 'SGP+'>('SGP');

  private stats = signal<StatRow[] | null>(null);
  private bets  = signal<PastBet[] | null>(null);

  summaries = computed<CardVM[]>(() => {
    const rows = this.stats() ?? [];
    const currentSport = this.sport();
    const keySport = String(currentSport).toUpperCase() === 'ALL' ? 'ALL' : currentSport;

    const byKey = new Map<string, StatRow>();
    for (const r of rows) byKey.set(`${r.model.toLowerCase()}|${r.sport}`, r);

    return this.data.models.map(m => {
      const row = byKey.get(`${m.id.toLowerCase()}|${keySport}`) ??
                  byKey.get(`${m.id.toLowerCase()}|ALL`);
      const wins   = row?.wins ?? 0;
      const losses = row?.losses ?? 0;
      const roi    = row?.roiPct ?? 0;
      return { id: m.id, name: m.name, all_wl: `${wins}–${losses}`, all_roi: roi };
    });
  });

  selectedIds = signal<Set<string>>(new Set(
    this.data.models.filter(m => m.selected).map(m => m.id)
  ));

  lineCfg = computed<ChartConfiguration<'line'>>(() => {
    const chosen = Array.from(this.selectedIds());
    const series = this.data.getCumulative(chosen);
    const labels = series.length ? series[0].data.map(p => p.label) : [];
    return {
      type: 'line',
      data: {
        labels,
        datasets: series.map((s, i) => ({
          label: s.label,
          data: s.data.map(p => p.value),
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
          borderColor: SERIES_COLORS[i % SERIES_COLORS.length]
        }))
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
  setMode(m: 'Single' | 'SGP' | 'SGP+') { this.mode.set(m); }

  toggleModel(id: string, checked: boolean) {
    this.selectedIds.update(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }

  trackModel = (_: number, m: any) => m.id as string;

  private destroyRef = inject(DestroyRef);

  async ngOnInit() {
    if (!this.isBrowser) return;
    this.statsApi.fetch()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: rows => this.stats.set(rows) });

    this.reloadBets();
  }

  private reloadBets() {
    this.pastApi.list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: rows => this.bets.set(rows) });
  }

  private grading = new Set<string>();
  grade(row: RecentRow, outcome: ''|'win'|'loss'|'push') {
    if (this.grading.has(row.id)) return;
    this.grading.add(row.id);
    this.pastApi.setResult(row.id, outcome).subscribe({
      next: () => this.reloadBets(),
      complete: () => this.grading.delete(row.id),
      error: () => this.grading.delete(row.id),
    });
  }

}
