// Hand-off for files dropped on a proof page's camera strip. File objects
// can't ride a URL, but a client-side router.push keeps the JS context alive,
// so a module-level slot is enough: the proof page sets it, navigates home,
// and the home page takes it on mount and starts the normal drop flow.
let pending: File[] | null = null;

export function setPendingDrop(files: File[]) {
  pending = files;
}

export function takePendingDrop(): File[] | null {
  const p = pending;
  pending = null;
  return p;
}
