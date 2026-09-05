import { expect, test, type Page } from '@playwright/test';
import { assertE2eStorageIsolation, E2E_DATABASE_NAME, E2E_DATABASE_VERSION, seedMainNarrativeApi } from './e2eStorage';

const firstNarrative = '你在城门前冷静观察，门候暂时未再追问。';
const nextNarrative = '你避开盘查继续观察周遭，本回合正常保存。';

async function startRecoveryGame(page: Page) {
  await seedMainNarrativeApi(page);
  await assertE2eStorageIsolation(page);
  await page.evaluate(async ({ name, version }) => {
    localStorage.setItem('coc_v2_narrative_presentation', 'avg');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(name, version);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('meta', 'readwrite');
      transaction.objectStore('meta').put({ key: 'apiFeatureExecutionModes', value: {
        revision: 1, stateWriteback: 'bundledMain', npcCompletion: 'bundledMain',
        npcSimulation: 'bundledMain', worldEvolution: 'bundledMain', memorySummary: 'bundledMain',
      } });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, { name: E2E_DATABASE_NAME, version: E2E_DATABASE_VERSION });
  await page.getByRole('button', { name: '新的征程' }).click();
  for (let step = 0; step < 4; step += 1) await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: /宗室支脉/ }).click();
  await page.getByRole('button', { name: /在野士人/ }).click();
  await page.evaluate(() => (window as unknown as { __cocDebugStart: () => Promise<void> }).__cocDebugStart());
  await expect(page.locator('.game-frame')).toBeVisible();
  let calls = 0;
  await page.route('https://example.test/v1/chat/completions', async (route) => {
    calls += 1;
    const content = JSON.stringify({
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: calls === 1 ? firstNarrative : nextNarrative,
      suggestedActions: [],
      statePatches: [
        { type: 'timeAdvance', payload: { minutesAdvanced: 15, reason: '观察', category: 'waiting' }, reason: '观察耗时' },
        ...(calls === 1 ? [{ type: 'resourceChanged', payload: { resource: 'supplyCredit', mode: 'delta', change: -2, newValue: 8 }, reason: '测试隔离矛盾状态字段' }] : []),
      ],
      bundledFeatures: { protocolVersion: 'coc.v2.bundledMain.v1' },
    });
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n` });
  });
  await page.locator('.input-row textarea').fill('冷硬对峙，观察门候');
  await page.getByRole('button', { name: '执行行动' }).click();
  await expect(page.getByTestId('avg-stage-dialogue')).toContainText(firstNarrative, { timeout: 15_000 });
  await expect(page.getByTestId('state-writeback-recovery-prepare')).toBeEnabled();
  await expect(page.getByText('回合：1', { exact: true })).toBeVisible();
  return () => calls;
}

async function reloadGame(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: '兵戈再起' }).click();
  await page.getByRole('button', { name: '读取最近存档' }).click();
  await expect(page.locator('.game-frame')).toBeVisible();
}

async function readCurrentState(page: Page) {
  return page.evaluate(async ({ name, version }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(name, version);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const state = await new Promise<any>((resolve, reject) => {
      const transaction = database.transaction(['meta', 'saves']);
      const last = transaction.objectStore('meta').get('lastSaveId');
      last.onsuccess = () => {
        const save = transaction.objectStore('saves').get(last.result.value);
        save.onsuccess = () => resolve(save.result.runtimeState);
        save.onerror = () => reject(save.error);
      };
      last.onerror = () => reject(last.error);
    });
    database.close();
    return state;
  }, { name: E2E_DATABASE_NAME, version: E2E_DATABASE_VERSION });
}

test('quarantined state survives AVG and save/load; the next normal turn commits without old evidence errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests = await startRecoveryGame(page);
  await reloadGame(page);
  await expect(page.getByTestId('state-writeback-recovery-prepare')).toBeEnabled();
  await expect(page.getByTestId('avg-stage-dialogue')).toContainText(firstNarrative);
  await page.locator('.input-row textarea').fill('避开盘查观察周遭');
  await page.getByRole('button', { name: '执行行动' }).click();
  await expect(page.getByTestId('avg-stage-dialogue')).toContainText(nextNarrative, { timeout: 15_000 });
  await expect(page.getByText('回合：2', { exact: true })).toBeVisible();
  await expect(page.getByTestId('state-writeback-recovery-notice')).toHaveCount(0);
  await reloadGame(page);
  await expect(page.getByTestId('avg-stage-dialogue')).toContainText(nextNarrative);
  await expect(page.getByText('回合：2', { exact: true })).toBeVisible();
  expect(requests()).toBe(2);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'output/playwright/recovery-next-turn.png', fullPage: true });
});

test('a v2 save made stale only by AVG is safely upgraded on load without replaying any state patch', async ({ page }) => {
  await startRecoveryGame(page);
  await page.reload();
  await assertE2eStorageIsolation(page);
  const result = await page.evaluate(async ({ name, version }) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { createStateWritebackRecoveryCapsule, inspectStateWritebackRecovery, upgradeLegacyStateWritebackRecovery } = await load('/src/engine/state/StateWritebackRecovery.ts');
    const { materializeAvgPresentation } = await load('/src/engine/avg/AvgPresentationMaterializer.ts');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(name, version);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const saves = await new Promise<any[]>((resolve, reject) => {
      const read = database.transaction('saves').objectStore('saves').getAll();
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    const diagnostics: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('saves', 'readwrite');
      for (const save of saves) {
        const state = save.runtimeState;
        const capsule = state.stateWritebackRecovery;
        if (!capsule) continue;
        const turn = state.turnLog[state.turnLog.length - 1];
        const before = JSON.parse(capsule.preTurnStateJson);
        state.avgPresentation = { ...state.avgPresentation };
        delete state.avgPresentation.visualPartitionId;
        delete state.avgPresentation.portraitBindings;
        if (!Object.keys(state.avgPresentation).length) delete state.avgPresentation;
        delete turn.avgVisualSnapshot;
        if (turn.avgPresentation) delete turn.avgPresentation.sceneBinding;
        state.stateWritebackRecovery = createStateWritebackRecoveryCapsule({
          schemaVersion: 2, preTurnState: before, postTurnState: state,
          frozenNarrativeText: capsule.frozenNarrativeText, initialPatches: capsule.initialPatches,
          initialWritebackJson: capsule.initialWritebackJson, rejectedCandidates: capsule.rejectedCandidates,
          quarantinedPatchIndexes: capsule.quarantinedPatchIndexes,
        });
        save.runtimeState = materializeAvgPresentation(state, { saveId: save.id, turnNumber: turn.turnNumber, playerPortraitMode: 'hidden' }).state;
        const verification = { verifySemanticEvidence: () => true };
        const upgraded = upgradeLegacyStateWritebackRecovery(save.runtimeState, verification);
        diagnostics.push({ before: inspectStateWritebackRecovery(save.runtimeState, verification).status, upgraded: upgraded.stateWritebackRecovery?.schemaVersion, after: inspectStateWritebackRecovery(upgraded, verification).status, preVisual: before.avgPresentation, sourceVisual: state.avgPresentation });
        transaction.objectStore('saves').put(save);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    return { seeded: saves.some((save) => save.runtimeState.stateWritebackRecovery?.schemaVersion === 2), diagnostics };
  }, { name: E2E_DATABASE_NAME, version: E2E_DATABASE_VERSION });
  expect(result.seeded).toBe(true);
  expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ before: 'stale_lineage', upgraded: 3, after: 'ready' })]));
  await page.getByRole('button', { name: '兵戈再起' }).click();
  await page.getByRole('button', { name: '读取最近存档' }).click();
  await expect(page.getByTestId('state-writeback-recovery-prepare')).toBeEnabled();
  await expect(page.getByTestId('avg-stage-dialogue')).toContainText(firstNarrative);
  await expect(page.getByText('回合：1', { exact: true })).toBeVisible();
});

test('repair preview applies once, preserves the frozen turn, and survives reload', async ({ page }) => {
  await startRecoveryGame(page);
  await reloadGame(page);
  const before = await readCurrentState(page);
  const patches = structuredClone(before.stateWritebackRecovery.initialPatches);
  const slot = before.stateWritebackRecovery.quarantinedPatchIndexes[0];
  expect(patches[slot].type).toBe('resourceChanged');
  patches[slot] = { type: 'resourceChanged', payload: { resource: 'supplyCredit', mode: 'absolute', newValue: 8 }, reason: '修复矛盾字段' };
  let repairs = 0;
  await page.route('https://example.test/v1/chat/completions', async (route) => {
    repairs += 1;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      choices: [{ message: { role: 'assistant', content: JSON.stringify({ statePatches: patches }) } }],
    }) });
  });
  await page.getByTestId('state-writeback-recovery-prepare').click();
  await expect(page.getByTestId('state-writeback-recovery-preview')).toBeVisible();
  expect((await readCurrentState(page)).playerResources).toEqual(before.playerResources);
  await page.getByTestId('state-writeback-recovery-apply').click();
  await expect(page.getByTestId('state-writeback-recovery-preview')).toHaveCount(0);
  const after = await readCurrentState(page);
  expect(after.stateWritebackRecovery.status).toBe('applied');
  expect(after.playerResources.supplyCredit).toBe(8);
  expect(after.currentDate).toEqual(before.currentDate);
  expect(after.currentTime).toEqual(before.currentTime);
  expect(after.currentLocationId).toEqual(before.currentLocationId);
  expect(after.turnLog).toEqual(before.turnLog);
  await reloadGame(page);
  await expect(page.getByTestId('state-writeback-recovery-prepare')).toHaveCount(0);
  await expect(page.getByTestId('avg-stage-dialogue')).toContainText(firstNarrative);
  expect(repairs).toBe(1);
});
