import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { NgIf } from '@angular/common';
import { filter } from 'rxjs/operators';

import { DemoStateService } from './shared/demo-state.service';
import { ThemeService } from './shared/theme.service'; // optional

// Angular Material
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule }  from '@angular/material/button';
import { MatIconModule }    from '@angular/material/icon';
import { MatMenuModule }    from '@angular/material/menu';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive, NgIf,
    MatToolbarModule, MatButtonModule, MatIconModule, MatMenuModule
  ],
  templateUrl: './app.html',
})
export class AppComponent {
  private router  = inject(Router);
  private demoSvc = inject(DemoStateService);

  demo = this.demoSvc.demo;           // signal for template
  theme = inject(ThemeService, { optional: true });

  constructor() {
    // When user returns to landing, turn demo OFF automatically
    this.router.events.pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => {
        if (this.router.url === '/' && this.demo()) {
          this.demoSvc.exit();
        }
      });
  }

  signOutDemo() {
    this.demoSvc.exit();
    this.router.navigateByUrl('/');
  }

  goHome() {
    this.router.navigateByUrl('/');
  }
}
