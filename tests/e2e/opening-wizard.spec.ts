import { expect, test } from '@playwright/test';
import { seedMainNarrativeApi } from './e2eStorage';

test('new journey opens the Three Kingdoms setup and keeps historical commanderies visible', async ({ page }) => {
  await seedMainNarrativeApi(page);

  await expect(page.getByText('乱世风云录')).toBeVisible();
  await page.getByRole('button', { name: '新的征程' }).click();

  await expect(page.getByText('乱世开局向导')).toBeVisible();
  await expect(page.getByText('三国演义')).toBeVisible();

  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();

  await expect(page.getByText('初始地点')).toBeVisible();
  for (const commandery of ['颍川郡 郡', '汝南郡 郡', '梁国 国', '沛国 国', '陈国 国', '鲁国 国']) {
    await expect(page.getByRole('button', { name: commandery })).toBeVisible();
  }

  await page.getByRole('button', { name: '+ 自定义地点' }).click();
  await page.getByPlaceholder('地点名称，如：隐谷村、破败坞堡、海边小港').fill('隐谷村');
  await page
    .getByPlaceholder('地点描述，会进入开局 prompt。可写所属乡里、风貌、控制者、为什么适合开局。')
    .fill('颍川山谷中的避乱村落，外人很少知道入口。');
  await page.getByRole('button', { name: '保存地点' }).click();

  await expect(page.getByText('起点：豫州 - 颍川郡 - 隐谷村')).toBeVisible();
});
