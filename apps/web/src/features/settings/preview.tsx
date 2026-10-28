import { useState, type ReactElement } from 'react';
import type { PreviewModule } from '../../preview/types.ts';
import { SettingsPage } from './SettingsPage.tsx';
import type {
  AccessInvitation,
  AccessUser,
  ActionResult,
  Me,
  RestoreResult,
  Role,
  SettingsActions,
} from './types.ts';

function SettingsPreview(): ReactElement {
  const [viewAsEditor, setViewAsEditor] = useState(false);
  const [showNeedsApproval, setShowNeedsApproval] = useState(false);

  const [users, setUsers] = useState<readonly AccessUser[]>([
    {
      id: 'ada-id',
      login: 'ada@example.test',
      displayName: 'Ada Admin',
      role: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
      revokedAt: null,
    },
    {
      id: 'ben-id',
      login: 'ben@example.test',
      displayName: 'Ben Editor',
      role: 'editor',
      createdAt: '2026-01-02T00:00:00Z',
      revokedAt: null,
    },
    {
      id: 'cy-id',
      login: 'cy@example.test',
      displayName: 'Cy Counselor',
      role: 'editor',
      createdAt: '2026-01-03T00:00:00Z',
      revokedAt: null,
    },
  ]);

  const [invitations, setInvitations] = useState<readonly AccessInvitation[]>([
    {
      id: 'dee-inv-id',
      login: 'dee@example.test',
      invitedBy: 'ada-id',
      createdAt: '2026-01-04T00:00:00Z',
    },
  ]);

  const adaUser = users.find((u) => u.id === 'ada-id');
  const me: Me = {
    login: 'ada@example.test',
    displayName: 'Ada Admin',
    role: viewAsEditor ? 'editor' : (adaUser?.role ?? 'admin'),
  };

  const activeAdminsCount = users.filter((u) => u.revokedAt === null && u.role === 'admin').length;

  const actions: SettingsActions = {
    invite(login: string): Promise<ActionResult> {
      const normalized = login.trim().toLowerCase();
      if (!normalized) {
        return Promise.resolve({ ok: false, code: 'invalid_login' });
      }
      if (users.some((u) => u.revokedAt === null && u.login.toLowerCase() === normalized)) {
        return Promise.resolve({ ok: false, code: 'already_user' });
      }
      if (invitations.some((i) => i.login.toLowerCase() === normalized)) {
        return Promise.resolve({ ok: false, code: 'already_invited' });
      }

      const newInv: AccessInvitation = {
        id: `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        login: normalized,
        invitedBy: 'ada-id',
        createdAt: new Date().toISOString(),
      };
      setInvitations((prev) => [...prev, newInv]);
      return Promise.resolve({ ok: true });
    },

    revokeInvitation(invitationId: string): Promise<ActionResult> {
      setInvitations((prev) => prev.filter((i) => i.id !== invitationId));
      return Promise.resolve({ ok: true });
    },

    revokeUser(userId: string): Promise<ActionResult> {
      const target = users.find((u) => u.id === userId);
      if (!target) return Promise.resolve({ ok: false, code: 'not_found' });
      if (target.revokedAt !== null) return Promise.resolve({ ok: false, code: 'revoked' });
      if (target.role === 'admin' && activeAdminsCount <= 1) {
        return Promise.resolve({ ok: false, code: 'last_admin' });
      }

      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, revokedAt: new Date().toISOString() } : u)),
      );
      return Promise.resolve({ ok: true });
    },

    setRole(userId: string, role: Role): Promise<ActionResult> {
      const target = users.find((u) => u.id === userId);
      if (!target) return Promise.resolve({ ok: false, code: 'not_found' });
      if (target.revokedAt !== null) return Promise.resolve({ ok: false, code: 'revoked' });
      if (target.role === 'admin' && role === 'editor' && activeAdminsCount <= 1) {
        return Promise.resolve({ ok: false, code: 'last_admin' });
      }

      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
      return Promise.resolve({ ok: true });
    },

    transferAdmin(toUserId: string): Promise<ActionResult> {
      if (toUserId === 'ada-id') {
        return Promise.resolve({ ok: false, code: 'invalid_login' });
      }
      const target = users.find((u) => u.id === toUserId);
      if (!target) return Promise.resolve({ ok: false, code: 'not_found' });
      if (target.revokedAt !== null) return Promise.resolve({ ok: false, code: 'revoked' });

      setUsers((prev) =>
        prev.map((u) => {
          if (u.id === toUserId) return { ...u, role: 'admin' };
          if (u.id === 'ada-id') return { ...u, role: 'editor' };
          return u;
        }),
      );
      return Promise.resolve({ ok: true });
    },

    setShowNeedsApproval(value: boolean): Promise<ActionResult> {
      setShowNeedsApproval(value);
      return Promise.resolve({ ok: true });
    },

    validateRestore(file: File): Promise<RestoreResult> {
      if (file.name.endsWith('.backup')) {
        return Promise.resolve({
          ok: true,
          summary: {
            members: 41,
            photos: 12,
            proposals: 2,
            users: 3,
            hasCurrent: true,
            createdAt: '2026-10-24T18:00:00Z',
            schemaVersion: 1,
          },
        });
      }
      return Promise.resolve({ ok: false, code: 'invalid_archive' });
    },

    applyRestore(file: File): Promise<RestoreResult> {
      return Promise.resolve(file.name).then(() => ({
        ok: true,
        summary: {
          members: 41,
          photos: 12,
          proposals: 2,
          users: 3,
          hasCurrent: true,
          createdAt: '2026-10-24T18:00:00Z',
          schemaVersion: 1,
        },
      }));
    },
  };

  return (
    <div>
      <aside
        style={{
          padding: '8px 24px',
          background: '#E3EEEF',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          borderBottom: '1px solid #D9DDD8',
        }}
      >
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 600,
            color: '#123E47',
          }}
        >
          <input
            type="checkbox"
            checked={viewAsEditor}
            onChange={(e) => {
              setViewAsEditor(e.target.checked);
            }}
          />
          View as Editor
        </label>
      </aside>

      <SettingsPage
        me={me}
        access={{ users, invitations }}
        showNeedsApproval={showNeedsApproval}
        backupUrl="#backup"
        actions={actions}
        onBack={() => {
          // No-op in preview
        }}
        onRestored={() => {
          // No-op in preview
        }}
      />
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Settings',
  render: () => <SettingsPreview />,
};

export default preview;
