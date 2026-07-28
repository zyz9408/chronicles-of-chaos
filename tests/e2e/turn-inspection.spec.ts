import { expect, type Page, test } from '@playwright/test';
import { installSuccessfulTurnApi, seedMainNarrativeApi } from './e2eStorage';

function getTurnByTitle(page: Page, title: RegExp) {
  const matchingTitle = page.getByTestId('turn-display-title').filter({ hasText: title });
  return page.getByTestId('narrative-turn').filter({ has: matchingTitle });
}

async function expectUniqueTurnTitles(page: Page, expectedTitles: string[]) {
  const titles = page.getByTestId('turn-display-title');
  let observedTitles: string[] = [];
  await expect.poll(async () => {
    observedTitles = await titles.allTextContents();
    const titleCounts = await Promise.all(expectedTitles.map((title) => (
      getTurnByTitle(page, new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)).count()
    )));
    return { titles: observedTitles, titleCounts };
  }).toEqual({ titles: expectedTitles, titleCounts: expectedTitles.map(() => 1) });
  expect(new Set(observedTitles).size).toBe(expectedTitles.length);
}

interface ObservedNarrativeCard {
  title: string;
  action: string;
  narrative: string;
}

type ObservedNarrativeCardState = ObservedNarrativeCard[];

interface ObservedTurnUiTransitions {
  stages: string[];
  cardStates: ObservedNarrativeCardState[];
}

async function observeNarrativeCardStates(page: Page) {
  await page.evaluate(() => {
    const observation: ObservedTurnUiTransitions = { stages: [], cardStates: [] };
    const recordState = () => {
      const stage = document.querySelector<HTMLElement>('[data-testid="processing-stage-box"]')?.textContent?.trim() ?? '';
      if (stage && observation.stages[observation.stages.length - 1] !== stage) observation.stages.push(stage);

      const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="narrative-turn"]'))
        .map((element) => ({
          title: element.querySelector<HTMLElement>('[data-testid="turn-display-title"]')?.textContent?.trim() ?? '',
          action: element.querySelector<HTMLElement>('[data-testid="player-action-bubble"]')?.textContent?.trim() ?? '',
          narrative: element.querySelector<HTMLElement>('[data-testid="narrative-text-view"]')?.textContent?.trim() ?? '',
        }));
      const previous = observation.cardStates[observation.cardStates.length - 1];
      if (!previous || JSON.stringify(previous) !== JSON.stringify(cards)) observation.cardStates.push(cards);
    };
    const observer = new MutationObserver(recordState);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    recordState();
    (window as unknown as { __cocObservedTurnUiTransitions: ObservedTurnUiTransitions })
      .__cocObservedTurnUiTransitions = observation;
  });
}

async function getObservedTurnUiTransitions(page: Page) {
  return page.evaluate(() => (
    (window as unknown as { __cocObservedTurnUiTransitions?: ObservedTurnUiTransitions })
      .__cocObservedTurnUiTransitions ?? { stages: [], cardStates: [] }
  ));
}

function expectAtMostOneCardPerSemanticTurn(observedStates: ObservedNarrativeCardState[]) {
  for (const cards of observedStates) {
    const semanticKeys = cards.map((card) => (
      card.action ? `action:${card.action}` : `narrative:${card.narrative}`
    ));
    expect(semanticKeys, `duplicate semantic turn in state: ${JSON.stringify(cards)}`)
      .toEqual([...new Set(semanticKeys)]);
  }
}

async function enterDebugGame(page: Page) {
  await installSuccessfulTurnApi(page);
  await seedMainNarrativeApi(page);
  await page.getByRole('button', { name: '新的征程' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: /宗室支脉/ }).click();
  await page.getByRole('button', { name: /在野士人/ }).click();
  await page.evaluate(() => (window as unknown as { __cocDebugStart: () => Promise<void> }).__cocDebugStart());
  await expect(page.getByRole('main')).toBeVisible();
}

test('turn header keeps reasoning, raw response, and token stats behind the inspection menu', async ({ page }) => {
  await enterDebugGame(page);
  await observeNarrativeCardStates(page);

  await page.getByPlaceholder('输入你的行动').fill('去市集打听消息');
  await page.getByRole('button', { name: '执行行动' }).click();

  const savedTurn = getTurnByTitle(page, /^第 1 回合$/);
  const processingTurn = getTurnByTitle(page, /^生成中$/);

  await expect(processingTurn).toHaveCount(0);
  await expect(savedTurn).toHaveCount(1);
  await expect(page.locator('.message-box')).toHaveCount(0);
  const observedTransitions = await getObservedTurnUiTransitions(page);
  expect(observedTransitions.stages.some((stage) => stage.includes('保存回合与快照'))).toBe(true);
  expect(observedTransitions.cardStates.some((cards) => cards.some((card) => card.title === '生成中'))).toBe(true);
  expectAtMostOneCardPerSemanticTurn(observedTransitions.cardStates);
  await expectUniqueTurnTitles(page, ['第 1 回合']);
  await expect(savedTurn.getByTestId('turn-display-stats')).toBeHidden();
  await savedTurn.getByTestId('turn-inspection-menu').locator('summary').click();
  await expect(savedTurn.getByTestId('turn-display-stats')).toContainText(/入\s+[\d,]+/);
  await expect(savedTurn.getByTestId('turn-display-stats')).toContainText(/出\s+\d+/);

  await savedTurn.getByTestId('turn-reasoning-button').click();
  await expect(page.getByTestId('turn-reasoning-content')).toContainText('公开');
  await page.getByRole('button', { name: '关闭' }).click();

  await savedTurn.getByTestId('turn-raw-button').click();
  await expect(page.getByTestId('turn-raw-content')).toContainText('narrativeText');
  await page.getByRole('button', { name: '关闭' }).click();

  await savedTurn.getByTestId('turn-edit-button').click();
  await page.getByTestId('turn-edit-textarea').fill('这是手动修订后的本回合正文。');
  await page.getByRole('button', { name: '保存正文' }).click();
  await expect(savedTurn.getByTestId('narrative-text-view')).toContainText('手动修订后的本回合正文');
  await expect(savedTurn).toHaveCount(1);
  await expectUniqueTurnTitles(page, ['第 1 回合']);
});

test('topbar preserves the original narrative diagnostic export entry', async ({ page }) => {
  await enterDebugGame(page);

  await page.getByPlaceholder('输入你的行动').fill('去市集打听消息');
  await page.getByRole('button', { name: '执行行动' }).click();

  const savedTurn = getTurnByTitle(page, /^第 1 回合$/);
  const processingTurn = getTurnByTitle(page, /^生成中$/);
  await expect(processingTurn).toHaveCount(0);
  await expect(savedTurn).toHaveCount(1);
  await expect(page.locator('.message-box')).toHaveCount(0);
  await expectUniqueTurnTitles(page, ['第 1 回合']);

  await page.getByTestId('diagnostic-export-button').click();
  await expect(page.getByTestId('diagnostic-export-panel')).toBeVisible();
  await expect(page.getByTestId('diagnostic-export-text')).toContainText('乱世风云录诊断导出');
  await expect(page.getByTestId('diagnostic-export-text')).toContainText('玩家输入：去市集打听消息');
  await expect(page.getByTestId('diagnostic-export-text')).toContainText('正文：');
  await expect(page.getByTestId('diagnostic-export-text')).not.toContainText('原文：');
  await expect(page.getByTestId('diagnostic-export-text')).toContainText('生成信息：');
});
