/**
 * HUD root container. Owns the DOM layer that tactical and tank HUDs mount
 * into. Phase 0 provides the shell; later phases attach the real panels.
 */

export class Hud {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud-root';
    this.root.dataset['instrument'] = 'field';
    parent.append(this.root);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  clear(): void {
    this.root.replaceChildren();
  }
}
