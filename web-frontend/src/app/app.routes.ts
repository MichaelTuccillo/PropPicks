import { Routes } from '@angular/router';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { ModelDetailComponent } from './features/model-detail/model-detail.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent, title: 'Dashboard • Mr. Prop Bot' },
  { path: 'models/:id', component: ModelDetailComponent, title: 'Model • Mr. Prop Bot' },
  { path: '**', redirectTo: '' }
];
