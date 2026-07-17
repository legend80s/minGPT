// @ts-check

import assert from "node:assert"
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { chr, concat, minBy, ord, print, range, zip } from "./python-patterns.js"

/** @import { char, int, IToken, ITokenId } from './bpe.type.js' */

/** @typedef {Map<IToken, ITokenId>} TokenTable  */

/**
 * """
    Every possible byte (really an integer 0..255) gets mapped by OpenAI to a unicode
    character that represents it visually. Some bytes have their appearance preserved
    because they don't cause any trouble. These are defined in list bs. For example:
    chr(33) returns "!", so in the returned dictionary we simply have d[33] -> "!".
    However, chr(0), for example, is '\x00', which looks ugly. So OpenAI maps these
    bytes, into new characters in a range where chr() returns a single nice character.
    So in the final dictionary we have d[0] -> 'Ā' instead, which is just chr(0 + 2**8).
    In particular, the space character is 32, which we can see by ord(' '). Instead,
    this function will shift space (32) by 256 to 288, so d[32] -> 'Ġ'.
    So this is just a simple one-to-one mapping of bytes 0..255 into unicode characters
    that "look nice", either in their original form, or a funny shifted character
    like 'Ā', or 'Ġ', etc.
    """
 * @returns {Map<number, string>}
    @example Map(256) {
  33 => '!',
  34 => '"',
  35 => '#',
  36 => '$',
  37 => '%', ...
 */
function bytes_to_unicode() {
  // # the 188 integers that render fine in their original form and need no shifting
  // [33, ...126, 161, ..., 255]
  const bs = concat(
    Array.from(range(ord("!"), ord("~") + 1)),
    Array.from(range(ord("¡"), ord("¬") + 1)),
    Array.from(range(ord("®"), ord("ÿ") + 1)),
  )
  if (bs.length !== 188) {
    throw new Error("bytes_to_unicode: bad range")
  }

  // console.log("bs:", bs)

  const cs = bs.slice() // all integers b in bs will simply map to chr(b) in the output dict
  // now get the representations of the other 68 integers that do need shifting
  // each will get mapped chr(256 + n), where n will grow from 0...67 in the loop

  let n = 0
  for (const b of range(2 ** 8)) {
    if (!bs.includes(b)) {
      // # if this byte is "ugly" then map it to the next available "nice" character
      bs.push(b)
      cs.push(2 ** 8 + n)
      n += 1
    }
  }

  const csChars = cs.map((n) => chr(n))
  const d = new Map(zip(bs, csChars))
  return d
}

class Encoder {
  /**
   *
   * @param {TokenTable} encoder
   * @param {[A: string, B: string][]} bpe_merges
   */
  constructor(encoder, bpe_merges) {
    // # byte encoder/decoder
    this.byte_encoder = bytes_to_unicode()
    // # print(f"{this.byte_encoder=}")
    // # raise TypeError("stop")
    /** @type {Map<string, number>} */
    this.byte_decoder = new Map(Array.from(this.byte_encoder, ([k, v]) => [v, k]))
    // for (const [k, v] of this.byte_encoder.entries()) {
    //     this.byte_decoder.set(v, k)
    // }
    // this.byte_decoder = {v: k for k, v in this.byte_encoder.items()}
    // # bpe token encoder/decoder
    this.encoder = encoder
    this.decoder = new Map(Array.from(this.encoder, ([k, v]) => [v, k])) // {v: k for k, v in this.encoder.items()}
    // # bpe merge list that defines the bpe "tree", of tuples (a,b) that are to merge to token ab
    // # 输出类似：
    // # {
    // #     ('Ġ', 't'): 0,
    // #     ('Ġ', 'a'): 1,
    // #     ('h', 'e'): 2,
    // #     ('i', 'n'): 3,
    // #     ...
    // # }
    /** @type {Map<string, int>} */
    this.bpe_ranks = new Map(Array.from(bpe_merges, (pair, index) => [this._makeKey(pair), index]))
    // # the splitting pattern used for pre-tokenization
    // # Should haved added re.IGNORECASE so BPE merges can happen for capitalized versions of contractions <-- original openai comment
    // """
    // ok so what is this regex looking for, exactly?
    // python re reference: https://docs.python.org/3/library/re.html
    // - the vertical bars | is OR, so re.findall will chunkate text as the pieces match, from left to right
    // - '\'s' would split up things like Andrej's -> (Andrej, 's)
    // - ' ?\p{L}': optional space followed by 1+ unicode code points in the category "letter"
    // - ' ?\p{N}': optional space followed by 1+ unicode code points in the category "number"
    // - ' ?[^\s\p{L}\p{N}]+': optional space, then 1+ things that are NOT a whitespace, letter or number
    // - '\s+(?!\S)': 1+ whitespace characters (e.g. space or tab or etc) UNLESS they are followed by non-whitespace
    //                so this will consume whitespace characters in a sequence but exclude the last whitespace in
    //                that sequence. that last whitespace has the opportunity to then match the optional ' ?' in
    //                earlier patterns.
    // - '\s+': 1+ whitespace characters, intended probably to catch a full trailing sequence of whitespaces at end of string
    // So TLDR:
    // - we are special casing a few common apostrophe constructs ('s, 't, 're, ...) and making those into separate tokens
    // - we then separate out strings into consecutive chunks of 1) letters, 2) numbers, 3) non-letter-numbers, 4) whitespaces
    // """
    this.pat = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu

    /**
     * @type {Map<string, string>}
     */
    this.cache = new Map()
  }

  /**
   * """debugging function, same as encode but returns all intermediate work"""
   * @param {string} text
   */
  encode_and_show_work(text) {
    /** @type {ITokenId[]} */
    const bpe_idx = []

    const parts = []
    const tokens = text.match(this.pat)

    const textEncoder = new TextEncoder()

    // console.log("this.byte_encoder:", this.byte_encoder)

    // @ts-expect-error
    for (const token of tokens) {
      const token_bytes = textEncoder.encode(token) // token.encode("utf-8")
      // token_bytes: Hello → <Buffer 48 65 6c 6c 6f>
      // token_bytes: Hello → Uint8Array(5) [ 72, 101, 108, 108, 111 ]
      // console.log("token_bytes:", token, "→", token_bytes)

      const token_translated = Array.from(token_bytes)
        .map((b) => {
          const token = this.byte_encoder.get(b)
          // console.log("b:", b, "→", token)
          return token
        })
        .join("")
      // console.log("token_translated:", token_translated)
      const token_merged = this.bpe(token_translated).split(" ")

      // console.log("token_translated:", token_translated, "→", token_merged)
      // throw new Error("stop")
      const token_ix = token_merged.map((bpe_token) => this.encoder.get(bpe_token))
      // @ts-expect-error
      bpe_idx.push(...token_ix)
      parts.push({
        token: token,
        token_bytes: token_bytes,
        token_translated: token_translated,
        token_merged: token_merged,
        token_ix: token_ix,
      })
    }
    const out = {
      bpe_idx: bpe_idx, // # the actual output sequence
      tokens, // # result of pre-tokenization
      parts, // # intermediates for each token part
    }
    return out
  }

  /**
   *
   * @param {[char, char]} bigram
   */
  _makeKey(bigram) {
    return String(bigram)
  }

  /**
   *
   * @param {string} token
   * @returns {string}
   */
  bpe(token) {
    // """
    // this function uses this.bpe_ranks to iteratively merge all the possible bpe tokens
    // up the tree. token is a string of one individual 'word' (after regex tokenization)
    // and after byte encoding, e.g. 'Ġthere'.
    // """
    // # token is a string of one individual 'word', after byte encoding, e.g. 'Ġthere'

    // Hello 的合并路径
    // ['l', 'l'] 获胜 word 从 ['H', 'e', 'l', 'l', 'o'] 变为 ['H', 'e', 'll', 'o']。
    // ['e', 'll'] 获胜 word 变为 ['H', 'ell', 'o']。
    // ['ell', 'o'] 获胜 word 变为 ['H', 'ello']
    // ['H', 'ello'] 获胜 word 变为 ['Hello']
    // 当 word 列表中只剩下一个元素时，说明整个单词已被合并为一个最终的token，合并循环结束。

    // # memoization, for efficiency
    if (this.cache.has(token)) {
      // @ts-expect-error
      return this.cache.get(token)
    }

    let word = tuple(token) // # individual characters that make up the token, in a tuple
    let pairs = get_pairs(word) // # get all bigrams
    // print("[bpe]", { token, word, pairs })

    if (pairs.size === 0) {
      return token
    }
    while (true) {
      // # find the next lowest rank bigram that can be merged
      // findBestBigram
      const bestBigram = minBy(pairs, (pair) => this.bpe_ranks.get(this._makeKey(pair)) ?? Infinity)
      // console.log("bigram:", bestBigram)
      if (!bestBigram || !this.bpe_ranks.has(this._makeKey(bestBigram))) {
        // console.log("BREAK")
        break // # no more bigrams are eligible to be merged
      }
      const [first, second] = bestBigram

      // # we will now replace all occurences of (first, second) in the list of current
      // # words into one merged token first_second, in the output list new_words
      /** @type {string[]} */
      let new_word = []
      let i = 0
      while (i < word.length) {
        // # find the next occurence of first in the sequence of current words
        try {
          // word: [ 'H', 'e', 'l', 'l', 'o' ]
          // first = 'H' second = 'e'
          const j = word.indexOf(first, i)
          if (j === -1) {
            const msg = `cannot find first in word starting at ${i}`
            // console.log("msg:", msg)
            throw new Error(msg)
          }
          // console.log("new_word1:", { i, j, new_word })
          new_word.push(...word.slice(i, j))
          // console.log("new_word2:", new_word)
          i = j
        } catch {
          new_word.push(...word.slice(i))
          break
        }
        // # if this occurence is also followed by second, then merge them into one
        if (word[i] === first && i < word.length - 1 && word[i + 1] === second) {
          new_word.push(first + second)
          i += 2
          // console.log("new_word:", new_word, "i+2=", i)
        } else {
          // @ts-expect-error
          new_word.push(word[i])
          // console.log("new_word:", new_word, "i+1=", i)
          i += 1
        }
      }
      // # all occurences of (first, second) have been merged to first_second
      new_word = tuple(new_word)
      word = new_word
      if (word.length === 1) {
        // console.log("break when word.length = 1")
        break
      } else {
        pairs = get_pairs(word)
        // console.log("get_pairs another turn start:", { word, pairs })
      }
    }

    // # concat all words into a string, and use ' ' as the separator. Note that
    // # by now all characters have been byte encoded, guaranteeing that ' ' is
    // # not used in the actual data and is a 'special' delimiter character
    const wordStr = word.join(" ")

    // # cache the result and return
    this.cache.set(token, wordStr)

    return wordStr
  }
}

/**
 * @template T
 * @param {Iterable<T>} arr
 * @returns
 */
function tuple(arr) {
  return Array.from(arr)
}
/**
 *
 * @param {string[]} word
 * @returns {Set<[prev_char: string, char: string]>}
 */
function get_pairs(word) {
  // """
  // Return all bigrams as a set of tuples, of consecutive elements in the iterable word.
  // """
  const pairs = new Set()

  for (let i = 0; i < word.length - 1; i++) {
    pairs.add([word[i], word[i + 1]])
  }
  return pairs
}

/**
 *
 * @param {string} local_file
 * @param {string} remote_file
 */
async function get_file(local_file, remote_file) {
  // """downloads remote_file to local_file if necessary"""
  if (!existsSync(local_file)) {
    print(`downloading ${remote_file} to ${local_file}`)

    const { promise, resolve, reject } = Promise.withResolvers()

    https.get(remote_file, async (response) => {
      // 处理重定向
      if (response.statusCode === 301 || response.statusCode === 302) {
        if (!response.headers.location) {
          reject(new Error("No location header in redirect response"))
        } else {
          resolve(get_file(local_file, response.headers.location))
        }

        return
      }

      // 检查状态码
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`))

        return
      }

      try {
        await pipeline(response, createWriteStream(local_file))
        resolve(local_file)
      } catch (error) {
        reject(error)
      }
    })

    return promise
  }
}
/**
 * @returns {Promise<Encoder>}
 */
async function get_encoder() {
  // """
  // Returns an instance of the GPT BPE Encoder/Decoder
  // and handles caching of "database" files.
  // """
  const home_dir = os.homedir()
  // const home_dir = os.path.expanduser("~")
  const cache_dir = path.join(home_dir, ".cache", "mingpt")

  mkdirSync(cache_dir, { recursive: true })

  // # load encoder.json that has the raw mappings from token -> bpe index
  const encoder_local_file = path.join(cache_dir, "encoder.json")
  const encoder_remote_file =
    "https://openaipublic.blob.core.windows.net/gpt-2/models/124M/encoder.json"

  await get_file(encoder_local_file, encoder_remote_file)

  /** @type {Map<IToken, ITokenId>} */
  const encoder = new Map(Object.entries(JSON.parse(readFileSync(encoder_local_file, "utf-8"))))
  const keyCount = encoder.size
  // 256 individual byte tokens, 50,000 merged tokens, and 1 special <|endoftext|> token
  if (keyCount !== 50257) {
    throw new Error(`Expected encoder length to be 50257, but got ${keyCount}`)
  }

  // # load vocab.bpe that contains the bpe merges, i.e. the bpe tree structure
  // # in the form tuples (a, b), that indicate that (a, b) is to be merged to one token ab
  const vocab_local_file = path.join(cache_dir, "vocab.bpe")
  const vocab_remote_file = "https://openaipublic.blob.core.windows.net/gpt-2/models/124M/vocab.bpe"
  await get_file(vocab_local_file, vocab_remote_file)
  const bpe_data = readFileSync(vocab_local_file, { encoding: "utf-8" })

  // # light postprocessing: strip the version on first line and the last line is a blank
  // bpe_merges = [tuple(merge_str.split()) for merge_str in bpe_data.split("\n")[1:-1]]
  /** @type {[A: string, B: string][]} */
  const bpe_merges = bpe_data
    .split("\n")
    .slice(1, -1)
    .map((merge_str) => {
      const [A, B] = merge_str.split(" ")

      if (A === undefined || B === undefined) {
        throw new Error(
          `Expected A and B to be defined, but got ${A} (type ${typeof A}) and ${B} (type ${typeof B})`,
        )
      }

      return [A, B]
    })
  // assert len(bpe_merges) == 50000  # 50,000 merged tokens
  assert(
    bpe_merges.length === 50000,
    `Expected bpe merges to be 50000, but got ${bpe_merges.length}`,
  )

  // # construct the Encoder object and return
  const enc = new Encoder(encoder, bpe_merges)
  return enc
}

if (import.meta.main) {
  // test get_pairs
  const word = ["H", "e", "l", "l", "o"]
  const expected_pairs = new Set([
    ["H", "e"],
    ["e", "l"],
    ["l", "o"],
    ["l", "l"],
  ])
  const actual_pairs = get_pairs(word)
  console.log("actual_pairs:", actual_pairs)
  assert.deepStrictEqual(actual_pairs, expected_pairs)

  // # here is an encoding example
  const text = "Hello!! I'm Andrej Karpathy. It's 2022. w00t :D 🤗"
  const e = await get_encoder()
  const r = e.encode_and_show_work(text)
  print("Original text is:")
  print(text)

  print("First the text gets pre-tokenized, broken up into chunks, the outcome is:")
  print("tokens", r["tokens"]?.length, r["tokens"])
  // # ['Hello', '!!', ' I', "'m", ' Andrej', ' Karpathy', '.', ' It', "'s", ' 2022', '.', ' w', '00', 't', ' :', 'D', ' 🤗']
  print("Then we iterate over each chunk and process them in turn...")

  assert(r.tokens?.length === 17 && r["parts"].length === 17, "Expected 17 tokens and 17 parts")

  // biome-ignore format: keep one line for easy visual comparison
  assert.deepStrictEqual(r.tokens, ['Hello', '!!', ' I', "'m", ' Andrej', ' Karpathy', '.', ' It', "'s", ' 2022', '.', ' w', '00', 't', ' :', 'D', ' 🤗'])
  print("parts:", r["parts"].length)
  for (const part of r["parts"]) {
    print(part)
  }
  // # {'token': 'Hello', 'token_bytes': b'Hello', 'token_translated': 'Hello', 'token_merged': ['Hello'], 'token_ix': [15496]}
  // # {'token': '!!', 'token_bytes': b'!!', 'token_translated': '!!', 'token_merged': ['!!'], 'token_ix': [3228]}
  // # {'token': ' I', 'token_bytes': b' I', 'token_translated': 'ĠI', 'token_merged': ['ĠI'], 'token_ix': [314]}
  // # {'token': "'m", 'token_bytes': b"'m", 'token_translated': "'m", 'token_merged': ["'m"], 'token_ix': [1101]}
  // # {'token': ' Andrej', 'token_bytes': b' Andrej', 'token_translated': 'ĠAndrej', 'token_merged': ['ĠAndre', 'j'], 'token_ix': [10948, 73]}
  // # {'token': ' Karpathy', 'token_bytes': b' Karpathy', 'token_translated': 'ĠKarpathy', 'token_merged': ['ĠK', 'arp', 'athy'], 'token_ix': [509, 5117, 10036]}
  // # {'token': '.', 'token_bytes': b'.', 'token_translated': '.', 'token_merged': ['.'], 'token_ix': [13]}
  // # {'token': ' It', 'token_bytes': b' It', 'token_translated': 'ĠIt', 'token_merged': ['ĠIt'], 'token_ix': [632]}
  // # {'token': "'s", 'token_bytes': b"'s", 'token_translated': "'s", 'token_merged': ["'s"], 'token_ix': [338]}
  // # {'token': ' 2022', 'token_bytes': b' 2022', 'token_translated': 'Ġ2022', 'token_merged': ['Ġ2022'], 'token_ix': [33160]}
  // # {'token': '.', 'token_bytes': b'.', 'token_translated': '.', 'token_merged': ['.'], 'token_ix': [13]}
  // # {'token': ' w', 'token_bytes': b' w', 'token_translated': 'Ġw', 'token_merged': ['Ġw'], 'token_ix': [266]}
  // # {'token': '00', 'token_bytes': b'00', 'token_translated': '00', 'token_merged': ['00'], 'token_ix': [405]}
  // # {'token': 't', 'token_bytes': b't', 'token_translated': 't', 'token_merged': ['t'], 'token_ix': [83]}
  // # {'token': ' :', 'token_bytes': b' :', 'token_translated': 'Ġ:', 'token_merged': ['Ġ:'], 'token_ix': [1058]}
  // # {'token': 'D', 'token_bytes': b'D', 'token_translated': 'D', 'token_merged': ['D'], 'token_ix': [35]}
  // # {'token': ' 🤗', 'token_bytes': b' \xf0\x9f\xa4\x97', 'token_translated': 'ĠðŁ¤Ĺ', 'token_merged': ['ĠðŁ', '¤', 'Ĺ'], 'token_ix': [12520, 97, 245]}
  // # (refer to the code inside Encoder.encode for what these intermediates are)
  print("and the final outcome is concatenating and flattening all the token_ix:")

  print(r.bpe_idx.length, r.bpe_idx)
  assert(r.bpe_idx.length === 22)
  // biome-ignore format: one line
  assert.deepStrictEqual(r.bpe_idx, [15496, 3228, 314, 1101, 10948, 73, 509, 5117, 10036, 13, 632, 338, 33160, 13, 266, 405, 83, 1058, 35, 12520, 97, 245])
  // # [15496, 3228, 314, 1101, 10948, 73, 509, 5117, 10036, 13, 632, 338, 33160, 13, 266, 405, 83, 1058, 35, 12520, 97, 245]
  // # this would then become the integer input sequence to the transformer
  print("ready to feed into a Transformer!")
}

// const map = new Map()

// const xx = map.keys()
// const yy = new Set().keys()
