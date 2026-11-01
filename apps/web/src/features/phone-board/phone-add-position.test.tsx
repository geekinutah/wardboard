import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhoneAddPositionSheet, type PhoneAddPositionSheetProps } from './PhoneAddPositionSheet.tsx';

const HELP = (count: number): string =>
  `Adds ${String(count)} vacant position(s) to this proposal only. Current and other proposals are unchanged.`;

function renderSheet(overrides: Partial<PhoneAddPositionSheetProps> = {}) {
  const onSubmit = overrides.onSubmit ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const props: PhoneAddPositionSheetProps = {
    callingGroupName: 'Relief Society Teachers',
    organizationName: 'Relief Society',
    groupId: 'cg-rs-teachers',
    onSubmit,
    onClose,
    ...overrides,
  };
  const view = render(<PhoneAddPositionSheet {...props} />);
  return { ...view, onSubmit, onClose, props };
}

describe('PhoneAddPositionSheet', () => {
  it('Relief Society defaults Teacher to women only', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSheet();
    await user.type(screen.getByRole('textbox', { name: 'Calling title' }), 'Teacher');
    const gender = screen.getByRole('combobox', { name: 'Gender requirement' });
    expect(gender).toHaveValue('F');
    expect(screen.getByText(HELP(1))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add position' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      groupId: 'cg-rs-teachers',
      title: 'Teacher',
      type: 'single',
      positionCount: 1,
      genderRule: 'F',
    });
  });

  it('Sunday School presidency defaults to Same as presidency', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSheet({
      callingGroupName: 'Sunday School Presidency',
      organizationName: 'Sunday School',
      groupId: 'cg-ss-presidency',
    });
    await user.type(screen.getByRole('textbox', { name: 'Calling title' }), 'Sunday School Second Counselor');
    const gender = screen.getByRole('combobox', { name: 'Gender requirement' });
    expect(gender).toHaveValue('presidency_aligned');
    expect(screen.getByRole('option', { name: 'Same as presidency' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add position' }));
    expect(onSubmit).toHaveBeenCalledWith({
      groupId: 'cg-ss-presidency',
      title: 'Sunday School Second Counselor',
      type: 'single',
      positionCount: 1,
      genderRule: 'presidency_aligned',
    });
  });

  it('a non-presidency Sunday School title has no Same as presidency option', async () => {
    const user = userEvent.setup();
    renderSheet({ organizationName: 'Sunday School', callingGroupName: 'Sunday School Presidency' });
    await user.type(screen.getByRole('textbox', { name: 'Calling title' }), 'Sunday School Teacher');
    const gender = screen.getByRole('combobox', { name: 'Gender requirement' });
    expect(gender).toHaveValue('any');
    expect(screen.queryByRole('option', { name: 'Same as presidency' })).not.toBeInTheDocument();
  });

  it('a stale presidency choice follows the new title', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSheet({
      organizationName: 'Sunday School',
      callingGroupName: 'Sunday School Presidency',
      groupId: 'cg-ss-presidency',
    });
    const title = screen.getByRole('textbox', { name: 'Calling title' });
    await user.type(title, 'Sunday School Second Counselor');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Gender requirement' }), 'presidency_aligned');
    await user.clear(title);
    await user.type(title, 'Sunday School Teacher');
    expect(screen.getByRole('combobox', { name: 'Gender requirement' })).toHaveValue('any');
    expect(screen.queryByRole('option', { name: 'Same as presidency' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add position' }));
    expect(onSubmit).toHaveBeenCalledWith({
      groupId: 'cg-ss-presidency',
      title: 'Sunday School Teacher',
      type: 'single',
      positionCount: 1,
      genderRule: 'any',
    });
  });

  it('an override is sent as chosen', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSheet();
    await user.type(screen.getByRole('textbox', { name: 'Calling title' }), 'Teacher');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Gender requirement' }), 'M');
    await user.click(screen.getByRole('button', { name: 'Add position' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ genderRule: 'M', title: 'Teacher' }));
  });

  it('an empty title sends nothing', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSheet();
    await user.click(screen.getByRole('button', { name: 'Add position' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a calling title');
    expect(onSubmit).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: 'Calling title' }), '   ');
    await user.click(screen.getByRole('button', { name: 'Add position' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a calling title');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a list defaults to 2 and clamps at 1 and 50', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSheet();
    await user.type(screen.getByRole('textbox', { name: 'Calling title' }), 'Helpers');
    await user.click(screen.getByRole('radio', { name: 'List' }));
    const count = screen.getByRole('spinbutton', { name: 'Positions' });
    expect(count).toHaveValue(2);
    expect(screen.getByText('Positions')).toBeInTheDocument();
    expect(screen.getByText(HELP(2))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fewer positions' }));
    await user.click(screen.getByRole('button', { name: 'Fewer positions' }));
    expect(count).toHaveValue(1);
    expect(screen.getByText(HELP(1))).toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'More positions' });
    for (let step = 0; step < 60; step += 1) {
      await user.click(more);
    }
    expect(count).toHaveValue(50);
    expect(screen.getByText(HELP(50))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add position' }));
    expect(onSubmit).toHaveBeenCalledWith({
      groupId: 'cg-rs-teachers',
      title: 'Helpers',
      type: 'list',
      positionCount: 50,
      genderRule: 'F',
    });
  });

  it('cancel and Escape send nothing', async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = renderSheet();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();
    const scrim = document.querySelector('.wb-phone-add-scrim');
    if (!(scrim instanceof HTMLElement)) throw new Error('missing scrim');
    await user.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
