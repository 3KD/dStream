#!/usr/bin/env node
import crypto from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const root = process.cwd()
const args = new Set(process.argv.slice(2))
const updateMode = args.has("--update")

const htmlPath = "apps/mobile/www/index.html"
const cssPath = "apps/mobile/www/mobile.css"
const jsPath = "apps/mobile/www/mobile.js"
const goldenPath = "apps/mobile/golden/ui.snapshot.json"

function resolvePath(relPath) {
  return path.resolve(root, relPath)
}

function readRequired(relPath) {
  const fullPath = resolvePath(relPath)
  if (!existsSync(fullPath)) {
    throw new Error(`missing required file: ${relPath}`)
  }
  return readFileSync(fullPath, "utf8")
}

function normalizeText(source) {
  return source.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim()
}

function hashText(source) {
  return `sha256:${crypto.createHash("sha256").update(source).digest("hex")}`
}

function normalizeInlineText(source) {
  return source.replace(/\s+/g, " ").trim()
}

function stripTags(source) {
  return normalizeInlineText(
    source
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
  )
}

function extractButtons(html) {
  const entries = {}
  for (const match of html.matchAll(/<button[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/button>/gi)) {
    entries[match[1]] = stripTags(match[2])
  }
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)))
}

function extractLabels(html) {
  const entries = {}
  for (const match of html.matchAll(/<label[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/label>/gi)) {
    entries[match[1]] = stripTags(match[2])
  }
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)))
}

function extractIdElements(html) {
  const elements = []
  for (const match of html.matchAll(/<([a-z0-9]+)\s+([^>]*\bid="[^"]+"[^>]*)>/gi)) {
    const tag = match[1].toLowerCase()
    const attrs = match[2]
    const idMatch = attrs.match(/\bid="([^"]+)"/i)
    if (!idMatch) continue
    const classMatch = attrs.match(/\bclass="([^"]+)"/i)
    const classes = classMatch
      ? classMatch[1]
          .split(/\s+/g)
          .map((item) => item.trim())
          .filter(Boolean)
          .sort()
      : []
    elements.push({ tag, id: idMatch[1], classes })
  }
  return elements.sort((left, right) => {
    if (left.id !== right.id) return left.id.localeCompare(right.id)
    return left.tag.localeCompare(right.tag)
  })
}

function extractSelectors(css) {
  const selectors = new Set()
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "")
  for (const match of source.matchAll(/(^|})\s*([^@{}][^{}]+?)\s*\{/g)) {
    for (const rawSelector of match[2].split(",")) {
      const selector = normalizeInlineText(rawSelector)
      if (!selector) continue
      selectors.add(selector)
    }
  }
  return Array.from(selectors).sort((left, right) => left.localeCompare(right))
}

function extractMainCopy(html) {
  const title = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "")
  const subtitle = stripTags(html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "")
  return { title, subtitle }
}

function createSnapshot(html, css, js) {
  const normalizedHtml = normalizeText(html)
  const normalizedCss = normalizeText(css)
  const normalizedJs = normalizeText(js)
  return {
    version: 1,
    files: {
      indexHtml: htmlPath,
      mobileCss: cssPath,
      mobileJs: jsPath
    },
    hashes: {
      indexHtml: hashText(normalizedHtml),
      mobileCss: hashText(normalizedCss),
      mobileJs: hashText(normalizedJs)
    },
    copy: {
      ...extractMainCopy(html),
      buttons: extractButtons(html),
      labels: extractLabels(html)
    },
    structure: {
      idElements: extractIdElements(html),
      selectors: extractSelectors(css)
    }
  }
}

function compareArrays(expected, actual, label) {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  const missing = expected.filter((item) => !actualSet.has(item))
  const extra = actual.filter((item) => !expectedSet.has(item))
  const messages = []
  if (missing.length > 0) messages.push(`${label}: missing ${missing.join(", ")}`)
  if (extra.length > 0) messages.push(`${label}: unexpected ${extra.join(", ")}`)
  return messages
}

function summarizeDiff(expected, actual) {
  const messages = []
  const hashKeys = Object.keys(actual.hashes)
  for (const key of hashKeys) {
    if (expected.hashes?.[key] !== actual.hashes[key]) {
      messages.push(`${key} hash changed`)
    }
  }

  if (JSON.stringify(expected.copy?.title ?? "") !== JSON.stringify(actual.copy.title)) {
    messages.push("title text changed")
  }
  if (JSON.stringify(expected.copy?.subtitle ?? "") !== JSON.stringify(actual.copy.subtitle)) {
    messages.push("subtitle text changed")
  }

  const expectedButtonKeys = Object.keys(expected.copy?.buttons ?? {}).sort()
  const actualButtonKeys = Object.keys(actual.copy.buttons).sort()
  messages.push(...compareArrays(expectedButtonKeys, actualButtonKeys, "button ids"))

  const expectedLabelKeys = Object.keys(expected.copy?.labels ?? {}).sort()
  const actualLabelKeys = Object.keys(actual.copy.labels).sort()
  messages.push(...compareArrays(expectedLabelKeys, actualLabelKeys, "label for ids"))

  const expectedIds = (expected.structure?.idElements ?? []).map((item) => item.id).sort()
  const actualIds = actual.structure.idElements.map((item) => item.id).sort()
  messages.push(...compareArrays(expectedIds, actualIds, "DOM ids"))

  const expectedSelectors = expected.structure?.selectors ?? []
  const actualSelectors = actual.structure.selectors
  messages.push(...compareArrays(expectedSelectors, actualSelectors, "CSS selectors"))

  return messages
}

function writeGolden(snapshot) {
  const fullPath = resolvePath(goldenPath)
  mkdirSync(path.dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")
}

function run() {
  const html = readRequired(htmlPath)
  const css = readRequired(cssPath)
  const js = readRequired(jsPath)
  const current = createSnapshot(html, css, js)
  const fullGoldenPath = resolvePath(goldenPath)

  if (updateMode) {
    writeGolden(current)
    console.log(`mobile UI golden updated: ${goldenPath}`)
    return
  }

  if (!existsSync(fullGoldenPath)) {
    console.error(`missing golden snapshot: ${goldenPath}`)
    console.error("run: npm run check:mobile:golden:update")
    process.exit(1)
  }

  let expected
  try {
    expected = JSON.parse(readFileSync(fullGoldenPath, "utf8"))
  } catch {
    console.error(`invalid JSON: ${goldenPath}`)
    process.exit(1)
  }

  if (JSON.stringify(expected) === JSON.stringify(current)) {
    console.log("mobile UI golden check: PASS")
    return
  }

  const messages = summarizeDiff(expected, current)
  console.error("mobile UI golden mismatch:")
  for (const message of messages) console.error(` - ${message}`)
  console.error("if intentional, run: npm run check:mobile:golden:update")
  process.exit(1)
}

run()
