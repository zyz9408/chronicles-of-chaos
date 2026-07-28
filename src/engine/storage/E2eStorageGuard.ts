export const E2E_STORAGE_MARKER = 'coc-v2-e2e-v1';

export function markDedicatedE2eOrigin(): void {
  if (import.meta.env.MODE !== 'e2e') return;
  document.documentElement.dataset.cocE2eStorage = E2E_STORAGE_MARKER;
}
