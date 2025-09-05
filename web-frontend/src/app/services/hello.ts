// src/app/services/hello.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class HelloService {
  private http = inject(HttpClient);
  getHello() {
    return this.http.get<{ message: string }>('/api/hello');
  }
}
