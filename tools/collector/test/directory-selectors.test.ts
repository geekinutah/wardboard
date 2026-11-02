import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

const SHIPPED = fileURLToPath(new URL('../config/directory.json', import.meta.url));

const PAGE = `<!doctype html>
  <h1>Fictional Household</h1>
  <a href="/9/households/10">Fictional Household</a>
  <a href="/9/households/10/move">Move</a>
  <header><img src="/api/v1/photos/households/10" alt=""></header>
  <section>
    <div>
      <div><img src="/api/v1/photos/members/1" alt=""></div>
      <div><a href="/9/members/1"><span><span>Ada Fictional</span></span></a></div>
    </div>
    <div>
      <div><img src="/api/v1/photos/members/2" alt=""></div>
      <div><a href="/9/members/2"><span><span>Bea Sample</span></span></a></div>
    </div>
  </section>`;

describe('shipped directory selectors', () => {
  it('reads member portraits from the directory map shape and skips the household photo', async () => {
    const config = await loadConfig(SHIPPED);
    expect(config.layoutVersion).toBe('directory-v2');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(PAGE);
      const { selectors } = config;

      expect(await page.locator(selectors.householdList).count()).toBeGreaterThan(0);
      expect(await page.locator(selectors.householdLink).count()).toBe(1);
      expect(await page.locator(selectors.householdName).textContent()).toBe('Fictional Household');
      expect(await page.locator(selectors.householdImage).count()).toBe(1);

      const entries = page.locator(selectors.memberEntry);
      expect(await entries.count()).toBe(2);
      const names: string[] = [];
      const portraits: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        const entry = entries.nth(index);
        names.push(((await entry.locator(selectors.memberName).first().textContent()) ?? '').replace(/\s+/g, ' ').trim());
        const src = await entry.locator(selectors.memberPortrait).first().getAttribute('src');
        portraits.push(src ?? '');
        expect(await entry.locator(selectors.householdImage).count()).toBe(0);
      }
      expect(names).toEqual(['Ada Fictional', 'Bea Sample']);
      expect(portraits).toEqual(['/api/v1/photos/members/1', '/api/v1/photos/members/2']);
    } finally {
      await browser.close();
    }
  });
});
