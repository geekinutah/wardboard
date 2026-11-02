import { useEffect, useMemo, useState, type MouseEvent, type ReactElement } from 'react';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';
import type { AccessErrorCode, ActionResult, SettingsActions } from '../features/settings/types.ts';
import type { SyncClient } from '../sync/client.ts';
import type { RequestResult } from '../sync/protocol.ts';
import { useAccess, useMe, useSettings, useSync, useSyncClient } from '../sync/react.tsx';
import { ImportSection } from './ImportSection.tsx';
import { PhotoBundleSection } from './PhotoBundleSection.tsx';
import { postRestore } from './restore-client.ts';
import { TagLibrarySection } from './TagLibrarySection.tsx';
import './settings-route.css';

export const SETTINGS_PATH = '/settings';
const BACKUP_URL = '/api/admin/backup';
const NAVIGATE_EVENT = 'wardboard:navigate';

/** Client-side navigation: no reload, so the sync connection survives. */
export function navigate(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** The current pathname, kept in step with `navigate` and browser back/forward. */
export function usePathname(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = (): void => {
      setPathname(window.location.pathname);
    };
    window.addEventListener('popstate', update);
    window.addEventListener(NAVIGATE_EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAVIGATE_EVENT, update);
    };
  }, []);
  return pathname;
}

export function SettingsLink(): ReactElement {
  function onClick(event: MouseEvent<HTMLAnchorElement>): void {
    // Let modified clicks open a new tab or window as usual.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(SETTINGS_PATH);
  }
  return (
    <a href={SETTINGS_PATH} className="shell-settings-link" onClick={onClick}>
      Settings
    </a>
  );
}

const ACCESS_CODES: ReadonlySet<string> = new Set<AccessErrorCode>([
  'forbidden',
  'not_found',
  'invalid_login',
  'already_user',
  'already_invited',
  'last_admin',
  'revoked',
  'offline',
]);

function isAccessCode(code: string): code is AccessErrorCode {
  return ACCESS_CODES.has(code);
}

function toActionResult(result: RequestResult): ActionResult {
  if (result.ok) return { ok: true };
  return { ok: false, code: isAccessCode(result.code) ? result.code : 'forbidden' };
}

function buildActions(client: SyncClient): SettingsActions {
  return {
    invite: async (login) => toActionResult(await client.invite(login)),
    revokeInvitation: async (invitationId) => toActionResult(await client.revokeInvitation(invitationId)),
    revokeUser: async (userId) => toActionResult(await client.revokeUser(userId)),
    setRole: async (userId, role) => toActionResult(await client.setRole(userId, role)),
    transferAdmin: async (toUserId) => toActionResult(await client.transferAdmin(toUserId)),
    setShowNeedsApproval: async (value) => toActionResult(await client.setShowNeedsApproval(value)),
    validateRestore: (file) => postRestore('dry-run', file),
    applyRestore: (file) => postRestore('apply', file),
  };
}

function backToBoard(): void {
  navigate('/');
}

function reloadBoard(): void {
  window.location.assign('/');
}

export function SettingsRoute(): ReactElement {
  const client = useSyncClient();
  const me = useMe();
  const settings = useSettings();
  const access = useAccess();
  const { status } = useSync();
  const isAdmin = me !== null && me.role === 'admin';
  const actions = useMemo(() => buildActions(client), [client]);

  // Admins only: editors never probe the admin API. Re-list after a reconnect,
  // because the client clears `access` when the socket drops.
  useEffect(() => {
    if (!isAdmin || status !== 'live') return;
    void client.listAccess();
  }, [client, isAdmin, status]);

  if (me === null) {
    return (
      <div className="settings-route">
        <p className="settings-route-loading" role="status">
          Loading…
        </p>
      </div>
    );
  }

  return (
    <div className="settings-route">
      <SettingsPage
        me={me}
        access={access}
        showNeedsApproval={settings?.showNeedsApproval ?? false}
        backupUrl={BACKUP_URL}
        actions={actions}
        onBack={backToBoard}
        onRestored={reloadBoard}
        extra={
          <>
            <TagLibrarySection />
            <PhotoBundleSection />
            {isAdmin ? <ImportSection /> : null}
          </>
        }
      />
    </div>
  );
}
