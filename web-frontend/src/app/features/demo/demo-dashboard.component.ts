import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { DashboardComponent } from '../dashboard/dashboard.component';

@Component({
  selector: 'app-demo-dashboard',
  standalone: true,
  imports: [MatCardModule, DashboardComponent],
  templateUrl: './demo-dashboard.component.html',
  styleUrls: ['./demo-dashboard.component.scss']
})
export class DemoDashboardComponent {}
