import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, errors, type Browser, type BrowserContext, type Page } from 'playwright';
import type { DirectoryConfig } from './config.ts';
import {
  bundleDirOf,
  createWorkDir,
  ensureBundleDir,
  insideGitRepository,
  readState,
  RETENTION_DAYS,
  workDirOf,
  writeManifestText,
  writeState,
  type Missing,
  type Portrait,
  type State,
} from './staging.ts';

export { cleanup, WORK_DIR_NAME, type CleanupResult } from './staging.ts';

export type CollectOptions = {
  stagingDir: string;
  config: DirectoryConfig;
  mode: 'new' | 'resume';
  browser: { headless: boolean };
  /** CLI: print the message and wait for Enter. */
  waitForSignIn: (message: string) => Promise<void>;
  /** CLI: stdout. Receives counts and fixed text only. */
  log: (line: string) => void;
  /** Cancellation (CLI: Ctrl-C). */
  signal?: AbortSignal;
  /** Clock for the resume retention check. */
  now?: () => Date;
  /** Test hook: every URL the browser context or the collector requests. */
  onRequest?: (url: string) => void;
};

export type CollectResult = {
  status: 'done' | 'cancelled' | 'unsupported_layout' | 'refused' | 'failed';
  exitCode: 0 | 1 | 2;
  message: string;
};

export const MESSAGES = {
  signIn: 'Sign in to the directory in the browser window that opened, then press Enter here.',
  expired: 'Sign-in expired. Sign in again in the browser window, then press Enter here.',
  git: 'Choose a staging folder outside any Git repository.',
  existing:
    'A previous collection exists in this folder. Run again with --resume to continue it or --cleanup to delete it.',
  noResume: 'There is no collection to resume in this folder.',
  unreadable: 'The saved collection could not be read. Run again with --cleanup to delete it.',
  old: `This collection is more than ${String(RETENTION_DAYS)} days old. Run again with --cleanup to delete it.`,
  otherLayout: 'This collection used a different directory layout. Run again with --cleanup to delete it.',
  cancelled: 'Collection cancelled. Run again with --resume to continue or --cleanup to delete what was collected.',
  pageFailed: 'Page did not load',
  imageFailed: 'Image request failed',
  collectionFailed:
    'Collection failed. Run again with --resume to continue or --cleanup to delete what was collected.',
} as const;

const unsupportedLayout = (version: string): string =>
  `Unsupported directory layout (expected ${version}). Nothing was imported.`;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DAY_MS = 24 * 60 * 60 * 1000;

class Cancelled extends Error {}
class LayoutMismatch extends Error {}

/** The image extension when `bytes` is an acceptable portrait, otherwise `undefined`. */
export function portraitExtension(bytes: Uint8Array): 'jpg' | 'png' | undefined {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return undefined;
  const startsWith = (signature: number[]): boolean => signature.every((b, i) => bytes[i] === b);
  if (startsWith(JPEG)) return 'jpg';
  if (startsWith(PNG)) return 'png';
  return undefined;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The bundle manifest: sorted, deterministic, and free of anything but names, files and one count. */
export function manifestText(layoutVersion: string, state: State): string {
  const nameCounts = new Map<string, number>();
  for (const p of state.portraits) nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
  const portraits = [...state.portraits]
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || byText(a.file, b.file))
    .map((p) => ({ name: p.name, file: p.file, duplicateName: (nameCounts.get(p.name) ?? 0) > 1 }));
  const missing = [...state.missing]
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || byText(a.reason, b.reason))
    .map((m) => ({ name: m.name, reason: m.reason }));
  const manifest = {
    format: 'wardboard-photo-bundle',
    version: 1,
    layoutVersion,
    portraits,
    missing,
    skippedHousehold: state.skippedHousehold,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function progressLine(done: number, total: number, state: State): string {
  return (
    `Households ${String(done)} of ${String(total)} · portraits ${String(state.portraits.length)} · ` +
    `missing ${String(state.missing.length)} · failed ${String(state.failed)} · ` +
    `household images skipped ${String(state.skippedHousehold)}`
  );
}

type HouseholdResult = { portraits: Portrait[]; missing: Missing[]; skipped: number; failed: number };

/**
 * Collects individual portraits from the signed-in directory into
 * `<stagingDir>/wardboard-collector/bundle/`. The user's session stays inside
 * the browser context: the collector only navigates and fetches through it.
 */
export async function collect(options: CollectOptions): Promise<CollectResult> {
  const { config, log, signal } = options;
  const now = options.now ?? (() => new Date());
  const workDir = workDirOf(options.stagingDir);
  const bundleDir = bundleDirOf(workDir);

  const finish = (result: CollectResult): CollectResult => {
    log(result.message);
    return result;
  };
  const refuse = (message: string): CollectResult => finish({ status: 'refused', exitCode: 2, message });

  if (insideGitRepository(options.stagingDir)) return refuse(MESSAGES.git);

  let state: State | undefined;
  if (options.mode === 'new') {
    if (existsSync(workDir)) return refuse(MESSAGES.existing);
  } else {
    if (!existsSync(workDir)) return refuse(MESSAGES.noResume);
    state = await readState(workDir);
    if (state === undefined) return refuse(MESSAGES.unreadable);
    if (state.layoutVersion !== config.layoutVersion) return refuse(MESSAGES.otherLayout);
    if (now().getTime() - Date.parse(state.startedAt) > RETENTION_DAYS * DAY_MS) return refuse(MESSAGES.old);
  }

  const cancelled = (): CollectResult => finish({ status: 'cancelled', exitCode: 1, message: MESSAGES.cancelled });
  const aborted = (): boolean => signal?.aborted === true;
  if (aborted()) return cancelled();

  /** Rejects with `Cancelled` as soon as the signal aborts; the original promise is still observed. */
  const abortable = <T>(promise: Promise<T>): Promise<T> => {
    promise.catch(() => undefined);
    if (signal === undefined) return promise;
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        reject(new Cancelled());
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error instanceof Error ? error : new Error('failed'));
        },
      );
    });
  };
  const checkAbort = (): void => {
    if (aborted()) throw new Cancelled();
  };

  let browser: Browser | undefined;
  try {
    // Ctrl-C is handled by the caller's signal, so the browser is closed here, after state is saved.
    browser = await chromium.launch({ headless: options.browser.headless, handleSIGINT: false });
    checkAbort();
    const context = await browser.newContext();
    context.on('request', (request) => options.onRequest?.(request.url()));
    const page = await context.newPage();
    page.setDefaultTimeout(config.timeouts.elementMs);
    page.setDefaultNavigationTimeout(config.timeouts.navigationMs);

    await abortable(page.goto(config.startUrl));
    await abortable(options.waitForSignIn(MESSAGES.signIn));

    const { selectors } = config;
    /** Waits for `target` or the signed-out marker; `undefined` when neither appears in time. */
    const waitForPage = async (target: string): Promise<'found' | 'signedOut' | undefined> => {
      try {
        await abortable(page.locator(`${target}, ${selectors.signedOut}`).first().waitFor({ state: 'attached' }));
      } catch (error) {
        if (error instanceof errors.TimeoutError) return undefined;
        throw error;
      }
      return (await page.locator(selectors.signedOut).count()) > 0 ? 'signedOut' : 'found';
    };
    const reSignIn = async (): Promise<void> => {
      await abortable(options.waitForSignIn(MESSAGES.expired));
    };

    // The household list must be present after sign-in; otherwise this is not a layout we know.
    let listState = await waitForPage(selectors.householdList);
    while (listState === 'signedOut') {
      await reSignIn();
      listState = await waitForPage(selectors.householdList);
    }
    if (listState === undefined) throw new LayoutMismatch();
    const listUrl = page.url();
    const total = await page.locator(selectors.householdLink).count();
    if (total === 0) throw new LayoutMismatch();

    if (state === undefined) {
      await createWorkDir(workDir);
      state = {
        layoutVersion: config.layoutVersion,
        startedAt: now().toISOString(),
        completedHouseholds: [],
        portraits: [],
        missing: [],
        skippedHousehold: 0,
        failed: 0,
        createdFiles: [],
      };
      await writeState(workDir, state);
    } else {
      await ensureBundleDir(workDir);
    }
    const current: State = state;

    // From here on the page never loads images itself: the only image bytes
    // fetched are the portraits requested below, and household images never.
    await context.route('**/*', (route) => {
      const handled = route.request().resourceType() === 'image' ? route.abort() : route.continue();
      handled.catch(() => undefined);
    });

    const savePortrait = async (bytes: Buffer, extension: 'jpg' | 'png'): Promise<string> => {
      const file = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
      const relative = `bundle/${file}`;
      if (!current.createdFiles.includes(relative)) {
        // Record before writing, so cleanup can always find what was written.
        current.createdFiles.push(relative);
        await writeState(workDir, current);
      }
      if (!existsSync(join(bundleDir, file))) await writeFile(join(bundleDir, file), bytes, { mode: 0o600 });
      return file;
    };

    const fetchPortrait = async (
      context: BrowserContext,
      url: string,
    ): Promise<{ bytes: Buffer; extension: 'jpg' | 'png' } | undefined> => {
      for (let attempt = 0; attempt <= config.retries.image; attempt += 1) {
        checkAbort();
        options.onRequest?.(url);
        try {
          const response = await abortable(
            context.request.get(url, { timeout: config.timeouts.navigationMs, failOnStatusCode: false }),
          );
          const bytes = response.ok() ? await response.body() : undefined;
          await response.dispose();
          const extension = bytes === undefined ? undefined : portraitExtension(bytes);
          if (bytes !== undefined && extension !== undefined) return { bytes, extension };
        } catch (error) {
          if (error instanceof Cancelled) throw error;
        }
      }
      return undefined;
    };

    const collectMembers = async (page: Page): Promise<HouseholdResult> => {
      const result: HouseholdResult = { portraits: [], missing: [], skipped: 0, failed: 0 };
      result.skipped = await page.locator(selectors.householdImage).count();
      const entries = page.locator(selectors.memberEntry);
      const count = await entries.count();
      for (let index = 0; index < count; index += 1) {
        checkAbort();
        const entry = entries.nth(index);
        const nameElement = entry.locator(selectors.memberName).first();
        if ((await nameElement.count()) === 0) throw new LayoutMismatch();
        const name = ((await nameElement.textContent()) ?? '').replace(/\s+/g, ' ').trim();
        if (name === '') throw new LayoutMismatch();

        // A household image is never a portrait, even if a portrait selector also matches it.
        const portrait = entry.locator(selectors.memberPortrait).first();
        const isPortrait =
          (await portrait.count()) > 0 &&
          !(await portrait.evaluate(
            (element, householdImage) => element.matches(householdImage),
            selectors.householdImage,
          ));
        if (!isPortrait) {
          result.missing.push({ name, reason: 'none' });
          continue;
        }
        const src = await portrait.getAttribute('src');
        let url: URL | undefined;
        try {
          url = src === null || src.trim() === '' ? undefined : new URL(src, page.url());
        } catch {
          url = undefined;
        }
        const fetched =
          url !== undefined && (url.protocol === 'https:' || url.protocol === 'http:')
            ? await fetchPortrait(context, url.href)
            : undefined;
        if (fetched === undefined) {
          log(MESSAGES.imageFailed);
          result.failed += 1;
          result.missing.push({ name, reason: 'failed' });
          continue;
        }
        result.portraits.push({ name, file: await savePortrait(fetched.bytes, fetched.extension) });
      }
      return result;
    };

    /** Opens household `index` from the list and collects it, starting over after a re-sign-in. */
    const collectHousehold = async (index: number): Promise<HouseholdResult> => {
      for (;;) {
        checkAbort();
        await abortable(page.goto(listUrl));
        const list = await waitForPage(selectors.householdList);
        if (list === 'signedOut') {
          await reSignIn();
          continue;
        }
        if (list === undefined) throw new LayoutMismatch();
        const links = page.locator(selectors.householdLink);
        if ((await links.count()) <= index) throw new LayoutMismatch();
        await abortable(links.nth(index).click());
        const household = await waitForPage(selectors.householdName);
        if (household === 'signedOut') {
          await reSignIn();
          continue;
        }
        if (household === undefined) throw new LayoutMismatch();
        return collectMembers(page);
      }
    };

    for (let index = 0; index < total; index += 1) {
      if (current.completedHouseholds.includes(index)) continue;
      checkAbort();
      const result = await collectHousehold(index);
      current.portraits.push(...result.portraits);
      current.missing.push(...result.missing);
      current.skippedHousehold += result.skipped;
      current.failed += result.failed;
      current.completedHouseholds = [...current.completedHouseholds, index].sort((a, b) => a - b);
      await writeState(workDir, current);
      log(progressLine(current.completedHouseholds.length, total, current));
    }

    await writeManifestText(workDir, manifestText(config.layoutVersion, current));
    return finish({
      status: 'done',
      exitCode: 0,
      message:
        `Done. ${String(current.portraits.length)} portraits, ${String(current.missing.length)} missing, ` +
        `${String(current.failed)} failed, ${String(current.skippedHousehold)} household images skipped. ` +
        `Bundle: ${bundleDir}`,
    });
  } catch (error) {
    if (state !== undefined && existsSync(workDir)) await writeState(workDir, state).catch(() => undefined);
    if (error instanceof Cancelled || aborted()) return cancelled();
    if (error instanceof LayoutMismatch) {
      return finish({ status: 'unsupported_layout', exitCode: 1, message: unsupportedLayout(config.layoutVersion) });
    }
    // Playwright messages can carry URLs or page text: report fixed lines only.
    log(MESSAGES.pageFailed);
    return finish({ status: 'failed', exitCode: 1, message: MESSAGES.collectionFailed });
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
