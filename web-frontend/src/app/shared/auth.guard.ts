import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { DemoStateService } from './demo-state.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const demo = inject(DemoStateService);
  const router = inject(Router);

  // Allow if the user is signed in OR currently in demo mode
  if (auth.isAuthed() || demo.demo()) {
    return true;
  }

  // NOTE: route is /sign-in (not /signin)
  return router.createUrlTree(['/sign-in'], { queryParams: { redirect: state.url } });
};
