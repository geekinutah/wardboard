import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPreviewData } from '../../preview/data.ts';
import preview from './preview.tsx';

function memberCard(name: string, selector: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(selector)].find((node) => node.textContent.includes(name));
  if (found === undefined) {
    throw new Error(`${name} card not rendered`);
  }
  return found;
}

function teacherVacancy(): HTMLElement {
  const list = screen.getByRole('list', { name: 'Relief Society Teacher' });
  const found = list.querySelector<HTMLElement>('[data-position-id]:not([data-member-id])');
  if (found === null) {
    throw new Error('no Relief Society Teacher vacancy');
  }
  return found;
}

function dragOnto(from: HTMLElement, to: HTMLElement): void {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => to });
  fireEvent.pointerDown(from, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
  fireEvent.pointerMove(to, { clientX: 40, clientY: 40, pointerId: 1 });
  fireEvent.pointerUp(to, { clientX: 40, clientY: 40, pointerId: 1 });
}

afterEach(() => {
  Reflect.deleteProperty(document, 'elementFromPoint');
});

describe('dnd preview', () => {
  it('starts with Ivy in the dugout and the teacher vacancy open, and applies drops with core', () => {
    render(<>{preview.render(buildPreviewData())}</>);
    expect(preview.title).toBe('Drag and drop');
    const list = screen.getByRole('list', { name: 'Relief Society Teacher' });
    expect(list).not.toHaveTextContent('Ivy Notreal');

    dragOnto(memberCard('Ivy Notreal', '[data-drop-target="dugout"] article[data-member-id]'), teacherVacancy());
    expect(screen.getByRole('status')).toHaveTextContent('Applied: addToList');
    expect(list).toHaveTextContent('Ivy Notreal');
  });

  it('applies a needs-approval move with its approval and keeps the moved-from group', () => {
    render(<>{preview.render(buildPreviewData())}</>);
    dragOnto(memberCard('Cy Mockup', '[data-position-id][data-member-id]'), teacherVacancy());
    const dialog = screen.getByRole('dialog', { name: 'Approval needed for this placement' });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve placement' }));
    expect(screen.getByRole('status')).toHaveTextContent('Applied: addToList, approvePlacement');
    expect(screen.getByRole('list', { name: 'Relief Society Teacher' })).toHaveTextContent('Cy Mockup');
    expect(screen.getByRole('list', { name: 'Primary Teacher' })).not.toHaveTextContent('Cy Mockup');
  });

  it('Show Current renders the read-only Current board where nothing drags', () => {
    render(<>{preview.render(buildPreviewData())}</>);
    fireEvent.click(screen.getByRole('button', { name: 'Show Current' }));
    expect(screen.getByRole('button', { name: 'Show Current' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Current is read-only. Nothing can be dragged here.');
    dragOnto(memberCard('Cy Mockup', '[data-position-id][data-member-id]'), teacherVacancy());
    expect(document.querySelector('[data-dnd-ghost]')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status')).not.toHaveTextContent('Applied');
  });
});
