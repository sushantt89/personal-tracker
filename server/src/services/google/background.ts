/** Fire-and-forget jobs (Google sync) that must never slow down or fail the user's request. */
const pending = new Set<Promise<unknown>>();

export function background(task: () => Promise<unknown>) {
  const p: Promise<unknown> = task()
    .catch((e) => console.error('[background]', e))
    .finally(() => pending.delete(p));
  pending.add(p);
}

/** Wait for all queued background work (used by tests). */
export async function flushBackground() {
  while (pending.size) await Promise.allSettled([...pending]);
}
