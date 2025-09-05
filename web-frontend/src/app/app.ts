import { Component, inject } from '@angular/core';
import { AsyncPipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UsersService } from './services/users';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AsyncPipe, JsonPipe, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.scss']
})
export class App {
  private users = inject(UsersService);

  email = '';
  users$ = this.users.list();

  create() {
    this.users.create(this.email).subscribe(() => {
      this.email = '';
      this.users$ = this.users.list();  // refresh
    });
  }
}
