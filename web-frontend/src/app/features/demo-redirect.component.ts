import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DemoStateService } from '../shared/demo-state.service';

@Component({
  standalone: true,
  template: `<div class="page"><p>Loading demo…</p></div>`
})
export class DemoRedirectComponent {
  private router = inject(Router);
  private demo = inject(DemoStateService);

  constructor() {
    this.demo.enter();
    this.router.navigateByUrl('/dashboard', { replaceUrl: true });
  }
}
