export const AVG_VISUAL_READ_TIMEOUT_MS = 8_000;

/** A stalled browser database/file read must never hold the narrative UI open. */
export async function readAvgVisualWithDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(
    () => controller.abort(new Error('AVG 图片读取超时，请重试。')),
    options.timeoutMs ?? AVG_VISUAL_READ_TIMEOUT_MS,
  );
  let rejectOnAbort: (() => void) | undefined;
  try {
    controller.signal.throwIfAborted();
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return read(controller.signal);
      }),
      new Promise<never>((_resolve, reject) => {
        rejectOnAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    if (rejectOnAbort) controller.signal.removeEventListener('abort', rejectOnAbort);
  }
}
