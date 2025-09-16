import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../shared/auth.service'


@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss']
})
export class LandingComponent {
  loading = false;

  constructor(private auth: AuthService, private router: Router) {}

  onTryDemo() {
    this.loading = true;
    this.auth.tryDemo().subscribe({
      next: () => this.router.navigateByUrl('/dashboard'),
      error: err => { console.error(err); this.loading = false; },
      complete: () => { this.loading = false; }
    });
  }
}
