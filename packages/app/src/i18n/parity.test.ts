import { describe, expect, test } from "bun:test"
import { dict as en } from "./en"
import { dict as ar } from "./ar"
import { dict as br } from "./br"
import { dict as bs } from "./bs"
import { dict as da } from "./da"
import { dict as de } from "./de"
import { dict as es } from "./es"
import { dict as fr } from "./fr"
import { dict as ja } from "./ja"
import { dict as ko } from "./ko"
import { dict as no } from "./no"
import { dict as pl } from "./pl"
import { dict as ru } from "./ru"
import { dict as uk } from "./uk"
import { dict as th } from "./th"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"
import { dict as tr } from "./tr"

const locales = { ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, uk, th, tr, zh, zht } as const
const localeNames = Object.keys(locales) as Array<keyof typeof locales>

const NAMESPACES = ["targetedLearning.", "settings.llm.", "settings.features."] as const

/** Untyped view of a dict, for runtime key iteration. */
const asRecord = (locale: unknown) => locale as Record<string, unknown>

/** All en keys in the DiveeOI namespaces under test, derived at runtime. */
const enDict = en as Record<string, string>
const enKeys = Object.keys(enDict).filter((key) => NAMESPACES.some((ns) => key.startsWith(ns)))

/** Keys a locale must define AND translate (legacy assertion, kept for compat). */
const legacyKeys = ["command.session.previous.unseen", "command.session.next.unseen"] as const

/** Interpolation tokens like {{name}} or {name} that translations must preserve. */
const PLACEHOLDER_RE = /\{\{?\w+\}?\}/g
const placeholders = (value: string) => value.match(PLACEHOLDER_RE)?.sort() ?? []

describe("i18n parity", () => {
  test("en defines the DiveeOI namespaces under test", () => {
    expect(enKeys.length).toBeGreaterThan(100)
    for (const ns of NAMESPACES) {
      expect(enKeys.some((key) => key.startsWith(ns))).toBe(true)
    }
  })

  test("non-English locales translate targeted unseen session keys", () => {
    for (const name of localeNames) {
      const locale = locales[name]
      for (const key of legacyKeys) {
        expect(locale[key]).toBeDefined()
        expect(locale[key]).not.toBe(en[key])
      }
    }
  })

  test("every non-English locale defines every DiveeOI namespace key from en", () => {
    const problems: string[] = []
    for (const name of localeNames) {
      const locale = asRecord(locales[name])
      const missing = enKeys.filter((key) => {
        const value = locale[key]
        return typeof value !== "string" || value.length === 0
      })
      if (missing.length > 0) {
        problems.push(`${name}: missing ${missing.length} key(s) -> ${missing.join(", ")}`)
      }
    }
    expect(problems).toEqual([])
  })

  test("non-English locales do not introduce unknown DiveeOI namespace keys", () => {
    const problems: string[] = []
    for (const name of localeNames) {
      const locale = asRecord(locales[name])
      const extra = Object.keys(locale).filter(
        (key) =>
          NAMESPACES.some((ns) => key.startsWith(ns)) &&
          !Object.prototype.hasOwnProperty.call(en, key),
      )
      if (extra.length > 0) {
        problems.push(`${name}: unknown ${extra.length} key(s) -> ${extra.join(", ")}`)
      }
    }
    expect(problems).toEqual([])
  })

  test("DiveeOI namespace translations preserve every placeholder from en", () => {
    const problems: string[] = []
    for (const name of localeNames) {
      const locale = asRecord(locales[name])
      for (const key of enKeys) {
        const value = locale[key]
        if (typeof value !== "string" || value.length === 0) continue
        const expected = placeholders(enDict[key])
        const actual = placeholders(value)
        if (expected.length !== actual.length || expected.some((p, i) => p !== actual[i])) {
          problems.push(`${name}: ${key} has placeholders [${actual.join(", ")}], en has [${expected.join(", ")}]`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})
