import { Routes } from '@angular/router';
import { LandingComponent } from './features/landing/landing.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { BetGeneratorComponent } from './features/generator/bet-generator.component';
import { SignInComponent } from './features/auth/sign-in.component';
import { SignUpComponent } from './features/auth/sign-up.component';
import { authGuard } from './shared/auth.guard';
import { DemoRedirectComponent } from './features/demo-redirect.component';

export const routes: Routes = [
  { path: '', component: LandingComponent },
  { path: 'sign-in', component: SignInComponent },
  { path: 'sign-up', component: SignUpComponent },

  { path: 'demo', component: DemoRedirectComponent },
  
  // protect app pages by (auth OR demo)
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'generate',  component: BetGeneratorComponent, canActivate: [authGuard] },

  { path: '**', redirectTo: '' }
];
