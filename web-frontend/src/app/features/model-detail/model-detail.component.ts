import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NgFor, NgIf, DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { MockDataService } from '../../shared/mock-data.service';
import { BetRow } from '../../shared/types';
import { toCSV } from '../../shared/csv';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

@Component({
  selector: 'app-model-detail',
  standalone: true,
  imports: [
    NgFor, NgIf, DatePipe, DecimalPipe,
    MatCardModule, MatButtonModule, MatIconModule, MatChipsModule, MatTableModule, NgChartsModule
  ],
  templateUrl: './model-detail.component.html',
  styleUrls: ['./model-detail.component.scss']
})
export class ModelDetailComponent {
  private readonly platformId = inject(PLATFORM_ID);
  readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly route = inject(ActivatedRoute);
  private readonly data  = inject(MockDataService);

  id     = this.route.snapshot.paramMap.get('id')!;
  stats  = this.data.getModelDetailStats(this.id);
  equity = this.data.getModelEquity(this.id);
  log: BetRow[] = this.data.getModelBetLog(this.id, 40);

  chartCfg: ChartConfiguration<'line'> = {
    type: 'line',
    data: {
      labels: this.equity.map(p => p.label),
      datasets: [{
        label: 'Equity (units, last N bets)',
        data: this.equity.map(p => p.value),
        borderColor: '#60a5fa',
        backgroundColor: 'transparent',
        tension: 0.3,
        borderWidth: 2.5,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,.06)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255,255,255,.06)' }, ticks: { color: '#94a3b8' } }
      }
    }
  };

  displayedColumns = ['date','sport','event','betType','combinedOdds','resultUnits'];

  exportCSV() {
    const csv = toCSV(this.log);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${this.id}-betlog.csv`; a.click();
    URL.revokeObjectURL(url);
  }
}
