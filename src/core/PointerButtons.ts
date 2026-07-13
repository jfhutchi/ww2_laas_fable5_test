/** Convert MouseEvent.button indices into MouseEvent.buttons bit masks. */
export function pointerButtonMask(button: number): number {
  if (button === 0) return 1;
  if (button === 1) return 4;
  if (button === 2) return 2;
  return 0;
}
