import { Injectable, signal, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';

const KEY = 'prefers-dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly inBrowser = isPlatformBrowser(this.platformId);

  isDark = signal(false);

  constructor() {
    if (!this.inBrowser) return; // <-- SSR: do nothing

    const saved = safeGet(KEY);
    const prefers =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    this.isDark.set(saved != null ? saved === 'true' : !!prefers);
    this.apply();
  }

  toggle() {
    this.isDark.update(v => !v);
    if (!this.inBrowser) return; // SSR guard
    safeSet(KEY, String(this.isDark()));
    this.apply();
  }

  private apply() {
    if (!this.inBrowser) return; // SSR guard
    document.body.classList.toggle('dark', this.isDark());
  }
}

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch {}
}
