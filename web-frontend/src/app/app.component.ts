import { Component, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AsyncPipe, JsonPipe } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AsyncPipe, JsonPipe],
  template: `
    <h1>Angular + Go</h1>
    <pre>{{ hello$ | async | json }}</pre>
  `
})
export class AppComponent {
  private http = inject(HttpClient);
  hello$ = this.http.get<{message:string}>('/api/hello'); // see proxy below
}
