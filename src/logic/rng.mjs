import { COLOR_COUNT } from './constants.mjs';

export function makeRng(seed) {
  let value = seed >>> 0;
  const rng = () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  // Fork the current generator position without consuming the original.
  rng.clone = () => makeRng(value);
  return rng;
}

export function randomPair(rng) {
  return [1 + Math.floor(rng() * COLOR_COUNT), 1 + Math.floor(rng() * COLOR_COUNT)];
}
