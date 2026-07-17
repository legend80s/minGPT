/** @import { int, IToken, ITokenId } from './bpe.type.js' */

import { Console } from "node:console"

/**
 *
 * @param  {...unknown} args
 */
export function print(...args) {
  const oneLineConsole = new Console({
    stdout: process.stdout,
    stderr: process.stderr,

    inspectOptions: { breakLength: Infinity, compact: true },
  })

  oneLineConsole.log(...args)
}

if (import.meta.main) {
  // should print on one line, just like Python `print` does
  print([
    "Hello",
    "!!",
    " I",
    "'m",
    " Andrej",
    " Karpathy",
    ".",
    " It",
    "'s",
    " 2022",
    ".",
    " w",
    "00",
    "t",
    " :",
    "D",
    " 🤗",
  ])
}

/**
 * @template T, U
 * @param {T[]} arr1
 * @param {U[]} arr2
 * @returns {[T, U][]}
 */
export function zip(arr1, arr2) {
  if (arr1.length !== arr2.length) {
    throw new Error("zip: arrays must be the same length")
  }

  return arr1.map((_, i) => {
    /** @type {T} */
    // @ts-expect-error
    const a = arr1[i]
    /** @type {U} */
    // @ts-expect-error
    const b = arr2[i]

    return [a, b]
  })
}

/**
 * @template T
 * @param  {...T[]} arrs
 * @returns
 */
export function concat(...arrs) {
  return arrs.reduce((a, b) => a.concat(b), [])
}

/**
 *
 * @param {int} n
 * @returns
 */
export function chr(n) {
  return String.fromCharCode(n)
}

/**
 *
 * @param {string} char
 * @returns
 */
export function ord(char) {
  return char.charCodeAt(0)
}

/**
 *
 * @param {int} start
 * @param {int | undefined} [stop]
 */
export function* range(start, stop) {
  if (stop === undefined) {
    stop = start
    start = 0
  }

  for (let i = start; i < stop; i++) {
    yield i
  }
}

/**
 * bigram = min(pairs, key=lambda pair: self.bpe_ranks.get(pair, float("inf")))
 * @template T
 * @param {Set<T>} set
 * @param {(item: T) => number} fn
 * @returns
 */
export function minBy(set, fn) {
  // 时间复杂度 O(n) + O(n)，空间复杂度 O(n)
  // return arr.reduce((a, b) => fn(a) < fn(b) ? a : b)
  // let [min, ...rest] = set

  // for (const item of rest) {
  //   // @ts-expect-error
  //   if (fn(item) < fn(min)) {
  //     min = item
  //   }
  // }

  // 时间复杂度 O(n)，空间复杂度 O(1)
  const iterator = set.values()
  let min = iterator.next().value
  for (const item of iterator) {
    // console.log(item, "→", fn(item), min, "→", fn(min))
    // @ts-expect-error
    if (fn(item) < fn(min)) {
      min = item
    }
  }

  return min
}
