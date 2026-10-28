import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { SettingsPage } from './SettingsPage.tsx';
import type {
  AccessData,
  ActionResult,
  BackupSummary,
  Me,
  RestoreResult,
  Role,
  SettingsActions,
} from './types.ts';

interface MockSet {
  invite: Mock<(login: string) => Promise<ActionResult>>;
  revokeInvitation: Mock<(invitationId: string) => Promise<ActionResult>>;
  revokeUser: Mock<(userId: string) => Promise<ActionResult>>;
  setRole: Mock<(userId: string, role: Role) => Promise<ActionResult>>;
  transferAdmin: Mock<(toUserId: string) => Promise<ActionResult>>;
  setShowNeedsApproval: Mock<(value: boolean) => Promise<ActionResult>>;
  validateRestore: Mock<(file: File) => Promise<RestoreResult>>;
  applyRestore: Mock<(file: File) => Promise<RestoreResult>>;
  actions: SettingsActions;
}

function createMockSet(overrides: Partial<SettingsActions> = {}): MockSet {
  const defaultSummary: BackupSummary = {
    createdAt: '2026-10-24T18:00:00Z',
    schemaVersion: 1,
    members: 41,
    proposals: 2,
    users: 3,
    photos: 12,
    hasCurrent: true,
  };

  const invite =
    (overrides.invite as Mock<(login: string) => Promise<ActionResult>> | undefined) ??
    vi.fn().mockResolvedValue({ ok: true });
  const revokeInvitation =
    (overrides.revokeInvitation as
      | Mock<(invitationId: string) => Promise<ActionResult>>
      | undefined) ?? vi.fn().mockResolvedValue({ ok: true });
  const revokeUser =
    (overrides.revokeUser as Mock<(userId: string) => Promise<ActionResult>> | undefined) ??
    vi.fn().mockResolvedValue({ ok: true });
  const setRole =
    (overrides.setRole as Mock<(userId: string, role: Role) => Promise<ActionResult>> | undefined) ??
    vi.fn().mockResolvedValue({ ok: true });
  const transferAdmin =
    (overrides.transferAdmin as Mock<(toUserId: string) => Promise<ActionResult>> | undefined) ??
    vi.fn().mockResolvedValue({ ok: true });
  const setShowNeedsApproval =
    (overrides.setShowNeedsApproval as Mock<(value: boolean) => Promise<ActionResult>> | undefined) ??
    vi.fn().mockResolvedValue({ ok: true });
  const validateRestore =
    (overrides.validateRestore as Mock<(file: File) => Promise<RestoreResult>> | undefined) ??
    vi.fn().mockResolvedValue({
      ok: true,
      summary: defaultSummary,
    });
  const applyRestore =
    (overrides.applyRestore as Mock<(file: File) => Promise<RestoreResult>> | undefined) ??
    vi.fn().mockResolvedValue({
      ok: true,
      summary: defaultSummary,
    });

  return {
    invite,
    revokeInvitation,
    revokeUser,
    setRole,
    transferAdmin,
    setShowNeedsApproval,
    validateRestore,
    applyRestore,
    actions: {
      invite,
      revokeInvitation,
      revokeUser,
      setRole,
      transferAdmin,
      setShowNeedsApproval,
      validateRestore,
      applyRestore,
    },
  };
}

const adaAdmin: Me = {
  login: 'ada@example.test',
  displayName: 'Ada Admin',
  role: 'admin',
};

const benEditorMe: Me = {
  login: 'ben@example.test',
  displayName: 'Ben Editor',
  role: 'editor',
};

const defaultAccess: AccessData = {
  users: [
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
    {
      id: 'revoked-id',
      login: 'revoked@example.test',
      displayName: 'Revoked Person',
      role: 'editor',
      createdAt: '2026-01-04T00:00:00Z',
      revokedAt: '2026-01-05T00:00:00Z',
    },
  ],
  invitations: [
    {
      id: 'dee-inv-id',
      login: 'dee@example.test',
      invitedBy: 'ada-id',
      createdAt: '2026-01-06T00:00:00Z',
    },
  ],
};

describe('SettingsPage', () => {
  it('renders loading state when access is null', () => {
    const { actions } = createMockSet();
    render(
      <SettingsPage
        me={adaAdmin}
        access={null}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    expect(screen.getByText('Loading people…')).toBeInTheDocument();
  });

  it('calls onBack when clicking back button', async () => {
    const user = userEvent.setup();
    const { actions } = createMockSet();
    const onBack = vi.fn();
    render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={onBack}
        onRestored={vi.fn()}
      />,
    );

    const backButton = screen.getByRole('button', { name: '← Back to board' });
    await user.click(backButton);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('lists active admins then editors, marks you, hides revoked users, then invitations', () => {
    const { actions } = createMockSet();
    render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    expect(screen.getByText('Ada Admin (you)')).toBeInTheDocument();
    expect(screen.getByText('Ben Editor')).toBeInTheDocument();
    expect(screen.getByText('Cy Counselor')).toBeInTheDocument();
    expect(screen.queryByText('Revoked Person')).not.toBeInTheDocument();

    expect(screen.getByText('dee@example.test')).toBeInTheDocument();
    expect(screen.getByText('Invited')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });

  it('editor sees no access controls, no backup controls, and a disabled switch', async () => {
    const user = userEvent.setup();
    const { actions, setShowNeedsApproval } = createMockSet();
    render(
      <SettingsPage
        me={benEditorMe}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    expect(screen.getByText('Only an Admin can manage access.')).toBeInTheDocument();
    expect(screen.getByText('Only an Admin can create or restore backups.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite editor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove access' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create backup' })).not.toBeInTheDocument();

    const toggle = screen.getByRole('switch', { name: /Show Needs approval/i });
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await user.click(toggle);
    expect(setShowNeedsApproval).not.toHaveBeenCalled();
  });

  it('invite trims, sends once, clears on success', async () => {
    const user = userEvent.setup();
    let resolveInvite!: (val: ActionResult) => void;
    const invitePromise = new Promise<ActionResult>((resolve) => {
      resolveInvite = resolve;
    });
    const inviteMock = vi.fn().mockImplementation(() => invitePromise);
    const { actions } = createMockSet({
      invite: inviteMock,
    });

    render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Login to invite');
    const submitButton = screen.getByRole('button', { name: 'Invite editor' });

    await user.type(input, '   eve@example.test   ');
    await user.click(submitButton);
    await user.click(submitButton);

    expect(inviteMock).toHaveBeenCalledTimes(1);
    expect(inviteMock).toHaveBeenCalledWith('eve@example.test');
    expect(screen.getByRole('button', { name: 'Inviting…' })).toBeDisabled();

    resolveInvite({ ok: true });
    await waitFor(() => {
      expect(input).toHaveValue('');
    });
  });

  it('invite failure keeps the text and shows the mapped message', async () => {
    const user = userEvent.setup();
    const { actions } = createMockSet({
      invite: vi.fn().mockResolvedValue({ ok: false, code: 'already_invited' }),
    });

    render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Login to invite');
    await user.type(input, 'eve@example.test');
    await user.click(screen.getByRole('button', { name: 'Invite editor' }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('That login is already invited.');
    });
    expect(input).toHaveValue('eve@example.test');
  });

  it('Invite editor is disabled for blank input', async () => {
    const user = userEvent.setup();
    const { actions } = createMockSet();

    render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Login to invite');
    const submitButton = screen.getByRole('button', { name: 'Invite editor' });

    expect(submitButton).toBeDisabled();
    await user.type(input, '   ');
    expect(submitButton).toBeDisabled();
  });

  it('Make admin and Make editor call setRole with the right role', async () => {
    const user = userEvent.setup();
    const { actions, setRole } = createMockSet();

    const accessWithTwoAdmins: AccessData = {
      users: [
        ...defaultAccess.users,
        {
          id: 'dan-admin-id',
          login: 'dan@example.test',
          displayName: 'Dan Admin',
          role: 'admin',
          createdAt: '2026-01-01T12:00:00Z',
          revokedAt: null,
        },
      ],
      invitations: defaultAccess.invitations,
    };

    render(
      <SettingsPage
        me={adaAdmin}
        access={accessWithTwoAdmins}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    // Ben is editor -> Make admin
    const benRow = screen.getByText('Ben Editor').closest<HTMLElement>('.wb-settings-row');
    expect(benRow).toBeDefined();
    if (!benRow) throw new Error('Missing benRow');
    const makeAdminBen = within(benRow).getByRole('button', { name: 'Make admin' });
    await user.click(makeAdminBen);
    expect(setRole).toHaveBeenCalledWith('ben-id', 'admin');

    // Dan is admin -> Make editor
    const danRow = screen.getByText('Dan Admin').closest<HTMLElement>('.wb-settings-row');
    expect(danRow).toBeDefined();
    if (!danRow) throw new Error('Missing danRow');
    const makeEditorDan = within(danRow).getByRole('button', { name: 'Make editor' });
    await user.click(makeEditorDan);
    expect(setRole).toHaveBeenCalledWith('dan-admin-id', 'editor');
  });

  it('Remove access needs confirmation; Cancel and Escape do nothing', async () => {
    const user = userEvent.setup();
    const { actions, revokeUser } = createMockSet();

    render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    // There is a Remove access button for Ben
    const removeButtons = screen.getAllByRole('button', { name: 'Remove access' });
    const benRemoveBtn = removeButtons[1];
    expect(benRemoveBtn).toBeDefined();
    if (!benRemoveBtn) throw new Error('Missing remove button');
    await user.click(benRemoveBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Remove access for Ben Editor?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('They will be signed out right away and can no longer open WardBoard.'),
    ).toBeInTheDocument();

    // Cancel does nothing
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(revokeUser).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Reopen and test Escape
    await user.click(benRemoveBtn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(revokeUser).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Reopen and confirm
    await user.click(benRemoveBtn);
    const confirmButton =
      screen.getByRole('dialog').querySelector('button[type="submit"]') ||
      screen
        .getAllByRole('button', { name: 'Remove access' })
        .find((b) => b.closest('[role="dialog"]'));
    expect(confirmButton).toBeDefined();
    if (!confirmButton) throw new Error('Missing confirm button');
    await user.click(confirmButton);

    expect(revokeUser).toHaveBeenCalledTimes(1);
    expect(revokeUser).toHaveBeenCalledWith('ben-id');
  });

  it('the only admin cannot remove or demote themself, and sees why', () => {
    const { actions } = createMockSet();

    const { rerender } = render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    // Ada is the sole admin
    const myRow = screen.getByText('Ada Admin (you)').closest('div');
    expect(myRow).toBeDefined();

    const removeBtn = screen.getAllByRole('button', { name: 'Remove access' })[0];
    expect(removeBtn).toBeDisabled();

    const demoteBtn = screen.getByRole('button', { name: 'Make editor' });
    expect(demoteBtn).toBeDisabled();

    expect(
      screen.getByText(
        "You're the only admin, so you can't remove your own admin role or access. Make someone else an admin first, or use Transfer admin.",
      ),
    ).toBeInTheDocument();

    // Now re-render with a second active admin
    const accessWithSecondAdmin: AccessData = {
      users: [
        ...defaultAccess.users,
        {
          id: 'dan-admin-id',
          login: 'dan@example.test',
          displayName: 'Dan Admin',
          role: 'admin',
          createdAt: '2026-01-01T12:00:00Z',
          revokedAt: null,
        },
      ],
      invitations: defaultAccess.invitations,
    };

    rerender(
      <SettingsPage
        me={adaAdmin}
        access={accessWithSecondAdmin}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('button', { name: 'Remove access' })[0]).not.toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Make editor' })[0]).not.toBeDisabled();
    expect(
      screen.queryByText(
        "You're the only admin, so you can't remove your own admin role or access. Make someone else an admin first, or use Transfer admin.",
      ),
    ).not.toBeInTheDocument();
  });

  it('Transfer admin requires choosing a person', async () => {
    const user = userEvent.setup();
    const { actions, transferAdmin } = createMockSet();

    render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    const transferBtn = screen.getByRole('button', { name: 'Transfer admin' });
    await user.click(transferBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Check radio buttons for Ben and Cy
    const benRadio = screen.getByRole('radio', { name: 'Make Ben Editor the admin' });
    const cyRadio = screen.getByRole('radio', { name: 'Make Cy Counselor the admin' });
    expect(benRadio).toBeInTheDocument();
    expect(cyRadio).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Make Ada/i })).not.toBeInTheDocument();

    const submitTransfer = screen.getByRole('button', { name: 'Transfer' });
    expect(submitTransfer).toBeDisabled();

    await user.click(cyRadio);
    expect(submitTransfer).not.toBeDisabled();

    await user.click(submitTransfer);
    expect(transferAdmin).toHaveBeenCalledWith('cy-id');
  });

  it('Transfer admin is hidden when no one else has access', () => {
    const { actions } = createMockSet();
    const soleUser = defaultAccess.users[0];
    expect(soleUser).toBeDefined();
    if (!soleUser) throw new Error('Missing soleUser');
    const soleAccess: AccessData = {
      users: [soleUser],
      invitations: [],
    };

    render(
      <SettingsPage
        me={adaAdmin}
        access={soleAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Transfer admin' })).not.toBeInTheDocument();
  });

  it('Revoke invitation calls revokeInvitation with its id', async () => {
    const user = userEvent.setup();
    const { actions, revokeInvitation } = createMockSet();

    render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    const revokeBtn = screen.getByRole('button', { name: 'Revoke' });
    await user.click(revokeBtn);
    expect(revokeInvitation).toHaveBeenCalledWith('dee-inv-id');
  });

  it('the switch shows server state, not an optimistic flip', async () => {
    const user = userEvent.setup();
    const { actions, setShowNeedsApproval } = createMockSet();

    const { rerender } = render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    const toggle = screen.getByRole('switch', { name: /Show Needs approval/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Off')).toBeInTheDocument();

    await user.click(toggle);
    expect(setShowNeedsApproval).toHaveBeenCalledWith(true);

    // Should NOT flip optimistically
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Off')).toBeInTheDocument();

    // Rerender with server's pushed state
    rerender(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={true}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('On')).toBeInTheDocument();
  });

  it('restore: validation failure shows the mapped message and no dialog', async () => {
    const { actions } = createMockSet({
      validateRestore: vi.fn().mockResolvedValue({ ok: false, code: 'invalid_archive' }),
    });

    render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    const fileInput = screen.getByLabelText('Backup file');
    const fakeFile = new File(['content'], 'ward.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [fakeFile] } });

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('This file is not a WardBoard backup.');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('restore: summary dialog shows counts and Current date, then applies once', async () => {
    const user = userEvent.setup();
    let resolveApply!: (val: RestoreResult) => void;
    const applyPromise = new Promise<RestoreResult>((resolve) => {
      resolveApply = resolve;
    });

    const applyRestoreMock = vi.fn().mockImplementation(() => applyPromise);
    const { actions } = createMockSet({
      applyRestore: applyRestoreMock,
    });
    const onRestored = vi.fn();

    render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={onRestored}
      />,
    );

    const fileInput = screen.getByLabelText('Backup file');
    const fakeFile = new File(['backup'], 'ward.backup', { type: 'application/octet-stream' });
    fireEvent.change(fileInput, { target: { files: [fakeFile] } });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: 'Restore ward.backup?' })).toBeInTheDocument();
    expect(screen.getByText('✓ Archive valid')).toBeInTheDocument();
    expect(screen.getByText('41 members')).toBeInTheDocument();
    expect(screen.getByText('12 photos')).toBeInTheDocument();
    expect(screen.getByText('2 proposals')).toBeInTheDocument();
    expect(screen.getByText('3 users')).toBeInTheDocument();
    expect(screen.getByText('Current from Oct 24, 2026')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Replaces everything in WardBoard for everyone. Open boards reload. If anything fails, nothing changes.',
      ),
    ).toBeInTheDocument();

    const replaceBtn = screen.getByRole('button', { name: 'Replace all data' });
    await user.click(replaceBtn);
    await user.click(replaceBtn);

    expect(applyRestoreMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Restoring…' })).toBeDisabled();

    resolveApply({
      ok: true,
      summary: {
        createdAt: '2026-10-24T18:00:00Z',
        schemaVersion: 1,
        members: 41,
        proposals: 2,
        users: 3,
        photos: 12,
        hasCurrent: true,
      },
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Restore complete.')).toBeInTheDocument();
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it('restore: hasCurrent false says No Current board', async () => {
    const { actions } = createMockSet({
      validateRestore: vi.fn().mockResolvedValue({
        ok: true,
        summary: {
          createdAt: '2026-10-24T18:00:00Z',
          schemaVersion: 1,
          members: 41,
          proposals: 2,
          users: 3,
          photos: 12,
          hasCurrent: false,
        },
      }),
    });

    render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    const fileInput = screen.getByLabelText('Backup file');
    const fakeFile = new File(['backup'], 'ward.backup', { type: 'application/octet-stream' });
    fireEvent.change(fileInput, { target: { files: [fakeFile] } });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    expect(screen.getByText('No Current board')).toBeInTheDocument();
    expect(screen.queryByText(/Current from/)).not.toBeInTheDocument();
  });

  it('restore: apply failure keeps the dialog open with the message', async () => {
    const user = userEvent.setup();
    const { actions } = createMockSet({
      applyRestore: vi.fn().mockResolvedValue({ ok: false, code: 'restore_failed' }),
    });
    const onRestored = vi.fn();

    render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={onRestored}
      />,
    );

    const fileInput = screen.getByLabelText('Backup file');
    const fakeFile = new File(['backup'], 'ward.backup', { type: 'application/octet-stream' });
    fireEvent.change(fileInput, { target: { files: [fakeFile] } });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Replace all data' }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Restore failed. Nothing was changed.');
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('Create backup links to the backup URL with download', () => {
    const { actions } = createMockSet();

    render(
      <SettingsPage
        me={adaAdmin}
        access={defaultAccess}
        showNeedsApproval={false}
        backupUrl="/api/admin/backup"
        actions={actions}
        onBack={vi.fn()}
        onRestored={vi.fn()}
      />,
    );

    const link = screen.getByRole('link', { name: 'Create backup' });
    expect(link).toHaveAttribute('href', '/api/admin/backup');
    expect(link).toHaveAttribute('download');
  });
});
