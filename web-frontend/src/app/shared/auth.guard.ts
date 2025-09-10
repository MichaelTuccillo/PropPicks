import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { DemoStateService } from './demo-state.service'; // you already have this

export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthed()) return true;
  return router.createUrlTree(['/signin'], { queryParams: { redirect: state.url } });
};
