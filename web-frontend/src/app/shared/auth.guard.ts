import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // On hard refresh, make sure the cookie/session is loaded before we decide.
  try {
    await auth.hydrate(); // idempotent-safe; returns fast if already hydrated
  } catch {
    /* ignore */
  }

  // Allow if the user is signed in OR currently in demo mode
  if (auth.isAuthed()) {
    return true;
  }

  // NOTE: route is /sign-in (not /signin)
  return router.createUrlTree(['/sign-in'], { queryParams: { redirect: state.url } });
};
