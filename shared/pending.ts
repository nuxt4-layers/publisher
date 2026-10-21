/**
 * PRIVATE scaffolding while the layer is built test-first: marks a function
 * the contract specifies whose implementation is still to come. Never
 * exported from the contract; `tests/contracts.test.ts` fails while any
 * file still calls it, so version 1.0.0 cannot ship with one.
 */
export function pending(name: string): never {
  throw new Error(`Not implemented yet: ${name}`)
}
