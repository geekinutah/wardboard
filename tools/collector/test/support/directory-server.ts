import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { jpeg, png } from './images.ts';

/**
 * A fictional church directory served on an ephemeral 127.0.0.1 port. Every
 * name, image and value here is invented. Each page also carries canary
 * personal data and a canary session cookie that the collector must never let
 * out of the browser.
 */

export const SESSION_COOKIE = 'wb_session';
export const SESSION_VALUE = 'CANARY-SESSION-7f3a91';

/** Every string that must never appear in staging, logs or the manifest. */
export const CANARIES = [
  SESSION_VALUE,
  SESSION_COOKIE,
  'CANARY-ADDR-1 Fictional Lane',
  'CANARY-PHONE-555-0100',
  'canary-email@example.invalid',
  'CANARY-DOB-2001-01-01',
  'CANARY-MRN-0001',
  'CANARY-MRN-0002',
  'CANARY-TOKEN-x9',
  'CANARY-SRC',
  'CANARY-',
  'canary-email@',
] as const;

export type Member = { name: string; photo?: string };
export type Household = { name: string; image?: string; members: Member[] };

export const HOUSEHOLDS: readonly Household[] = [
  {
    name: 'Fictional Household Alpha',
    members: [
      { name: 'Ada Fictional', photo: 'ada.png' },
      { name: 'Dee Imaginary', photo: 'dee.jpg' },
    ],
  },
  {
    name: 'Fictional Household Beta',
    image: 'household-beta.png',
    members: [{ name: 'Eli Madeup', photo: 'eli.png' }],
  },
  {
    name: 'Fictional Household Gamma',
    members: [
      { name: 'Ben Example' },
      { name: 'Fay Failing', photo: 'fay.png' },
      { name: 'Gus Flaky', photo: 'gus.jpg' },
    ],
  },
  {
    name: 'Fictional Household Delta',
    members: [
      { name: 'Cal Sample', photo: 'cal-delta.png' },
      { name: 'Hal Twin', photo: 'hal.png' },
    ],
  },
  {
    name: 'Fictional Household Epsilon',
    image: 'household-epsilon.png',
    members: [
      { name: 'Cal Sample', photo: 'cal-epsilon.png' },
      { name: 'Ivy Twin', photo: 'ivy.png' },
    ],
  },
];

const twin = png(7);

/** Bytes for every image path. `fay.png` always fails; `gus.jpg` fails once. */
export const IMAGES: Readonly<Record<string, Buffer>> = {
  'ada.png': png(1),
  'dee.jpg': jpeg(2),
  'eli.png': png(3),
  'fay.png': png(4),
  'gus.jpg': jpeg(5),
  'cal-delta.png': png(6),
  'cal-epsilon.png': png(8),
  'hal.png': twin,
  'ivy.png': twin,
  'household-beta.png': png(101),
  'household-epsilon.png': png(102),
};

export const ALWAYS_FAILING = 'fay.png';
export const FAILS_ONCE = 'gus.jpg';

/** Every fixture name a collector could leak into its logs. */
export const FIXTURE_NAMES: readonly string[] = [
  ...HOUSEHOLDS.map((h) => h.name),
  ...HOUSEHOLDS.flatMap((h) => h.members.map((m) => m.name)),
];

export const HOUSEHOLD_IMAGE_COUNT = HOUSEHOLDS.filter((h) => h.image !== undefined).length;

export type RecordedRequest = { path: string; session: boolean; status: number };

export type DirectoryServer = {
  origin: string;
  startUrl: string;
  /** Every request the server received, in order. */
  requests: RecordedRequest[];
  /** Number of requests for `/photos/<file>`. */
  photoRequests: (file: string) => number;
  /** The next page load shows the signed-out element (once). */
  expireNextPage: () => void;
  close: () => Promise<void>;
};

const CANARY_BLOCK = `
  <aside class="contact">
    <p class="address">CANARY-ADDR-1 Fictional Lane</p>
    <p class="phone">CANARY-PHONE-555-0100</p>
    <a class="email" href="mailto:canary-email@example.invalid">canary-email@example.invalid</a>
    <p class="birth">CANARY-DOB-2001-01-01</p>
    <a class="record" href="/member/CANARY-MRN-0001">Record</a>
    <input type="hidden" name="token" value="CANARY-TOKEN-x9">
  </aside>`;

function page(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fictional directory</title></head><body>${body}${CANARY_BLOCK}</body></html>`;
}

function householdList(households: readonly Household[]): string {
  const items = households.map(
    (h, index) =>
      `<li class="household-row" data-record="CANARY-MRN-0002"><a class="household-link" href="/households/${String(index)}">${h.name}</a> <span>CANARY-PHONE-555-0100</span></li>`,
  ).join('\n');
  return page(`<h1>Directory</h1><ul class="household-list">${items}</ul>`);
}

function householdPage(household: Household): string {
  const image =
    household.image === undefined ? '' : `<img class="household-photo" alt="" src="/photos/${household.image}?ref=CANARY-SRC-H">`;
  const members = household.members
    .map((m) => {
      const portrait =
        m.photo === undefined ? '' : `<img class="member-portrait" alt="" src="/photos/${m.photo}?ref=CANARY-SRC-M">`;
      // Odd whitespace in the name proves it is trimmed and collapsed.
      const spaced = m.name.replace(' ', ' \n   ');
      return `<li class="member" data-record="CANARY-MRN-0002">${portrait}<span class="member-name">  ${spaced} </span>
        <a href="/member/CANARY-MRN-0001">Profile</a> <span class="birth">CANARY-DOB-2001-01-01</span>
        <span class="email">canary-email@example.invalid</span></li>`;
    })
    .join('\n');
  return page(`<h2 class="household-name">${household.name}</h2>${image}<ul class="members">${members}</ul>`);
}

const SIGNED_OUT = page('<div class="signed-out">Your session has ended. Sign in again.</div>');

/** A response the server sends for `/photos/<file>` in place of a fixture image. */
export type PhotoResponse = { type: string; body: Buffer };

export type DirectoryServerOptions = {
  /** Households to serve instead of `HOUSEHOLDS`. */
  households?: readonly Household[];
  /** Extra `/photos/<file>` responses, served with status 200. */
  photos?: Readonly<Record<string, PhotoResponse>>;
};

export async function startDirectoryServer(options: DirectoryServerOptions = {}): Promise<DirectoryServer> {
  const households = options.households ?? HOUSEHOLDS;
  const extraPhotos = options.photos ?? {};
  const requests: RecordedRequest[] = [];
  const photoCounts = new Map<string, number>();
  let expireNext = false;

  function send(res: ServerResponse, req: IncomingMessage, status: number, type: string, body: string | Buffer): void {
    const path = req.url ?? '';
    requests.push({ path, session: hasSession(req), status });
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  }

  function hasSession(req: IncomingMessage): boolean {
    const cookie = req.headers.cookie ?? '';
    return cookie.split(';').some((part) => part.trim() === `${SESSION_COOKIE}=${SESSION_VALUE}`);
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/signin' && url.searchParams.get('ok') === '1') {
      requests.push({ path: req.url ?? '', session: hasSession(req), status: 302 });
      res.writeHead(302, {
        'set-cookie': `${SESSION_COOKIE}=${SESSION_VALUE}; HttpOnly; Path=/; SameSite=Lax`,
        location: '/households',
      });
      res.end();
      return;
    }
    if (!hasSession(req)) {
      send(res, req, 403, 'text/plain', 'Forbidden');
      return;
    }
    const photo = /^\/photos\/([a-z-]+\.(?:png|jpg))$/.exec(url.pathname);
    if (photo !== null) {
      const file = photo[1] ?? '';
      const count = (photoCounts.get(file) ?? 0) + 1;
      photoCounts.set(file, count);
      const bytes = IMAGES[file];
      const extra = extraPhotos[file];
      if (extra !== undefined) {
        send(res, req, 200, extra.type, extra.body);
      } else if (bytes === undefined) {
        send(res, req, 404, 'text/plain', 'Not found');
      } else if (file === ALWAYS_FAILING || (file === FAILS_ONCE && count === 1)) {
        send(res, req, 500, 'text/plain', 'CANARY-ERROR-BODY server failure');
      } else {
        send(res, req, 200, file.endsWith('.png') ? 'image/png' : 'image/jpeg', bytes);
      }
      return;
    }
    const isPage = url.pathname === '/households' || /^\/households\/\d+$/.test(url.pathname);
    if (isPage && expireNext) {
      expireNext = false;
      send(res, req, 200, 'text/html', SIGNED_OUT);
      return;
    }
    if (url.pathname === '/households') {
      send(res, req, 200, 'text/html', householdList(households));
      return;
    }
    const match = /^\/households\/(\d+)$/.exec(url.pathname);
    const household = match === null ? undefined : households[Number(match[1])];
    if (household !== undefined) {
      send(res, req, 200, 'text/html', householdPage(household));
      return;
    }
    send(res, req, 404, 'text/plain', 'Not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${String(port)}`;
  return {
    origin,
    startUrl: `${origin}/signin?ok=1`,
    requests,
    photoRequests: (file) => photoCounts.get(file) ?? 0,
    expireNextPage: () => {
      expireNext = true;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
}
