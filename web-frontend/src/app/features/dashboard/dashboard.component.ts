import { Component, computed, inject, signal } from '@angular/core';
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
import { ModelSummary, Sport } from '../../shared/types';

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
  // Services (make MockDataService public so template can read data.sports)
  public data = inject(MockDataService);
  private demoSvc = inject(DemoStateService);

  // Demo banner
  demo = this.demoSvc.demo;

  // SSR guard so <canvas baseChart> is never created on the server
  isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // Filters
  sport = signal<Sport>('MLB');
  mode  = signal<'Single' | 'SGP' | 'SGP+'>('SGP');

  // Model cards (fake summaries)
  summaries = computed<ModelSummary[]>(() =>
    this.data.getModelSummaries(this.sport(), this.mode())
  );

  // Selected model ids for the chart
  selectedIds = signal<Set<string>>(new Set(
    this.data.models.filter(m => m.selected).map(m => m.id)
  ));

  // Chart config recomputed when selectedIds changes
  lineCfg = computed<ChartConfiguration<'line'>>(() => {
    const chosen = Array.from(this.selectedIds());
    const series = this.data.getCumulative(chosen); // [{label, data:[{label,value}]}]

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

  // Recent bets table (demo data)
  recent = this.data.getRecentBets(12);
  displayedColumns = ['date', 'model', 'sport', 'event', 'type', 'odds', 'result'];

  // UI handlers
  setSport(s: Sport) { this.sport.set(s); }
  setMode(m: 'SGP' | 'SGP+') { this.mode.set(m); }

  toggleModel(id: string, checked: boolean) {
    this.selectedIds.update(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }

  trackModel = (_: number, m: any) => m.id as string;
}
