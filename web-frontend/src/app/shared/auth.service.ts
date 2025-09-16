import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Subject, Observable, of, firstValueFrom } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment.prod';

export type User = { id: string; email: string; displayName: string };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private base = `${environment.apiBase}/auth`;

  private _user$ = new BehaviorSubject<User | null>(null);
  private _logout$ = new Subject<void>(); // emits once when a sign-out starts

  user$ = this._user$.asObservable();
  user(): User | null { return this._user$.value; }
  isAuthed(): boolean { return !!this._user$.value; }

  /** Emits once at the moment sign-out begins; services use it to cancel HTTP */
  get logout$(): Observable<void> { return this._logout$.asObservable(); }

  async hydrate(): Promise<void> {
    const u = await firstValueFrom(
      this.http.get<User>(`${this.base}/me`, { withCredentials: true })
        .pipe(catchError(() => of(null as unknown as User)))
    );
    this._user$.next(u);
  }

  private signIn$(payload: { email: string; password: string }) {
    return this.http.post<User>(`${this.base}/sign-in`, payload, { withCredentials: true })
      .pipe(tap(u => this._user$.next(u)));
  }

  private register$(payload: { email: string; password: string; displayName: string }) {
    return this.http.post<User>(`${this.base}/register`, payload, { withCredentials: true })
      .pipe(tap(u => this._user$.next(u)));
  }

  /** Promise-style APIs (compat) */
  async signIn(email: string, password: string): Promise<User> {
    return await firstValueFrom(this.signIn$({ email, password }));
  }
  async signUp(email: string, displayName: string, password: string): Promise<User> {
    return await firstValueFrom(this.register$({ email, password, displayName }));
  }

  // auth.service.ts
  tryDemo() {
    return this.http.post(
      `${this.base}/demo`,
      {},
      { withCredentials: true }
    );
  }


  /**
   * Sign out QUICKLY:
   * - immediately clears local user
   * - emits logout$ (cancels pending HTTP in other services)
   * - fires server sign-out in background (non-blocking)
   * - resolves right away so you can navigate immediately
   */
  async signOut(): Promise<{ ok: boolean }> {
    this._user$.next(null);
    this._logout$.next(); // cancel in-flight requests elsewhere

    // Fire-and-forget the network call; don't await it
    this.http.post<{ ok: boolean }>(`${this.base}/sign-out`, {}, { withCredentials: true })
      .pipe(catchError(() => of({ ok: true })))
      .subscribe();

    return { ok: true };
  }
}
