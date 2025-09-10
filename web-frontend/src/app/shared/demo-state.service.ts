import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class DemoStateService {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

  private _demo = signal(false);
  demo = this._demo; // expose as readonly signal

  constructor() {
    if (this.isBrowser) this._demo.set(sessionStorage.getItem('demo') === '1');
  }
  
  enter() {
    this._demo.set(true);
    if (this.isBrowser) sessionStorage.setItem('demo', '1');
  }

  exit() {
    this._demo.set(false);
    if (this.isBrowser) sessionStorage.removeItem('demo');
  }
}
