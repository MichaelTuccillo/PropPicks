import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { NgIf } from '@angular/common';
import { filter } from 'rxjs/operators';

import { ThemeService } from './shared/theme.service'; // optional
import { AuthService } from './shared/auth.service';

// Angular Material
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule }  from '@angular/material/button';
import { MatIconModule }    from '@angular/material/icon';
import { MatMenuModule }    from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';

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

  theme = inject(ThemeService, { optional: true });
  auth = inject(AuthService);

  async ngOnInit() {
    await this.auth.hydrate(); // ask backend if a user cookie exists
  }

  goHome() {
    this.router.navigateByUrl('/');
  }

  async onSignOut() {
    try {
      await this.auth.signOut();
    } finally {
      if (typeof this.goHome === 'function') {
        this.goHome();
      } else if ((this as any).router?.navigateByUrl) {
        (this as any).router.navigateByUrl('/');
      }
    }
  }

}
