export const MAX_VISIBLE_COMMAND_PATHS = 3;

export function commandPathBudget(selectionSize: number): number {
  const count = Math.max(0, Math.floor(selectionSize));
  return count > MAX_VISIBLE_COMMAND_PATHS ? 0 : count;
}
