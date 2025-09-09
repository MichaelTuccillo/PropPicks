import { Injectable, inject, signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';

type User = { email: string; name: string };

const KEY = 'auth_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly inBrowser = isPlatformBrowser(this.platformId);

  private _user = signal<User | null>(null);
  user = computed(() => this._user());
  isAuthed = computed(() => !!this._user());

  constructor() {
    if (!this.inBrowser) return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this._user.set(JSON.parse(raw));
    } catch {}
  }

  async signIn(email: string, _password: string) {
    // fake latency
    await new Promise(r => setTimeout(r, 500));
    const user: User = { email, name: email.split('@')[0] || 'User' };
    this.setUser(user);
  }

  async signUp(name: string, email: string, _password: string) {
    await new Promise(r => setTimeout(r, 700));
    this.setUser({ name, email });
  }

  signOut() {
    this._user.set(null);
    if (!this.inBrowser) return;
    try { localStorage.removeItem(KEY); } catch {}
  }

  private setUser(u: User) {
    this._user.set(u);
    if (!this.inBrowser) return;
    try { localStorage.setItem(KEY, JSON.stringify(u)); } catch {}
  }
}
