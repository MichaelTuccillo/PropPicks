import { Component, computed, inject } from '@angular/core';
import { AsyncPipe, DatePipe, DecimalPipe, NgFor, NgIf } from '@angular/common';
import { isPlatformBrowser } from '@angular/common';
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
import { ModelSummary, Sport } from '../../shared/types';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    NgFor, NgIf, AsyncPipe, DecimalPipe, DatePipe, RouterLink,
    MatButtonToggleModule, MatChipsModule, MatCardModule, MatCheckboxModule, MatTableModule, MatIconModule,
    NgChartsModule
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent {
  private readonly platformId = inject(PLATFORM_ID);
  readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly data = inject(MockDataService);

  sport = this.data.selectedSport;
  mode  = this.data.sgpMode;

  summaries = computed<ModelSummary[]>(() =>
    this.data.getModelSummaries(this.sport(), this.mode())
  );

  recent = this.data.getRecentBets(12);

  lineCfg = computed<ChartConfiguration<'line'>>(() => {
    const chosen = this.summaries().filter(m => m.selected).map(m => m.id);
    const series = this.data.getCumulative(chosen);
    const len = series[0]?.data.length ?? 0;
    const labels = Array.from({ length: len }, (_, i) => `D-${len - i}`);
    return {
      type: 'line',
      data: {
        labels,
        datasets: series.map(s => ({
          label: s.label,
          data: s.data.map(p => p.value),
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 3
        }))
      },
      options: {
        responsive: true,
        elements: { line: { fill: false } },
        plugins: { legend: { position: 'bottom' } },
        scales: {
          x: { grid: { display: false } },
          y: { ticks: { callback: v => `${v}%` } }
        }
      }
    };
  });

  toggleModel(id: string, checked: boolean) {
    const s = this.summaries();
    const idx = s.findIndex(m => m.id === id);
    if (idx >= 0) s[idx].selected = checked;
  }
  setSport(s: Sport) { this.sport.set(s); }
}
