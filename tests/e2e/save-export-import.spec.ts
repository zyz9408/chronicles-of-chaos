import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

test('downloaded save ZIP is complete and can be imported again', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });

  const changelogCloseButton = page.getByRole('button', { name: '关闭更新日志' });
  if (await changelogCloseButton.isVisible()) await changelogCloseButton.click();

  await page.getByRole('button', { name: '兵戈再起' }).click();
  const saveDialog = page.getByRole('dialog', { name: '读取存档' });
  await expect(saveDialog).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await saveDialog.getByRole('button', { name: '导出存档' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();

  const zipBytes = new Uint8Array(await readFile(downloadPath!));
  expect(Array.from(zipBytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  const entries = unzipSync(zipBytes);
  const manifest = JSON.parse(strFromU8(entries['manifest.json']));
  expect(manifest).toMatchObject({
    format: 'chronicles-of-chaos-v2-save-archive',
    version: 1,
    schema: 'coc.v2.saves',
  });

  const fileChooserPromise = page.waitForEvent('filechooser');
  await saveDialog.getByRole('button', { name: '导入存档' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(downloadPath!);

  await expect(saveDialog).toContainText('存档已导入并合并（支持 ZIP 与旧版 JSON）。');
});
