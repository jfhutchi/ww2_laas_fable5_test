/**
 * Raw input state collector. Gameplay systems read digested state each frame;
 * discrete events (clicks, key presses) are queued and drained once per frame
 * so the fixed-step sim never misses fast taps.
 */

import { pointerButtonMask } from './PointerButtons.ts';

export interface PointerState {
  x: number;
  y: number;
  /** Normalized device coords -1..1 (y up). */
  ndcX: number;
  ndcY: number;
  buttons: number;
  wheelDelta: number;
  /** Drag rectangle while left button held (screen px). */
  dragStartX: number;
  dragStartY: number;
  dragging: boolean;
}

export interface ClickEvent {
  button: number;
  x: number;
  y: number;
  ndcX: number;
  ndcY: number;
  shift: boolean;
  ctrl: boolean;
  /** True when the pointer moved less than the drag threshold. */
  isClick: boolean;
  dragStartX: number;
  dragStartY: number;
}

const DRAG_THRESHOLD_PX = 6;

export class Input {
  private keys = new Set<string>();
  private pressedQueue: string[] = [];
  private clickQueue: ClickEvent[] = [];
  // Pointer starts OFF-SCREEN (-1,-1) until the first real mousemove: a
  // (0,0) default sits inside the top-left edge-pan zone, so every headless
  // or untouched-mouse session slowly panned the tactical camera up-left.
  readonly pointer: PointerState = {
    x: -1,
    y: -1,
    ndcX: 0,
    ndcY: 0,
    buttons: 0,
    wheelDelta: 0,
    dragStartX: 0,
    dragStartY: 0,
    dragging: false,
  };
  /** Mouse movement since last frame (for pointer-lock tank aiming). */
  moveDx = 0;
  moveDy = 0;
  pointerLocked = false;

  private el: HTMLElement | null = null;
  private downX = 0;
  private downY = 0;
  private detach: (() => void)[] = [];

  attach(el: HTMLElement): void {
    this.el = el;
    const opts = { passive: false } as AddEventListenerOptions;

    const onKeyDown = (e: KeyboardEvent): void => {
      // Keep browser shortcuts working, but stop page scroll / tab focus loss.
      if (['Tab', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
      }
      const k = normalizeKey(e);
      if (!this.keys.has(k)) this.pressedQueue.push(k);
      this.keys.add(k);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      this.keys.delete(normalizeKey(e));
    };
    const onBlur = (): void => {
      this.keys.clear();
      this.pointer.buttons = 0;
      this.pointer.dragging = false;
      this.moveDx = 0;
      this.moveDy = 0;
    };

    const updatePointer = (e: MouseEvent): void => {
      const rect = this.el?.getBoundingClientRect();
      const w = rect?.width ?? window.innerWidth;
      const h = rect?.height ?? window.innerHeight;
      const x = e.clientX - (rect?.left ?? 0);
      const y = e.clientY - (rect?.top ?? 0);
      this.pointer.x = x;
      this.pointer.y = y;
      this.pointer.ndcX = (x / w) * 2 - 1;
      this.pointer.ndcY = -((y / h) * 2 - 1);
    };

    const onMouseMove = (e: MouseEvent): void => {
      updatePointer(e);
      this.moveDx += e.movementX;
      this.moveDy += e.movementY;
      if ((this.pointer.buttons & 1) !== 0 && !this.pointer.dragging) {
        const dx = this.pointer.x - this.downX;
        const dy = this.pointer.y - this.downY;
        if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
          this.pointer.dragging = true;
        }
      }
    };
    const onMouseDown = (e: MouseEvent): void => {
      updatePointer(e);
      this.pointer.buttons |= pointerButtonMask(e.button);
      // Orbit begins with a clean motion channel. Movement accumulated by a
      // preceding right-button command gesture must never be replayed here.
      if (e.button === 1) {
        this.moveDx = 0;
        this.moveDy = 0;
      }
      if (e.button === 0) {
        this.downX = this.pointer.x;
        this.downY = this.pointer.y;
        this.pointer.dragStartX = this.pointer.x;
        this.pointer.dragStartY = this.pointer.y;
        this.pointer.dragging = false;
      }
      if (e.button === 1 || e.button === 2) e.preventDefault();
    };
    const onMouseUp = (e: MouseEvent): void => {
      updatePointer(e);
      this.pointer.buttons &= ~pointerButtonMask(e.button);
      this.clickQueue.push({
        button: e.button,
        x: this.pointer.x,
        y: this.pointer.y,
        ndcX: this.pointer.ndcX,
        ndcY: this.pointer.ndcY,
        shift: e.shiftKey,
        ctrl: e.ctrlKey,
        isClick: e.button !== 0 || !this.pointer.dragging,
        dragStartX: this.pointer.dragStartX,
        dragStartY: this.pointer.dragStartY,
      });
      if (e.button === 0) this.pointer.dragging = false;
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      this.pointer.wheelDelta += e.deltaY;
    };
    const onContext = (e: Event): void => e.preventDefault();
    const onLockChange = (): void => {
      this.pointerLocked = document.pointerLockElement === this.el;
      this.moveDx = 0;
      this.moveDy = 0;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    el.addEventListener('mousemove', onMouseMove);
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('wheel', onWheel, opts);
    el.addEventListener('contextmenu', onContext);
    document.addEventListener('pointerlockchange', onLockChange);

    this.detach.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      el.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
      document.removeEventListener('pointerlockchange', onLockChange);
    });
  }

  dispose(): void {
    for (const fn of this.detach) fn();
    this.detach = [];
  }

  key(code: string): boolean {
    return this.keys.has(code);
  }

  /** Discrete key-down events since last drain. */
  drainPressed(): string[] {
    const out = this.pressedQueue;
    this.pressedQueue = [];
    return out;
  }

  drainClicks(): ClickEvent[] {
    const out = this.clickQueue;
    this.clickQueue = [];
    return out;
  }

  /** Consume accumulated wheel movement. */
  takeWheel(): number {
    const w = this.pointer.wheelDelta;
    this.pointer.wheelDelta = 0;
    return w;
  }

  /** Consume relative mouse movement (tank aiming). */
  takeMouseMove(): { dx: number; dy: number } {
    const out = { dx: this.moveDx, dy: this.moveDy };
    this.moveDx = 0;
    this.moveDy = 0;
    return out;
  }

  requestPointerLock(): void {
    // may throw or reject without a user gesture (headless/battery runs)
    try {
      const p = this.el?.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* pointer lock unavailable — aiming still works with mouse move */
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function normalizeKey(e: KeyboardEvent): string {
  if (e.key === ' ') return 'Space';
  if (e.key.length === 1) return e.key.toUpperCase();
  return e.key;
}
