import playwright, {
  Browser,
  BrowserContext,
  BrowserEndpoint,
  Page,
} from '@cloudflare/playwright';
import type { PlaywrightAutomationClient } from './types';

/**
 * Lightweight wrapper around the Cloudflare Playwright binding that exposes
 * the automation capabilities required by the executors in this project.
 */
export class PlaywrightClient implements PlaywrightAutomationClient {
  private browserEndpoint: BrowserEndpoint;
  private browserPromise: Promise<Browser> | null = null;
  private contextPromise: Promise<BrowserContext> | null = null;
  private pagePromise: Promise<Page> | null = null;

  constructor(endpoint: BrowserEndpoint) {
    this.browserEndpoint = endpoint;
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = playwright.launch(this.browserEndpoint, {
        keep_alive: 120_000,
      });
    }
    return this.browserPromise;
  }

  private async getContext(): Promise<BrowserContext> {
    if (!this.contextPromise) {
      this.contextPromise = this.getBrowser().then(browser => browser.newContext());
    }
    return this.contextPromise;
  }

  private async getPage(): Promise<Page> {
    if (!this.pagePromise) {
      this.pagePromise = this.getContext().then(context => context.newPage());
    }
    return this.pagePromise;
  }

  private async runWithPage<T>(action: (page: Page) => Promise<T>): Promise<T> {
    const page = await this.getPage();
    try {
      return await action(page);
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  async navigate(url: string): Promise<void> {
    await this.runWithPage(async page => {
      await page.goto(url, { waitUntil: 'networkidle' });
    });
  }

  async click(selector: string): Promise<void> {
    await this.runWithPage(page => page.click(selector));
  }

  async type(selector: string, text: string): Promise<void> {
    await this.runWithPage(async page => {
      await page.fill(selector, text);
    });
  }

  async selectOption(selector: string, value: string): Promise<void> {
    await this.runWithPage(async page => {
      await page.selectOption(selector, { value });
    });
  }

  async takeScreenshot(): Promise<string> {
    return await this.runWithPage(async page => {
      const screenshot = await page.screenshot({ type: 'png' });
      const bytes = screenshot instanceof Uint8Array
        ? screenshot
        : new Uint8Array(screenshot as ArrayBuffer);
      return PlaywrightClient.bytesToBase64(bytes);
    });
  }

  async snapshot(): Promise<string> {
    return await this.runWithPage(page => page.content());
  }

  async dispose(): Promise<void> {
    const pagePromise = this.pagePromise;
    const contextPromise = this.contextPromise;
    const browserPromise = this.browserPromise;

    this.pagePromise = null;
    this.contextPromise = null;
    this.browserPromise = null;

    if (pagePromise) {
      try {
        const page = await pagePromise;
        await page.close();
      } catch (error) {
        console.error('Failed to close Playwright page', error);
      }
    }

    if (contextPromise) {
      try {
        const context = await contextPromise;
        await context.close();
      } catch (error) {
        console.error('Failed to close Playwright context', error);
      }
    }

    if (browserPromise) {
      try {
        const browser = await browserPromise;
        await browser.close();
      } catch (error) {
        console.error('Failed to close Playwright browser', error);
      }
    }
  }

  private static bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode(...Array.from(chunk));
    }
    return btoa(binary);
  }
}
