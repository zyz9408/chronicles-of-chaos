import { expect, type Page, test } from '@playwright/test';
import { seedMainNarrativeApi } from './e2eStorage';

const OPENING_API_URL = 'https://example.test/v1/chat/completions';

function getTurnByTitle(page: Page, title: RegExp) {
  const matchingTitle = page.getByTestId('turn-display-title').filter({ hasText: title });
  return page.getByTestId('narrative-turn').filter({ has: matchingTitle });
}

async function expectUniqueTurnTitles(page: Page, expectedTitles: string[]) {
  const titles = page.getByTestId('turn-display-title');
  await expect.poll(() => titles.allTextContents()).toEqual(expectedTitles);
  expect(new Set(await titles.allTextContents()).size).toBe(expectedTitles.length);
}

interface OpeningUiObservation {
  stages: string[];
  cardStates: Array<Array<{ title: string; narrative: string }>>;
}

async function observeOpeningUiTransitions(page: Page) {
  await page.evaluate(() => {
    const observation: OpeningUiObservation = { stages: [], cardStates: [] };
    const recordState = () => {
      const stage = document.querySelector<HTMLElement>('[data-testid="processing-stage-box"]')?.textContent?.trim() ?? '';
      if (stage && observation.stages[observation.stages.length - 1] !== stage) observation.stages.push(stage);

      const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="narrative-turn"]'))
        .map((element) => ({
          title: element.querySelector<HTMLElement>('[data-testid="turn-display-title"]')?.textContent?.trim() ?? '',
          narrative: element.querySelector<HTMLElement>('[data-testid="narrative-text-view"]')?.textContent?.trim() ?? '',
        }));
      const previous = observation.cardStates[observation.cardStates.length - 1];
      if (!previous || JSON.stringify(previous) !== JSON.stringify(cards)) observation.cardStates.push(cards);
    };
    const observer = new MutationObserver(recordState);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    recordState();
    (window as unknown as { __cocOpeningUiObservation: OpeningUiObservation }).__cocOpeningUiObservation = observation;
  });
}

async function getOpeningUiObservation(page: Page) {
  return page.evaluate(() => (
    (window as unknown as { __cocOpeningUiObservation?: OpeningUiObservation }).__cocOpeningUiObservation
      ?? { stages: [], cardStates: [] }
  ));
}

async function installControlledOpeningStream(page: Page) {
  let notifyRequestStarted: (() => void) | undefined;
  const requestStarted = new Promise<void>((resolve) => {
    notifyRequestStarted = resolve;
  });
  let releaseFinalChunk: (() => void) | undefined;
  const finalChunkGate = new Promise<void>((resolve) => {
    releaseFinalChunk = resolve;
  });

  await page.exposeFunction('__cocOpeningRequestStarted', () => notifyRequestStarted?.());
  await page.exposeFunction('__cocWaitForOpeningFinalChunk', () => finalChunkGate);

  const openingResponse = JSON.stringify({
    narrativeText: '真实开场正文，群山雨声渐近。',
    suggestedActions: [],
    statePatches: [
      {
        type: 'timeAdvance',
        payload: { minutesAdvanced: 15 },
        reason: '开场行动经过一刻钟',
      },
    ],
    statePatch: null,
    writeback: {},
  });
  const splitAt = openingResponse.indexOf('，');
  const firstEvent = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: openingResponse.slice(0, splitAt) } }] })}`,
    '',
    '',
  ].join('\n');
  const finalEvents = [
    `data: ${JSON.stringify({
      choices: [{ delta: { content: openingResponse.slice(splitAt) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    })}`,
    '',
    'data: [DONE]',
    '',
    '',
  ].join('\n');

  await page.addInitScript(
    ({ apiUrl, firstChunk, finalChunk }) => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const requestUrl = typeof input === 'string'
          ? input
          : input instanceof Request
            ? input.url
            : input.href;
        if (requestUrl !== apiUrl) return nativeFetch(input, init);

        const hooks = window as unknown as {
          __cocOpeningRequestStarted: () => Promise<void>;
          __cocWaitForOpeningFinalChunk: () => Promise<void>;
        };
        await hooks.__cocOpeningRequestStarted();
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode(firstChunk));
            await hooks.__cocWaitForOpeningFinalChunk();
            controller.enqueue(encoder.encode(finalChunk));
            controller.close();
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };
    },
    { apiUrl: OPENING_API_URL, firstChunk: firstEvent, finalChunk: finalEvents },
  );

  return {
    requestStarted,
    releaseFinalChunk: () => releaseFinalChunk?.(),
  };
}

async function reachConfirmStep(page: Page) {
  await page.getByRole('button', { name: '新的征程' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: /宗室支脉/ }).click();
  await page.getByRole('button', { name: /在野士人/ }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('确认开局设定')).toBeVisible();
}

test('true opening keeps one semantic card through generation, writeback, and save', async ({ page }) => {
  const stream = await installControlledOpeningStream(page);
  await seedMainNarrativeApi(page);

  await reachConfirmStep(page);
  await observeOpeningUiTransitions(page);
  await page.getByRole('button', { name: '踏入乱世' }).click();

  await expect(page.getByRole('main')).toBeVisible({ timeout: 1000 });
  await expect(page.getByText('正在生成开场剧情...', { exact: true })).toBeVisible();

  await stream.requestStarted;
  const processingTurn = getTurnByTitle(page, /^生成中$/);
  const savedOpeningTurn = getTurnByTitle(page, /^开场剧情$/);
  await expect(processingTurn).toHaveCount(1);
  await expect(savedOpeningTurn).toHaveCount(0);
  await expect(processingTurn.getByTestId('narrative-text-view')).toContainText('真实开场正文');
  await expectUniqueTurnTitles(page, ['生成中']);

  stream.releaseFinalChunk();
  await expect(processingTurn).toHaveCount(0);
  await expect(savedOpeningTurn).toHaveCount(1);
  await expect(savedOpeningTurn.getByTestId('narrative-text-view')).toContainText('真实开场正文，群山雨声渐近。');
  await expect(page.locator('.message-box')).toHaveCount(0);
  await expectUniqueTurnTitles(page, ['开场剧情']);
  await expect(savedOpeningTurn.getByText(/03月01日 08:15/)).toBeVisible();

  const openingUiObservation = await getOpeningUiObservation(page);
  expect(openingUiObservation.stages.some((stage) => stage.includes('生成正文'))).toBe(true);
  expect(openingUiObservation.stages.some((stage) => stage.includes('保存开场存档'))).toBe(true);
  expect(openingUiObservation.cardStates.some((cards) => (
    cards.length === 1 && cards[0].title === '生成中' && cards[0].narrative.includes('真实开场正文')
  ))).toBe(true);
  expect(openingUiObservation.cardStates.every((cards) => cards.length <= 1)).toBe(true);
  expect(openingUiObservation.cardStates.some((cards) => (
    cards.length === 1 && cards[0].title === '开场剧情'
  ))).toBe(true);

  await page.getByTestId('diagnostic-export-button').click();
  const diagnosticText = page.getByTestId('diagnostic-export-text');
  await expect(diagnosticText).toContainText('生成正文：started');
  await expect(diagnosticText).toContainText('生成正文：finished');
  await expect(diagnosticText).toContainText('应用状态写回：started');
  await expect(diagnosticText).toContainText('应用状态写回：finished');
  const diagnosticContent = await diagnosticText.textContent() ?? '';
  expect(diagnosticContent.indexOf('生成正文：finished'))
    .toBeLessThan(diagnosticContent.indexOf('应用状态写回：started'));
  expect(diagnosticContent.indexOf('应用状态写回：started'))
    .toBeLessThan(diagnosticContent.indexOf('应用状态写回：finished'));
});
