import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators, AbstractControl } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIf } from '@angular/common';

import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { AuthService } from '../../shared/auth.service';
import { extractErrorMessage } from '../../shared/error.util';

@Component({
  selector: 'app-sign-up',
  standalone: true,
  imports: [
    ReactiveFormsModule, RouterLink, NgIf,
    MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule
  ],
  templateUrl: './sign-up.component.html',
  styleUrls: ['./sign-up.component.scss']
})
export class SignUpComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  hide = signal(true);
  loading = signal(false);
  error = signal<string | null>(null);

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    displayName: ['', [Validators.required, Validators.minLength(2)]],
    // keep minLength(6) so form validity blocks submit,
    // but we won’t show a red error for it while typing.
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  // Handy getters for template
  get emailCtrl() { return this.form.controls.email; }
  get displayCtrl() { return this.form.controls.displayName; }
  get passwordCtrl() { return this.form.controls.password; }

  touched(ctrl: AbstractControl) { return ctrl.dirty || ctrl.touched; }

  async submit() {
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);

    try {
      const { email, displayName, password } = this.form.getRawValue();
      await this.auth.signUp(email, displayName, password);
      await this.router.navigateByUrl('/dashboard');
    } catch (e: any) {
      this.error.set(extractErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
