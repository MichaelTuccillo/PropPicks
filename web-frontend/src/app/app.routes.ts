import { Routes } from '@angular/router';

export const routes: Routes = [
  // Landing (not signed in)
  { path: '', loadComponent: () => import('./features/landing/landing.component').then(m => m.LandingComponent) },

  // Demo entry – flips demo on, then redirects to /dashboard
  { path: 'demo', loadComponent: () => import('./features/demo-redirect.component').then(m => m.DemoRedirectComponent) },

  // App pages (you already have these)
  { path: 'dashboard', loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent) },
  { path: 'generate',  loadComponent: () => import('./features/generator/bet-generator.component').then(m => m.BetGeneratorComponent) },

  // Auth pages (optional)
  { path: 'sign-in',  loadComponent: () => import('./features/auth/sign-in.component').then(m => m.SignInComponent) },
  { path: 'sign-up',  loadComponent: () => import('./features/auth/sign-up.component').then(m => m.SignUpComponent) },

  { path: '**', redirectTo: '' }
];
