export function extractErrorMessage(err: any): string {
  if (!err) return 'Something went wrong. Please try again.';

  // Angular HttpErrorResponse shapes
  const e = err.error ?? err;

  if (typeof e === 'string') return e;
  if (typeof e?.error === 'string') return e.error;         // { error: "..." }
  if (typeof e?.message === 'string') return e.message;     // { message: "..." }

  if (typeof err?.message === 'string') return err.message; // HttpErrorResponse.message

  try {
    return JSON.stringify(e);
  } catch {
    return 'Request failed. Please try again.';
  }
}
