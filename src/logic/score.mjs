export function chainMultiplier(chain) {
  return 2 ** Math.min(chain - 1, 6);
}

export function scoreFor(cleared, chain) {
  return cleared * 10 * chainMultiplier(chain);
}
