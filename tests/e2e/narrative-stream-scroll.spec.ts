import { expect, type Locator, type Page, test } from '@playwright/test';
import { seedMainNarrativeApi } from './e2eStorage';

const MAIN_API_URL = 'https://example.test/v1/chat/completions';

function encodeJsonStringContent(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function makeNarrativeSegment(label: string): string {
  const lines = Array.from({ length: 24 }, (_, index) => `${label}内容第${index + 1}行，军帐内外的细节持续展开。`);
  return `${lines.join('\n')}\n${label}末尾。\n`;
}

async function installControlledNarrativeStream(page: Page) {
  let notifyRequestStarted: (() => void) | undefined;
  const requestStarted = new Promise<void>((resolve) => {
    notifyRequestStarted = resolve;
  });
  const gates = Array.from({ length: 5 }, () => {
    let release: (() => void) | undefined;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release: () => release?.() };
  });

  await page.exposeFunction('__cocNarrativeStreamRequestStarted', () => notifyRequestStarted?.());
  await page.exposeFunction('__cocWaitForNarrativeStreamChunk', (index: number) => gates[index - 1].promise);

  const segments = ['第一段', '第二段', '第三段', '第四段', '第五段', '第六段'].map(makeNarrativeSegment);
  const responseStart = '{"protocolVersion":"lsfy.turn.v1","narrativeText":"';
  const responseEnd = '","suggestedActions":[],"statePatches":[{"type":"timeAdvance","payload":{"minutesAdvanced":15,"reason":"流式滚动回归","category":"test"},"reason":"流式滚动回归"}],"statePatch":null,"writeback":{}}';
  const fragments = segments.map((segment, index) => (
    `${index === 0 ? responseStart : ''}${encodeJsonStringContent(segment)}${index === segments.length - 1 ? responseEnd : ''}`
  ));
  const events = fragments.map((fragment, index) => [
    `data: ${JSON.stringify({
      choices: [{ delta: { content: fragment } }],
      ...(index === fragments.length - 1
        ? { usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 } }
        : {}),
    })}`,
    '',
    ...(index === fragments.length - 1 ? ['data: [DONE]', ''] : []),
    '',
  ].join('\n'));

  await page.addInitScript(
    ({ apiUrl, streamEvents }) => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const requestUrl = typeof input === 'string'
          ? input
          : input instanceof Request
            ? input.url
            : input.href;
        if (requestUrl !== apiUrl) return nativeFetch(input, init);

        const hooks = window as unknown as {
          __cocNarrativeStreamRequestStarted: () => Promise<void>;
          __cocWaitForNarrativeStreamChunk: (index: number) => Promise<void>;
        };
        await hooks.__cocNarrativeStreamRequestStarted();
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode(streamEvents[0]));
            for (let index = 1; index < streamEvents.length; index += 1) {
              await hooks.__cocWaitForNarrativeStreamChunk(index);
              controller.enqueue(encoder.encode(streamEvents[index]));
            }
            controller.close();
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };
    },
    { apiUrl: MAIN_API_URL, streamEvents: events },
  );

  return {
    requestStarted,
    releaseChunk: (index: number) => gates[index - 1].release(),
  };
}

async function enterDebugGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: '新的征程' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: /宗室支脉/ }).click();
  await page.getByRole('button', { name: /在野士人/ }).click();
  await page.evaluate(() => (window as unknown as { __cocDebugStart: () => Promise<void> }).__cocDebugStart());
  await expect(page.locator('.game-frame')).toBeVisible();
}

async function readScrollMetrics(scroll: Locator) {
  return scroll.evaluate((element) => {
    const htmlElement = element as HTMLElement;
    return {
      scrollTop: htmlElement.scrollTop,
      scrollHeight: htmlElement.scrollHeight,
      clientHeight: htmlElement.clientHeight,
      distanceFromBottom: htmlElement.scrollHeight - htmlElement.clientHeight - htmlElement.scrollTop,
    };
  });
}

async function setDistanceFromBottom(scroll: Locator, distance: number) {
  await scroll.evaluate((element, requestedDistance) => {
    const htmlElement = element as HTMLElement;
    htmlElement.scrollTop = Math.max(0, htmlElement.scrollHeight - htmlElement.clientHeight - requestedDistance);
    htmlElement.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, distance);
}

test('streaming follows only while near bottom and resumes after the user returns', async ({ page }) => {
  const stream = await installControlledNarrativeStream(page);
  await seedMainNarrativeApi(page);
  await enterDebugGame(page);

  await page.locator('.input-row textarea').fill('执行流式滚动回归行动');
  await page.getByRole('button', { name: '执行行动' }).click();
  await stream.requestStarted;

  const scroll = page.getByTestId('narrative-scroll');
  const narrative = page.getByTestId('narrative-text-view').last();
  await expect(narrative).toContainText('第一段末尾');
  await expect.poll(async () => (await readScrollMetrics(scroll)).distanceFromBottom).toBeLessThanOrEqual(1);

  stream.releaseChunk(1);
  await expect(narrative).toContainText('第二段末尾');
  await expect.poll(async () => (await readScrollMetrics(scroll)).distanceFromBottom).toBeLessThanOrEqual(1);

  await setDistanceFromBottom(scroll, 220);
  const scrolledUp = await readScrollMetrics(scroll);
  expect(scrolledUp.distanceFromBottom).toBeGreaterThan(48);

  stream.releaseChunk(2);
  await expect(narrative).toContainText('第三段末尾');
  await expect.poll(async () => Math.abs((await readScrollMetrics(scroll)).scrollTop - scrolledUp.scrollTop)).toBeLessThanOrEqual(1);

  stream.releaseChunk(3);
  await expect(narrative).toContainText('第四段末尾');
  await expect.poll(async () => Math.abs((await readScrollMetrics(scroll)).scrollTop - scrolledUp.scrollTop)).toBeLessThanOrEqual(1);

  await setDistanceFromBottom(scroll, 24);
  expect((await readScrollMetrics(scroll)).distanceFromBottom).toBeLessThanOrEqual(48);
  stream.releaseChunk(4);
  await expect(narrative).toContainText('第五段末尾');
  await expect.poll(async () => (await readScrollMetrics(scroll)).distanceFromBottom).toBeLessThanOrEqual(1);

  await setDistanceFromBottom(scroll, 220);
  expect((await readScrollMetrics(scroll)).distanceFromBottom).toBeGreaterThan(48);
  stream.releaseChunk(5);
  await expect(page.getByTestId('narrative-text-view').last()).toContainText('第六段末尾');
  await expect(page.getByTestId('turn-display-title').filter({ hasText: /^第 1 回合$/ })).toHaveCount(1);
  await expect(page.locator('.message-box')).toHaveCount(0);
  await expect.poll(async () => (await readScrollMetrics(scroll)).distanceFromBottom).toBeGreaterThan(48);
});
