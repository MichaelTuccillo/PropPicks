import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class UsersService {
  private http = inject(HttpClient);

  list() {
    return this.http.get<any[]>('/api/users');
  }
  create(email: string) {
    return this.http.post('/api/users', { email });
  }
}
