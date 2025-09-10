import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment.development';
import { firstValueFrom } from 'rxjs';

export type User = {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  user = signal<User | null>(null);

  private base = `${environment.apiBase}/auth`; // e.g. '/api/auth' with proxy

  async hydrate(): Promise<void> {
    try {
      const me = await firstValueFrom(this.http.get<User>(`${this.base}/me`, { withCredentials: true }));
      this.user.set(me || null);
    } catch {
      this.user.set(null);
    }
  }

  async signIn(email: string, password: string): Promise<User> {
    const u = await firstValueFrom(
      this.http.post<User>(`${this.base}/sign-in`, { email, password }, { withCredentials: true })
    );
    this.user.set(u);
    return u!;
  }

  async signUp(email: string, displayName: string, password: string): Promise<User> {
    const u = await firstValueFrom(this.http.post<User>(
      `${this.base}/sign-up`,
      { email, password, display_name: displayName },
      { withCredentials: true }
    ));
    this.user.set(u);
    return u!;
  }

  async signOut(): Promise<void> {
    await firstValueFrom(this.http.post(`${this.base}/sign-out`, {}, { withCredentials: true }));
    this.user.set(null);
  }

  isAuthed(): boolean {
    return !!this.user();
  }
}
