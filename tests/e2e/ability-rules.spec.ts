import { expect, test, type Page } from '@playwright/test';
import { seedMainNarrativeApi, assertE2eStorageIsolation } from './e2eStorage';

async function readState(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/engine/save/SaveManager.ts';
    const { continueLastSave } = await import(/* @vite-ignore */ path);
    return (await continueLastSave())!.runtimeState;
  });
}

test('new custom traits require a visible executable numeric contract', async ({ page }) => {
  await seedMainNarrativeApi(page);
  await page.getByRole('button', { name: '新的征程' }).click();
  for (let step = 0; step < 3; step++) await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '+ 自定义特质', exact: true }).click();
  await page.getByPlaceholder('特质名称，如：善辨形势').fill('规则测试');
  const description = page.getByPlaceholder(/写出明确数值规则/);
  await description.fill('掌握尚未支持的宇宙机制。');
  await expect(page.getByRole('button', { name: '保存特质', exact: true })).toBeDisabled();
  await description.fill('每小时生命恢复满；伤害×2');
  await expect(page.getByRole('status')).toContainText('每累计 60 游戏分钟生命恢复至上限');
  await expect(page.getByRole('status')).toContainText('伤害倍率 ×2');
  await expect(page.getByRole('button', { name: '保存特质', exact: true })).toBeEnabled();
});

test('old hourly-heal trait restores actual saved HP across split turns and reloads', async ({ page }) => {
  await seedMainNarrativeApi(page);
  await page.getByRole('button', { name: '新的征程' }).click();
  for (let step = 0; step < 4; step++) await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: /宗室支脉/ }).click();
  await page.getByRole('button', { name: /在野士人/ }).click();
  await page.evaluate(() => (window as unknown as { __cocDebugStart: () => Promise<void> }).__cocDebugStart());
  await expect(page.locator('.game-frame')).toBeVisible();
  await assertE2eStorageIsolation(page);
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { continueLastSave, saveCurrentState } = await load('/src/engine/save/SaveManager.ts');
    const { setApiFeatureExecutionModeAsync } = await load('/src/engine/settings/ApiConfigManager.ts');
    const saved = await continueLastSave();
    const state = saved.runtimeState;
    state.player.vitals = { hp: 60, maxHp: 100, stamina: 98, maxStamina: 100 };
    state.player.traits = [{ id: 'old_fast_heal', label: '快速自愈', description: '当生命值不满时，每小时自动恢复满。', source: 'custom' }];
    state.player.uniqueArts = [];
    state.worldStateDelta.trueOpeningGenerated = true;
    await saveCurrentState(saved.id, state);
    for (const feature of ['stateWriteback', 'npcCompletion', 'npcSimulation', 'worldEvolution', 'memorySummary']) await setApiFeatureExecutionModeAsync(feature, 'bundledMain');
  });
  await page.reload();
  await page.getByRole('button', { name: '兵戈再起' }).click();
  await page.getByRole('button', { name: '读取最近存档' }).click();
  await expect(page.locator('.game-frame')).toBeVisible();
  await page.route('https://example.test/v1/chat/completions', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ protocolVersion: 'lsfy.turn.v1', narrativeText: '【旁白】静静等待片刻。实际回血由本地规则结算。', suggestedActions: [], statePatches: [{ type: 'timeAdvance', payload: { minutesAdvanced: 15, reason: '等待', category: 'waiting' }, reason: '等待' }], bundledFeatures: { protocolVersion: 'coc.v2.bundledMain.v1' } }) } }] }) }));
  for (let turn = 1; turn <= 4; turn++) {
    await page.locator('.input-row textarea').fill('等待十五分钟');
    await page.getByRole('button', { name: '执行行动' }).click();
    await expect(page.getByText(`回合：${turn}`, { exact: true })).toBeVisible({ timeout: 15000 });
    expect((await readState(page)).player.vitals!.hp).toBe(turn < 4 ? 60 : 100);
    if (turn === 2) {
      await page.reload(); await page.getByRole('button', { name: '兵戈再起' }).click(); await page.getByRole('button', { name: '读取最近存档' }).click();
    }
  }
  const settled = await readState(page);
  expect(settled.abilityRuleExecutions?.some((entry: { sourceAbilityName: string; after?: { hp: number } }) => entry.sourceAbilityName === '快速自愈' && entry.after?.hp === 100)).toBe(true);
  await page.getByRole('button', { name: '绝艺', exact: true }).click();
  await page.getByTestId('ability-rules-panel').locator('summary').click();
  await expect(page.getByTestId('ability-rules-panel')).toContainText('每累计 60 游戏分钟生命恢复至上限');
  await page.getByLabel('执行规则模板').selectOption('damage');
  await page.getByLabel('规则数值').fill('2');
  await page.getByRole('button', { name: '确认绑定数值规则' }).click();
  await expect(page.getByTestId('ability-rules-panel')).toContainText('伤害倍率 ×2');
  await page.screenshot({ path: 'output/playwright/ability-rules-panel.png', fullPage: true });
});
