# WardBoard import guide
Version: manual PDF replace. Directory collector: not shipped.

An admin can follow this guide with no model service. Download four official PDFs, preview them, then replace Current.

## What this version does

An admin previews four PDFs and then replaces Current. Proposals keep their own baselines. Notes and tags carry over only for a confirmed match. The app does not archive the PDFs.

Directory photo collection is not shipped. Portraits are uploaded in the app, one replacement at a time. Do not invent a collector, a scraper, or a command that downloads Church files.

## Sign in

Sign in to the Church site in your own browser, including MFA when the site asks for it. WardBoard, this guide, and any chat never ask for a password or an MFA code.

Do not paste credentials into WardBoard, a collector, or a chat.

## Download the four reports

Use these official clicks. Wait until generation finishes, then download.

- Callings → Callings by Organization → Print → Download PDF
- Reports → Members without Callings → Print → Download PDF
- Reports → Out-of-Unit Callings → Print → Download PDF
- Reports → Member Directory → Print → Download PDF (the printed report is titled "Member List")

All four are required. The Member List sets adult or youth for people the other reports don't age. Only each name and that category are kept; gender, age, birth date, phone and email are discarded before storage.

For the organization report, prefer Callings only, with Members and Ministering excluded where the UI allows.

Keep the PDFs in a private folder you choose. Do not commit them, and do not commit a JSON body built from them.

## Preview

Preview is a JSON `POST` to `/api/import/preview`. The body has exactly four keys: `organizations`, `withoutCallings`, `outOfUnit`, and `memberList`. Each value is standard base64 of that PDF with no `data:` prefix and no line breaks. Any other key, a bad PDF, or JSON that is not those four fields receives `400` `{"error":"bad_request"}`.

The command uses a cookie jar and an `Origin` header equal to the app origin. The origin has no path and no trailing slash. On the local dev server (`pnpm dev`) it is `http://127.0.0.1:5180`. That server signs every request in as the fictional admin, so an empty cookie jar still previews. On the deployed app the origin is the `WARDBOARD_BASE_URL` value, and you send the request to that origin from a tailnet device so Tailscale can identify you. A request from the host to `http://127.0.0.1:8080` has no session.

The cookie jar is not a place for a Church password or an MFA code. Leave it empty. An editor receives `403` `{"error":"forbidden"}`. A missing session receives `401` `{"error":"unauthenticated"}`. A body over 2_000_000 bytes receives `413` `{"error":"too_large"}`. An `Origin` that is missing or not the app origin also receives `403` `{"error":"forbidden"}`.

The default paths are fictional files for a local dev server only: `fixtures/lcr-reports/organizations-and-callings.pdf`, `fixtures/lcr-reports/members-without-callings.pdf`, `fixtures/lcr-reports/out-of-unit-callings.pdf`, and `fixtures/lcr-reports/member-list.pdf`. They are not a real ward. For a real import, set the four path variables to the PDFs in your private folder. Run from the repository root when you keep the fictional defaults. The command writes the JSON body and the cookie jar under a temporary directory.

```sh
#!/bin/sh
set -eu
ORIGIN="${ORIGIN:-http://127.0.0.1:5180}"
ORGANIZATIONS="${ORGANIZATIONS:-fixtures/lcr-reports/organizations-and-callings.pdf}"
WITHOUT_CALLINGS="${WITHOUT_CALLINGS:-fixtures/lcr-reports/members-without-callings.pdf}"
OUT_OF_UNIT="${OUT_OF_UNIT:-fixtures/lcr-reports/out-of-unit-callings.pdf}"
MEMBER_LIST="${MEMBER_LIST:-fixtures/lcr-reports/member-list.pdf}"
WORKDIR="$(mktemp -d)"
export ORGANIZATIONS WITHOUT_CALLINGS OUT_OF_UNIT MEMBER_LIST WORKDIR
touch "${WORKDIR}/wardboard-cookies.txt"
node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const b64 = (path) => readFileSync(path).toString('base64');
writeFileSync(
  join(process.env.WORKDIR, 'preview.json'),
  JSON.stringify({
    organizations: b64(process.env.ORGANIZATIONS),
    withoutCallings: b64(process.env.WITHOUT_CALLINGS),
    outOfUnit: b64(process.env.OUT_OF_UNIT),
    memberList: b64(process.env.MEMBER_LIST),
  }),
);
EOF
curl --silent --show-error \
  --cookie "${WORKDIR}/wardboard-cookies.txt" \
  --cookie-jar "${WORKDIR}/wardboard-cookies.txt" \
  --header "Origin: ${ORIGIN}" \
  --header "Content-Type: application/json" \
  --request POST \
  --data-binary @"${WORKDIR}/preview.json" \
  --write-out '\n%{http_code}\n' \
  "${ORIGIN}/api/import/preview"
```

## Read the preview

The JSON returns these counts: `decisions`, `absent`, `duplicates`, `inconsistentReports`, `returning`, `needsCategory`, `unfamiliar`, `keptPositions`, `matchedPositions`.

`duplicates` other than `[]` means do not replace (`409` `{"error":"duplicate_report"}` on a second attempt). `inconsistentReports: true` means the four reports disagree and replace is refused (`409` `{"error":"inconsistent_reports"}`). Nothing is written in either case.

Namesakes, resembling names, report conflicts, returning members, and a missing adult/youth category are resolved by the operator, not guessed. Each `decisions` entry has a `key`. A matched entry has `memberId`. `returning` lists `{ "key", "memberId" }` for members who are still removed. `needsCategory` lists keys that still need `adult` or `youth`. `keptPositions` is how many current positions the report does not use. `matchedPositions` is how many report rows land on an existing position.

Discarded and never stored: phone, email, address, birth date, age, gender, record number, class rosters, ministering.

Age is not a field in the preview.

## Replace

Replace is a JSON `POST` to `/api/import/replace`. The body is the same four PDF fields plus `expectedVersion` (the current board version) and `resolutions`. Extra keys receive `400` `{"error":"bad_request"}`.

`expectedVersion` is not in the preview JSON. A freshly seeded local dev board is version `1` until Current changes. A stale board is `409` `{"error":"stale","currentVersion":N}` and writes nothing. Post again with `expectedVersion` set to that `N`.

`resolutions` is an object keyed by decision `key`. The two shapes are `{ "action": "match", "memberId": "...", "confirmReturn": true }` and `{ "action": "new", "category": "adult" }` or `"youth"`.

- A matched person who is not in `returning` needs no entry.
- A returning member stays removed until `confirmReturn` is true. The `memberId` must be that same id. Choosing `new` instead declines the return.
- A key in `needsCategory` needs `new` with `adult` or `youth`. Do not guess.
- A namesake or a resembling name is either `match` of one listed candidate or `new`. Do not guess.
- A report conflict is `new`, not `match`.

An unresolved decision is `409` `{"error":"unresolved"}` and writes nothing. The same duplicate and disagreement refusals as preview also write nothing.

Success is `200` with `replaced`, `importVersion`, `importedAt`, `matched`, `created`, and `removed`.

The sample keys in the command are not names from the fictional PDFs. Replace `returning-key`, `member-id`, and `category-key` with values from the preview before you post. Use `"youth"` instead of `"adult"` when that is the category you mean. Posting the sample keys unchanged does not replace Current.

```sh
#!/bin/sh
set -eu
ORIGIN="${ORIGIN:-http://127.0.0.1:5180}"
EXPECTED_VERSION="${EXPECTED_VERSION:-1}"
ORGANIZATIONS="${ORGANIZATIONS:-fixtures/lcr-reports/organizations-and-callings.pdf}"
WITHOUT_CALLINGS="${WITHOUT_CALLINGS:-fixtures/lcr-reports/members-without-callings.pdf}"
OUT_OF_UNIT="${OUT_OF_UNIT:-fixtures/lcr-reports/out-of-unit-callings.pdf}"
MEMBER_LIST="${MEMBER_LIST:-fixtures/lcr-reports/member-list.pdf}"
WORKDIR="$(mktemp -d)"
export EXPECTED_VERSION ORGANIZATIONS WITHOUT_CALLINGS OUT_OF_UNIT MEMBER_LIST WORKDIR
touch "${WORKDIR}/wardboard-cookies.txt"
node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const b64 = (path) => readFileSync(path).toString('base64');
writeFileSync(
  join(process.env.WORKDIR, 'replace.json'),
  JSON.stringify({
    organizations: b64(process.env.ORGANIZATIONS),
    withoutCallings: b64(process.env.WITHOUT_CALLINGS),
    outOfUnit: b64(process.env.OUT_OF_UNIT),
    memberList: b64(process.env.MEMBER_LIST),
    expectedVersion: Number(process.env.EXPECTED_VERSION),
    resolutions: {
      'returning-key': { action: 'match', memberId: 'member-id', confirmReturn: true },
      'category-key': { action: 'new', category: 'adult' },
    },
  }),
);
EOF
curl --silent --show-error \
  --cookie "${WORKDIR}/wardboard-cookies.txt" \
  --cookie-jar "${WORKDIR}/wardboard-cookies.txt" \
  --header "Origin: ${ORIGIN}" \
  --header "Content-Type: application/json" \
  --request POST \
  --data-binary @"${WORKDIR}/replace.json" \
  --write-out '\n%{http_code}\n' \
  "${ORIGIN}/api/import/replace"
```

## Afterward

Check the success counts. Keep or delete your own PDF copies. The app does not delete those copies. Sign out of the Church site when you choose.

Do not paste member names, photos, or raw PDF text into chat.
