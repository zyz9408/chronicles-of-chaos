import { describe, expect, it } from 'vitest';
import {
  CLOUD_GLOBAL_LIMIT_BYTES,
  CLOUD_DAILY_UPLOAD_LIMIT,
  CLOUD_SLOT_LIMIT,
  CLOUD_UPLOAD_LIMIT_BYTES,
  CLOUD_USER_LIMIT_BYTES,
  CLOUD_USER_DAILY_UPLOAD_LIMIT,
  getCloudLimits,
  isTrustedMutationRequest,
  signState,
  verifyState,
} from './cloud.js';

describe('cloud free-tier safety contract', () => {
  it('allows operators to lower limits but never raise the hard ceilings', () => {
    expect(getCloudLimits({
      CLOUD_SAVE_GLOBAL_LIMIT_BYTES: '999999999999',
      CLOUD_SAVE_USER_LIMIT_BYTES: '999999999999',
      CLOUD_SAVE_UPLOAD_LIMIT_BYTES: '999999999999',
      CLOUD_SAVE_SLOT_LIMIT: '999999',
    })).toEqual({
      globalBytes: CLOUD_GLOBAL_LIMIT_BYTES,
      userBytes: CLOUD_USER_LIMIT_BYTES,
      uploadBytes: CLOUD_UPLOAD_LIMIT_BYTES,
      slots: CLOUD_SLOT_LIMIT,
      dailyUploads: CLOUD_DAILY_UPLOAD_LIMIT,
      userDailyUploads: CLOUD_USER_DAILY_UPLOAD_LIMIT,
    });
    expect(getCloudLimits({
      CLOUD_SAVE_GLOBAL_LIMIT_BYTES: '7000000000',
      CLOUD_SAVE_USER_LIMIT_BYTES: '40000000',
      CLOUD_SAVE_UPLOAD_LIMIT_BYTES: '8000000',
      CLOUD_SAVE_SLOT_LIMIT: '4',
    })).toEqual({
      globalBytes: 7_000_000_000,
      userBytes: 40_000_000,
      uploadBytes: 8_000_000,
      slots: 4,
      dailyUploads: CLOUD_DAILY_UPLOAD_LIMIT,
      userDailyUploads: CLOUD_USER_DAILY_UPLOAD_LIMIT,
    });
  });

  it('signs OAuth state and refuses tampering', async () => {
    const secret = 'x'.repeat(48);
    const signed = await signState({ nonce: 'abc', issuedAt: 123 }, secret);
    await expect(verifyState(signed, secret)).resolves.toEqual({ nonce: 'abc', issuedAt: 123 });
    await expect(verifyState(`${signed}tampered`, secret)).resolves.toBeNull();
  });

  it('accepts mutations only from the Pages origin or the current same origin', () => {
    expect(isTrustedMutationRequest(new Request('https://cocsg.pages.dev/api/cloud/saves', {
      headers: { origin: 'https://cocsg.pages.dev' },
    }))).toBe(true);
    expect(isTrustedMutationRequest(new Request('https://cocsg.pages.dev/api/cloud/saves', {
      headers: { origin: 'https://evil.example' },
    }))).toBe(false);
  });
});
