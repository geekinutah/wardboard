import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer, useState, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Canvas, type SelectTarget } from './Canvas.tsx';
import {
  cameraReducer,
  INITIAL_CAMERA,
  type Camera,
  type CameraAction,
  type ZoomTarget,
} from './camera.ts';

const LEVEL_2: Camera = { level: 2, orgId: 'primary', groupId: null, scale: 1.4, x: 6, y: 2 };
const LEVEL_3: Camera = { level: 3, orgId: 'primary', groupId: 'teachers', scale: 2, x: 12, y: -4 };

function levelText(): string {
  const node = document.querySelector('.wb-canvas-level');
  if (!(node instanceof HTMLElement)) throw new Error('missing level label');
  return node.textContent;
}

function layerTransform(container: HTMLElement): string {
  const layer = container.querySelector('.wb-canvas-layer');
  if (!(layer instanceof HTMLElement)) throw new Error('missing canvas layer');
  return layer.style.transform;
}

function firstAction(onCameraChange: { mock: { calls: CameraAction[][] } }): CameraAction {
  const call = onCameraChange.mock.calls[0];
  const action = call?.[0];
  if (action === undefined) throw new Error('expected a camera action');
  return action;
}

describe('Canvas', () => {
  it('single click selects and never zooms', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(target: SelectTarget) => void>();
    const onCameraChange = vi.fn<(action: CameraAction) => void>();
    render(
      <Canvas
        camera={INITIAL_CAMERA}
        onCameraChange={onCameraChange}
        onSelect={onSelect}
        onOpenNotes={() => undefined}
        selection={null}
        renderLevel={() => <div data-zoom-target="org:primary">Primary</div>}
      />,
    );

    await user.click(screen.getByText('Primary'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'org', id: 'primary' });
    expect(onCameraChange).not.toHaveBeenCalled();
  });

  it('double-click on a tile enters it', async () => {
    const user = userEvent.setup();
    const onCameraChange = vi.fn<(action: CameraAction) => void>();

    function Harness(): ReactElement {
      const [camera, dispatch] = useReducer(cameraReducer, INITIAL_CAMERA);
      return (
        <Canvas
          camera={camera}
          onCameraChange={(action) => {
            onCameraChange(action);
            dispatch(action);
          }}
          onSelect={() => undefined}
          onOpenNotes={() => undefined}
          selection={null}
          renderLevel={(current) => (
            <div>
              <div data-zoom-target="org:primary">Primary</div>
              <span data-testid="focus">{current.orgId ?? 'none'}</span>
            </div>
          )}
        />
      );
    }

    render(<Harness />);
    await user.dblClick(screen.getByText('Primary'));

    const action = firstAction(onCameraChange);
    expect(cameraReducer(INITIAL_CAMERA, action)).toEqual({
      level: 2,
      orgId: 'primary',
      groupId: null,
      scale: 1,
      x: 0,
      y: 0,
    });
    expect(levelText()).toBe('Organization');
    expect(screen.getByTestId('focus')).toHaveTextContent('primary');
  });

  it('double-click on a member card opens notes, not zoom', async () => {
    const user = userEvent.setup();
    const onOpenNotes = vi.fn<(memberId: string) => void>();
    const onCameraChange = vi.fn<(action: CameraAction) => void>();
    render(
      <Canvas
        camera={LEVEL_2}
        onCameraChange={onCameraChange}
        onSelect={() => undefined}
        onOpenNotes={onOpenNotes}
        selection={null}
        renderLevel={() => (
          <div data-zoom-target="group:teachers">
            Teachers
            <div data-member-id="ada-fictional">Ada Fictional</div>
          </div>
        )}
      />,
    );

    await user.dblClick(screen.getByText('Ada Fictional'));

    expect(onOpenNotes).toHaveBeenCalledTimes(1);
    expect(onOpenNotes).toHaveBeenCalledWith('ada-fictional');
    expect(onCameraChange).not.toHaveBeenCalled();
    expect(levelText()).toBe('Organization');
  });

  it('Esc goes up a level but not from inside an input', async () => {
    const user = userEvent.setup();
    const actions: CameraAction[] = [];

    function Harness(): ReactElement {
      const [camera, dispatch] = useReducer(cameraReducer, LEVEL_2);
      return (
        <div>
          <button type="button">Outside</button>
          <Canvas
            camera={camera}
            onCameraChange={(action) => {
              actions.push(action);
              dispatch(action);
            }}
            onSelect={() => undefined}
            onOpenNotes={() => undefined}
            selection={null}
            renderLevel={() => (
              <>
                <input aria-label="Planning note" />
                <textarea aria-label="Longer note" />
                <select aria-label="Pick">
                  <option>One</option>
                </select>
                <div role="textbox" aria-label="Editable note" contentEditable />
                <div
                  data-testid="stops-esc"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') event.preventDefault();
                  }}
                >
                  Stop escape
                </div>
              </>
            )}
          />
        </div>
      );
    }

    render(<Harness />);
    expect(levelText()).toBe('Organization');

    screen.getByRole('textbox', { name: 'Planning note' }).focus();
    await user.keyboard('{Escape}');

    screen.getByRole('textbox', { name: 'Longer note' }).focus();
    await user.keyboard('{Escape}');

    screen.getByRole('combobox', { name: 'Pick' }).focus();
    await user.keyboard('{Escape}');

    screen.getByRole('textbox', { name: 'Editable note' }).focus();
    await user.keyboard('{Escape}');

    screen.getByTestId('stops-esc').focus();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Outside' }));
    await user.keyboard('{Escape}');

    expect(actions).toEqual([]);
    expect(levelText()).toBe('Organization');

    screen.getByRole('region', { name: 'Board canvas' }).focus();
    await user.keyboard('{Escape}');

    expect(actions).toEqual([{ type: 'up' }]);
    expect(levelText()).toBe('Ward');
  });

  it('buttons are labelled and dispatch zoomIn/up/fit', async () => {
    const user = userEvent.setup();
    const actions: CameraAction[] = [];
    const selection: ZoomTarget = { kind: 'org', id: 'primary' };

    function Harness(): ReactElement {
      const [camera, dispatch] = useReducer(cameraReducer, LEVEL_3);
      return (
        <Canvas
          camera={camera}
          onCameraChange={(action) => {
            actions.push(action);
            dispatch(action);
          }}
          selection={selection}
          onSelect={() => undefined}
          onOpenNotes={() => undefined}
          renderLevel={() => <div>Board</div>}
        />
      );
    }

    const { container } = render(<Harness />);
    const toolbar = screen.getByRole('toolbar', { name: 'Zoom' });
    expect(toolbar).toBeInTheDocument();

    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    const fit = screen.getByRole('button', { name: 'Fit ward' });
    expect(zoomIn.tagName).toBe('BUTTON');
    expect(zoomOut.tagName).toBe('BUTTON');
    expect(fit.tagName).toBe('BUTTON');

    const viewport = container.querySelector('.wb-canvas-viewport');
    if (!(viewport instanceof HTMLElement)) throw new Error('missing viewport');
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 10, y: 20, width: 400, height: 300 }),
    );

    await user.click(zoomIn);
    expect(actions.at(-1)).toEqual({
      type: 'zoomIn',
      anchor: { x: 200, y: 150 },
      target: selection,
    });
    expect(levelText()).toBe('Group');

    await user.click(zoomOut);
    expect(actions.at(-1)).toEqual({ type: 'up' });
    expect(levelText()).toBe('Organization');

    await user.click(fit);
    expect(actions.at(-1)).toEqual({ type: 'fit' });
    expect(levelText()).toBe('Ward');
  });

  it('level label text matches level', () => {
    const props = {
      onCameraChange: () => undefined,
      onSelect: () => undefined,
      onOpenNotes: () => undefined,
      selection: null,
      renderLevel: () => null as ReactNode,
    };
    const { rerender } = render(<Canvas camera={INITIAL_CAMERA} {...props} />);
    const label = document.querySelector('.wb-canvas-level');
    if (!(label instanceof HTMLElement)) throw new Error('missing level label');
    expect(label).toHaveAttribute('aria-live', 'polite');
    expect(label).toHaveTextContent('Ward');

    const level2: Camera = { level: 2, orgId: 'primary', groupId: null, scale: 1, x: 0, y: 0 };
    rerender(<Canvas camera={level2} {...props} />);
    expect(levelText()).toBe('Organization');

    const level3: Camera = { level: 3, orgId: 'primary', groupId: 'teachers', scale: 1, x: 0, y: 0 };
    rerender(<Canvas camera={level3} {...props} />);
    expect(levelText()).toBe('Group');
  });

  it('drag on background pans; drag starting on a member card does not', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(target: SelectTarget) => void>();
    const onCameraChange = vi.fn<(action: CameraAction) => void>();

    function Harness(): ReactElement {
      const [camera, dispatch] = useReducer(cameraReducer, INITIAL_CAMERA);
      return (
        <Canvas
          camera={camera}
          onCameraChange={(action) => {
            onCameraChange(action);
            dispatch(action);
          }}
          onSelect={onSelect}
          onOpenNotes={() => undefined}
          selection={null}
          renderLevel={() => (
            <div>
              <div data-testid="background">Background</div>
              <div data-member-id="ada-fictional">Ada Fictional</div>
            </div>
          )}
        />
      );
    }

    const { container } = render(<Harness />);
    const background = screen.getByTestId('background');
    await user.pointer([
      { keys: '[MouseLeft>]', target: background, coords: { x: 10, y: 12 } },
      { coords: { x: 40, y: 20 } },
      { keys: '[/MouseLeft]' },
    ]);
    expect(layerTransform(container)).toBe('translate(30px, 8px) scale(1)');

    onCameraChange.mockClear();
    onSelect.mockClear();
    const member = screen.getByText('Ada Fictional');
    await user.pointer([
      { keys: '[MouseLeft>]', target: member, coords: { x: 0, y: 0 } },
      { coords: { x: 36, y: 18 } },
      { keys: '[/MouseLeft]' },
    ]);
    expect(onCameraChange).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(layerTransform(container)).toBe('translate(30px, 8px) scale(1)');
  });

  it('a movement under 4 px is a click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(target: SelectTarget) => void>();
    const onCameraChange = vi.fn<(action: CameraAction) => void>();

    function Harness(): ReactElement {
      const [camera, dispatch] = useReducer(cameraReducer, INITIAL_CAMERA);
      return (
        <Canvas
          camera={camera}
          onCameraChange={(action) => {
            onCameraChange(action);
            dispatch(action);
          }}
          onSelect={onSelect}
          onOpenNotes={() => undefined}
          selection={null}
          renderLevel={() => (
            <div>
              <div data-testid="background">Background</div>
              <div data-zoom-target="org:primary">Primary</div>
            </div>
          )}
        />
      );
    }

    const { container } = render(<Harness />);
    const org = screen.getByText('Primary');
    await user.pointer([
      { keys: '[MouseLeft>]', target: org, coords: { x: 5, y: 5 } },
      { coords: { x: 8, y: 6 } },
      { keys: '[/MouseLeft]' },
    ]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'org', id: 'primary' });
    expect(onCameraChange).not.toHaveBeenCalled();
    expect(layerTransform(container)).toBe('translate(0px, 0px) scale(1)');

    onSelect.mockClear();
    const background = screen.getByTestId('background');
    await user.pointer([
      { keys: '[MouseLeft>]', target: background, coords: { x: 0, y: 0 } },
      { coords: { x: 4, y: 0 } },
      { keys: '[/MouseLeft]' },
    ]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(layerTransform(container)).toBe('translate(4px, 0px) scale(1)');
  });

  it('rerendering with new content keeps the camera', async () => {
    const user = userEvent.setup();

    function Harness(): ReactElement {
      const [camera, dispatch] = useReducer(cameraReducer, INITIAL_CAMERA);
      const [generation, setGeneration] = useState(0);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setGeneration((value) => value + 1);
            }}
          >
            Refresh content
          </button>
          <Canvas
            camera={camera}
            onCameraChange={dispatch}
            selection={null}
            onSelect={() => undefined}
            onOpenNotes={() => undefined}
            renderLevel={() => <div data-testid="background">Generation {generation}</div>}
          />
        </>
      );
    }

    const { container } = render(<Harness />);
    const background = screen.getByTestId('background');
    await user.pointer([
      { keys: '[MouseLeft>]', target: background, coords: { x: 0, y: 0 } },
      { coords: { x: 28, y: 10 } },
      { keys: '[/MouseLeft]' },
    ]);
    expect(layerTransform(container)).toBe('translate(28px, 10px) scale(1)');

    await user.click(screen.getByRole('button', { name: 'Refresh content' }));
    expect(screen.getByText('Generation 1')).toBeInTheDocument();
    expect(layerTransform(container)).toBe('translate(28px, 10px) scale(1)');
    expect(levelText()).toBe('Ward');
  });

  it('wheel is anchored on the pointer and does not scroll the page', () => {
    const onCameraChange = vi.fn<(action: CameraAction) => void>();
    const { container } = render(
      <Canvas
        camera={INITIAL_CAMERA}
        onCameraChange={onCameraChange}
        onSelect={() => undefined}
        onOpenNotes={() => undefined}
        selection={null}
        renderLevel={() => <div data-zoom-target="org:sunday-school">Sunday School</div>}
      />,
    );
    const viewport = container.querySelector('.wb-canvas-viewport');
    if (!(viewport instanceof HTMLElement)) throw new Error('missing viewport');
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 10, y: 30, width: 200, height: 100 }),
    );

    const event = new WheelEvent('wheel', {
      deltaY: -50,
      clientX: 40,
      clientY: 70,
      bubbles: true,
      cancelable: true,
    });
    screen.getByText('Sunday School').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onCameraChange).toHaveBeenCalledWith({
      type: 'wheel',
      deltaY: -50,
      anchor: { x: 30, y: 40 },
      target: { kind: 'org', id: 'sunday-school' },
    });
  });

  it('pinch dispatches the distance ratio at the midpoint', () => {
    const onCameraChange = vi.fn<(action: CameraAction) => void>();
    const { container } = render(
      <Canvas
        camera={INITIAL_CAMERA}
        onCameraChange={onCameraChange}
        onSelect={() => undefined}
        onOpenNotes={() => undefined}
        selection={null}
        renderLevel={() => <div data-testid="background">Background</div>}
      />,
    );
    const viewport = container.querySelector('.wb-canvas-viewport');
    if (!(viewport instanceof HTMLElement)) throw new Error('missing viewport');

    fireEvent.pointerDown(viewport, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 0,
      clientY: 0,
      button: 0,
    });
    fireEvent.pointerDown(viewport, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 100,
      clientY: 0,
      button: 0,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 150,
      clientY: 0,
      button: 0,
    });

    expect(onCameraChange).toHaveBeenCalledWith({
      type: 'pinch',
      ratio: 1.5,
      anchor: { x: 75, y: 0 },
      target: null,
    });
  });
});
