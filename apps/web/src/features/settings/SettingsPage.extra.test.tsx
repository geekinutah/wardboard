import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage.tsx';
import type { Me, SettingsActions } from './types.ts';

const ADMIN: Me = { login: 'ada@example.test', displayName: 'Ada Admin', role: 'admin' };

function actions(): SettingsActions {
  const ok = vi.fn().mockResolvedValue({ ok: true });
  const restore = vi.fn().mockResolvedValue({ ok: false, code: 'restore_failed' });
  return {
    invite: ok,
    revokeInvitation: ok,
    revokeUser: ok,
    setRole: ok,
    transferAdmin: ok,
    setShowNeedsApproval: ok,
    validateRestore: restore,
    applyRestore: restore,
  };
}

describe('SettingsPage extra slot', () => {
  it('extra renders inside the main column after the last card', () => {
    render(
      <SettingsPage
        me={ADMIN}
        access={null}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions()}
        onBack={vi.fn()}
        onRestored={vi.fn()}
        extra={<section aria-label="Extra card">Extra content</section>}
      />,
    );
    const extra = screen.getByRole('region', { name: 'Extra card' });
    const backup = screen.getByRole('region', { name: /Backup/ });
    const main = backup.parentElement;
    expect(main).not.toBeNull();
    expect(main).toHaveClass('wb-settings-main');
    expect(extra.parentElement).toBe(main);
    expect(main?.lastElementChild).toBe(extra);
    expect(backup.nextElementSibling).toBe(extra);
  });
});
