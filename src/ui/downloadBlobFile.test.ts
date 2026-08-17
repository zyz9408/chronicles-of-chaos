import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyUint8ArrayToArrayBuffer, downloadBlobFile } from './downloadBlobFile';

describe('downloadBlobFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('copies only the selected bytes into an independent ArrayBuffer', () => {
    const source = new Uint8Array([9, 1, 2, 3, 9]);
    const view = source.subarray(1, 4);
    const copied = copyUint8ArrayToArrayBuffer(view);

    source[2] = 8;

    expect(Array.from(new Uint8Array(copied))).toEqual([1, 2, 3]);
  });

  it('mounts the download link and delays revoking its Blob URL', () => {
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:portable-save');
    const revokeObjectURL = vi.fn();
    let revokeCallback: (() => void) | undefined;
    const setTimeout = vi.fn((callback: () => void, delay: number) => {
      revokeCallback = callback;
      expect(delay).toBe(1_000);
      return 1;
    });
    const link = {
      click,
      download: '',
      href: '',
      remove,
      style: { display: '' },
    };

    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.stubGlobal('document', {
      body: { appendChild },
      createElement: vi.fn(() => link),
    });
    vi.stubGlobal('window', { setTimeout });

    const blob = new Blob(['portable-save']);
    downloadBlobFile('save.zip', blob);

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link).toMatchObject({
      download: 'save.zip',
      href: 'blob:portable-save',
      style: { display: 'none' },
    });
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    revokeCallback?.();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:portable-save');
  });
});
