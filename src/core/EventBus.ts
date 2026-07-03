/**
 * Typed synchronous event bus. The event map grows with the game's systems;
 * every cross-system notification (combat hits, capture changes, UI cues,
 * audio triggers) travels through here so systems stay decoupled.
 */

export interface GameEvents {
  // lifecycle
  'mission:start': { seed: number; difficulty: string };
  'mission:won': { simTime: number };
  'mission:lost': { simTime: number; reason: string };
  'mode:changed': { mode: 'menu' | 'tactical' | 'tank' };

  // combat (filled in from Phase 3 on)
  'combat:shot': { shooterId: number; side: 'player' | 'enemy'; weapon: string; x: number; y: number; z: number };
  'combat:hit': { targetId: number; damage: number; kind: string; x: number; y: number; z: number };
  'combat:penetrated': { targetId: number; x: number; y: number; z: number };
  'combat:ricochet': { targetId: number; x: number; y: number; z: number };
  'combat:explosion': { x: number; y: number; z: number; radius: number; kind: string };
  'unit:destroyed': { unitId: number; side: 'player' | 'enemy'; type: string; x: number; y: number; z: number };
  'unit:suppressed': { unitId: number };
  'unit:spotted': { unitId: number; side: 'player' | 'enemy' };

  // capture
  'capture:state': { state: string; progress: number };

  // ui
  'ui:click': Record<string, never>;
  'ui:selection': { count: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();
  /** Count of emitted events by name — surfaced in the debug HUD / battery. */
  readonly counts = new Map<string, number>();

  on<K extends keyof GameEvents>(name: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(fn as Handler<never>);
    return () => this.off(name, fn);
  }

  off<K extends keyof GameEvents>(name: K, fn: Handler<GameEvents[K]>): void {
    this.handlers.get(name)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(name: K, payload: GameEvents[K]): void {
    this.counts.set(name as string, (this.counts.get(name as string) ?? 0) + 1);
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of set) (fn as Handler<GameEvents[K]>)(payload);
  }
}
