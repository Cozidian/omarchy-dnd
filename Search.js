.pragma library

var KIND_ALIASES = {
  spell: "spell",
  spells: "spell",
  monster: "monster",
  monsters: "monster",
  creature: "monster",
  creatures: "monster",
  condition: "condition",
  conditions: "condition",
  rule: "rule",
  rules: "rule",
  feat: "feat",
  feats: "feat",
  item: "item",
  items: "item",
  gear: "item",
  equipment: "item",
  weapon: "weapon",
  weapons: "weapon",
  weap: "weapon",
  armor: "armor",
  armour: "armor",
  shield: "armor",
  shields: "armor",
  magic: "magic",
  mag: "magic",
  magicitem: "magic",
  magicitems: "magic",
  wondrous: "magic"
}

var KINDS = {
  spell: true,
  monster: true,
  condition: true,
  rule: true,
  feat: true,
  item: true,
  weapon: true,
  armor: true,
  magic: true
}

var MAX_INDEX_BYTES = 4 * 1024 * 1024
var MAX_ENTRIES = 4000
var MAX_NAME_CHARS = 120
var MAX_SUMMARY_CHARS = 280
var MAX_BODY_CHARS = 16 * 1024
var MAX_TAGS_CHARS = 240
var MAX_HAYSTACK_CHARS = 1024
var MAX_FILTER_CHARS = 120
var MAX_RESULTS = 80
var MAX_RECENTS = 8
var MAX_PINS = 8
var MAX_STATE_BYTES = 16 * 1024
var MAX_BODY_BLOCKS = 80
var MAX_TABLE_ROWS = 40
var MAX_TABLE_COLS = 12
var MAX_CELL_CHARS = 480
var MAX_LIST_ITEMS = 48

var SECTION_HEADINGS = {
  Traits: true,
  Actions: true,
  "Bonus actions": true,
  Reactions: true,
  "Legendary actions": true
}

function stripMarkup(value) {
  var s = String(value || "")
  s = s.replace(/<!--[\s\S]*?-->/g, "")
  s = s.replace(/<[^>]*>/g, "")
  s = s.replace(/<[^>]*$/g, "")
  return s
}

function stripControls(value, allowNewlines) {
  var s = String(value || "")
  var out = ""
  for (var i = 0; i < s.length; i++) {
    var code = s.charCodeAt(i)
    if (code === 0x09) {
      if (allowNewlines)
        out += " "
      continue
    }
    if (code === 0x0A || code === 0x0D) {
      if (allowNewlines)
        out += "\n"
      continue
    }
    if (code < 0x20 || (code >= 0x7F && code <= 0x9F))
      continue
    if (code === 0x200B || code === 0x200C || code === 0x200D || code === 0x200E || code === 0x200F)
      continue
    if (code >= 0x202A && code <= 0x202E)
      continue
    if (code >= 0x2066 && code <= 0x2069)
      continue
    if (code === 0xFEFF || code === 0xFFF9 || code === 0xFFFA || code === 0xFFFB || code === 0xFFFC)
      continue
    out += s.charAt(i)
  }
  return out
}

function sanitizeText(value, allowNewlines, maxChars) {
  var s = stripControls(stripMarkup(value), allowNewlines)
  if (allowNewlines)
    s = s.replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/g, "")
  else
    s = s.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "")
  var cap = maxChars > 0 ? maxChars : 0
  if (cap && s.length > cap)
    s = s.slice(0, cap)
  return s
}

function sanitizeFilter(value) {
  var s = stripControls(stripMarkup(value), false)
  s = s.replace(/\s+/g, " ").replace(/^\s+/g, "")
  if (s.length > MAX_FILTER_CHARS)
    s = s.slice(0, MAX_FILTER_CHARS)
  return s
}

function haystackFor(name, tags, body) {
  var s = (name + " " + tags + " " + body).toLowerCase()
  if (s.length > MAX_HAYSTACK_CHARS)
    s = s.slice(0, MAX_HAYSTACK_CHARS)
  return s
}

function parseIndex(raw) {
  var text = String(raw || "")
  if (!text || text.length > MAX_INDEX_BYTES)
    return []
  try {
    var parsed = JSON.parse(text)
  } catch (e) {
    return []
  }
  if (!parsed || !Array.isArray(parsed.entries))
    return []
  var src = parsed.entries
  var out = []
  for (var i = 0; i < src.length && out.length < MAX_ENTRIES; i++) {
    var row = src[i]
    if (!row || typeof row !== "object")
      continue
    var kind = String(row.kind || "")
    if (!KINDS[kind])
      continue
    var name = sanitizeText(row.name, false, MAX_NAME_CHARS)
    var body = sanitizeText(row.body, true, MAX_BODY_CHARS)
    if (!name || !body)
      continue
    var summary = sanitizeText(row.summary, false, MAX_SUMMARY_CHARS)
    var tags = sanitizeText(row.tags, false, MAX_TAGS_CHARS).toLowerCase()
    out.push({
      kind: kind,
      name: name,
      summary: summary,
      body: body,
      tags: tags,
      haystack: haystackFor(name, tags, body)
    })
  }
  return out
}

function resolveKindToken(token) {
  var t = String(token || "").toLowerCase()
  if (!t)
    return ""
  if (KIND_ALIASES[t])
    return KIND_ALIASES[t]
  if (t.length < 2)
    return ""
  var found = ""
  for (var alias in KIND_ALIASES) {
    if (alias.indexOf(t) !== 0)
      continue
    var kind = KIND_ALIASES[alias]
    if (!found)
      found = kind
    else if (found !== kind)
      return ""
  }
  return found
}

function parseQuery(text) {
  var query = sanitizeFilter(text).toLowerCase()
  var kind = ""
  var rest = query.replace(/^\s+|\s+$/g, "")
  var spaced = query.match(/^(\S+)[:\s]+(.*)$/)
  if (spaced) {
    kind = resolveKindToken(spaced[1])
    if (kind)
      rest = String(spaced[2] || "").replace(/^\s+|\s+$/g, "")
  }
  return { kind: kind, text: rest, raw: query }
}

function wordHasPrefix(words, token) {
  for (var i = 0; i < words.length; i++)
    if (words[i].indexOf(token) === 0)
      return true
  return false
}

function tokensMatchInOrder(words, tokens) {
  var wi = 0
  for (var t = 0; t < tokens.length; t++) {
    var found = false
    for (; wi < words.length; wi++) {
      if (words[wi].indexOf(tokens[t]) === 0) {
        found = true
        wi++
        break
      }
    }
    if (!found)
      return false
  }
  return true
}

function scoreTokens(entry, tokens) {
  var name = String(entry.name || "").toLowerCase()
  var words = name.split(/\s+/)
  var hay = String(entry.haystack || "")
  if (tokensMatchInOrder(words, tokens))
    return 2
  var t
  var allInName = true
  for (t = 0; t < tokens.length; t++) {
    if (name.indexOf(tokens[t]) < 0)
      allInName = false
  }
  if (allInName)
    return 3
  for (t = 0; t < tokens.length; t++) {
    if (hay.indexOf(tokens[t]) < 0)
      return -1
  }
  return 5
}

function scoreEntry(entry, kind, needle) {
  if (kind && entry.kind !== kind)
    return -1
  if (!needle) {
    if (kind)
      return 50
    return entry.kind === "condition" ? 10 : -1
  }
  var tokens = needle.split(/\s+/)
  if (tokens.length > 8)
    tokens = tokens.slice(0, 8)
  if (tokens.length > 1)
    return scoreTokens(entry, tokens)
  var name = String(entry.name || "").toLowerCase()
  if (name === needle)
    return 0
  if (name.indexOf(needle) === 0)
    return 1
  var words = name.split(/\s+/)
  if (wordHasPrefix(words, needle))
    return 2
  if (name.indexOf(needle) >= 0)
    return 3
  var hay = String(entry.haystack || "")
  if (hay.indexOf(needle) >= 0)
    return entry.tags && String(entry.tags).indexOf(needle) >= 0 ? 4 : 5
  return -1
}

function decorate(entry, group, pinned) {
  if (!entry)
    return null
  return {
    kind: entry.kind,
    name: entry.name,
    summary: entry.summary,
    body: entry.body,
    group: group || "",
    pinned: pinned ? 1 : 0
  }
}

function entryRef(kind, name) {
  var k = String(kind || "")
  if (!KINDS[k])
    return null
  var n = sanitizeText(name, false, MAX_NAME_CHARS)
  if (!n)
    return null
  return { kind: k, name: n }
}

function refKey(ref) {
  if (!ref)
    return ""
  return String(ref.kind || "") + "\0" + String(ref.name || "").toLowerCase()
}

function sameRefs(a, b) {
  if (!a || !b || a.length !== b.length)
    return false
  for (var i = 0; i < a.length; i++) {
    if (!a[i] || !b[i] || a[i].kind !== b[i].kind || a[i].name !== b[i].name)
      return false
  }
  return true
}

function parseRefList(value, cap) {
  if (!Array.isArray(value))
    return []
  var limit = cap > 0 ? cap : MAX_RECENTS
  var out = []
  var seen = {}
  for (var i = 0; i < value.length && out.length < limit; i++) {
    var row = value[i]
    if (!row || typeof row !== "object")
      continue
    var ref = entryRef(row.kind, row.name)
    if (!ref)
      continue
    var key = refKey(ref)
    if (seen[key])
      continue
    seen[key] = true
    out.push(ref)
  }
  return out
}

function parseState(raw) {
  var empty = { pins: [], recents: [] }
  var text = String(raw || "")
  if (!text || text.length > MAX_STATE_BYTES)
    return empty
  try {
    var parsed = JSON.parse(text)
  } catch (e) {
    return empty
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return empty
  return {
    pins: parseRefList(parsed.pins, MAX_PINS),
    recents: parseRefList(parsed.recents, MAX_RECENTS)
  }
}

function serializeState(pins, recents) {
  return JSON.stringify({
    version: 1,
    pins: parseRefList(pins, MAX_PINS),
    recents: parseRefList(recents, MAX_RECENTS)
  }) + "\n"
}

function findEntry(entries, kind, name) {
  var ref = entryRef(kind, name)
  if (!ref)
    return null
  var list = entries || []
  var want = ref.name.toLowerCase()
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].kind === ref.kind && String(list[i].name || "").toLowerCase() === want)
      return list[i]
  }
  return null
}

function isPinned(pins, kind, name) {
  var ref = entryRef(kind, name)
  if (!ref)
    return false
  var list = pins || []
  var key = refKey(ref)
  for (var i = 0; i < list.length; i++) {
    if (refKey(list[i]) === key)
      return true
  }
  return false
}

function rememberRef(recents, kind, name) {
  var ref = entryRef(kind, name)
  var list = recents || []
  if (!ref)
    return list
  var out = [ref]
  var key = refKey(ref)
  for (var i = 0; i < list.length && out.length < MAX_RECENTS; i++) {
    if (!list[i] || refKey(list[i]) === key)
      continue
    out.push({ kind: list[i].kind, name: list[i].name })
  }
  return out
}

function togglePin(pins, kind, name) {
  var ref = entryRef(kind, name)
  var list = pins || []
  if (!ref)
    return list
  var key = refKey(ref)
  var out = []
  var found = false
  for (var i = 0; i < list.length; i++) {
    if (!list[i])
      continue
    if (refKey(list[i]) === key) {
      found = true
      continue
    }
    out.push({ kind: list[i].kind, name: list[i].name })
  }
  if (!found) {
    if (out.length >= MAX_PINS)
      return list
    out.push(ref)
  }
  return out
}

function composeEmptyQuery(entries, pins, recents) {
  var list = entries || []
  var pinRefs = pins || []
  var recentRefs = recents || []
  var grouped = pinRefs.length > 0 || recentRefs.length > 0
  var out = []
  var seen = {}

  function push(entry, group, pinned) {
    if (!entry)
      return
    var key = String(entry.kind || "") + "\0" + String(entry.name || "").toLowerCase()
    if (seen[key])
      return
    seen[key] = true
    out.push(decorate(entry, grouped ? group : "", pinned))
  }

  var i
  for (i = 0; i < pinRefs.length; i++)
    push(findEntry(list, pinRefs[i].kind, pinRefs[i].name), "Pinned", true)
  for (i = 0; i < recentRefs.length; i++)
    push(findEntry(list, recentRefs[i].kind, recentRefs[i].name), "Recent", false)
  for (i = 0; i < list.length; i++) {
    if (list[i] && list[i].kind === "condition")
      push(list[i], "Conditions", false)
  }
  return out
}

function filterEntries(entries, text, limit, pins, recents) {
  var parsed = parseQuery(text)
  var cap = limit > 0 ? limit : MAX_RESULTS
  var list = entries || []
  if (list.length > MAX_ENTRIES)
    list = list.slice(0, MAX_ENTRIES)
  if (!parsed.kind && !parsed.text)
    return composeEmptyQuery(list, pins, recents)
  var scored = []
  for (var i = 0; i < list.length; i++) {
    var entry = list[i]
    var score = scoreEntry(entry, parsed.kind, parsed.text)
    if (score < 0)
      continue
    scored.push({ score: score, index: i, entry: entry })
  }
  scored.sort(function(a, b) {
    if (a.score !== b.score)
      return a.score - b.score
    var an = String(a.entry.name || "").toLowerCase()
    var bn = String(b.entry.name || "").toLowerCase()
    if (an < bn)
      return -1
    if (an > bn)
      return 1
    return 0
  })
  var out = []
  for (var j = 0; j < scored.length && out.length < cap; j++)
    out.push(decorate(scored[j].entry, "", isPinned(pins, scored[j].entry.kind, scored[j].entry.name)))
  return out
}

function kindLabel(kind) {
  if (kind === "spell")
    return "Spell"
  if (kind === "monster")
    return "Monster"
  if (kind === "condition")
    return "Condition"
  if (kind === "rule")
    return "Rule"
  if (kind === "feat")
    return "Feat"
  if (kind === "item")
    return "Item"
  if (kind === "weapon")
    return "Weapon"
  if (kind === "armor")
    return "Armor"
  if (kind === "magic")
    return "Magic"
  return "Entry"
}

function stripEmphasis(value) {
  var s = String(value || "")
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, "$1")
  s = s.replace(/\*([\s\S]+?)\*/g, "$1")
  s = s.replace(/_([^_]+)_/g, "$1")
  return s
}

function isSeparatorCell(cell) {
  return /^:?-+:?$/.test(String(cell || "").replace(/\s+/g, ""))
}

function isSeparatorRow(cells) {
  if (!cells || cells.length < 2)
    return false
  for (var i = 0; i < cells.length; i++) {
    if (!isSeparatorCell(cells[i]))
      return false
  }
  return true
}

function splitTableRow(line) {
  var s = String(line || "").replace(/^\s+|\s+$/g, "")
  if (!s)
    return null
  if (s.charAt(0) === "|")
    s = s.slice(1)
  if (s.charAt(s.length - 1) === "|")
    s = s.slice(0, -1)
  var parts = s.split("|")
  var cells = []
  for (var i = 0; i < parts.length && cells.length < MAX_TABLE_COLS; i++) {
    var cell = stripEmphasis(sanitizeText(parts[i], false, MAX_CELL_CHARS))
    cells.push(cell)
  }
  return cells
}

function looksLikeTableRow(line) {
  var s = String(line || "").replace(/^\s+|\s+$/g, "")
  if (!s || s.charAt(0) !== "|")
    return false
  var cells = splitTableRow(s)
  return !!(cells && cells.length >= 2)
}

function parseTableCaption(line) {
  var s = String(line || "").replace(/^\s+|\s+$/g, "")
  if (s.indexOf("Table:") !== 0)
    return ""
  return sanitizeText(s.replace(/^Table:\s*/, ""), false, 120)
}

function parseHeading(line) {
  var s = String(line || "").replace(/^\s+|\s+$/g, "")
  if (SECTION_HEADINGS[s])
    return { kind: "heading", text: s, level: 2 }
  var match = s.match(/^(#{1,6})\s+(.+)$/)
  if (!match)
    return null
  var text = sanitizeText(match[2], false, 200)
  if (!text)
    return null
  return { kind: "heading", text: text, level: match[1].length }
}

function parseListItem(line) {
  var s = String(line || "").replace(/\s+$/g, "")
  var match = s.match(/^\s*([-*•])\s+(.*\S.*)$/)
  if (match)
    return { ordered: false, text: match[2] }
  match = s.match(/^\s*(\d+)\.\s+(.*\S.*)$/)
  if (match)
    return { ordered: true, text: match[2] }
  match = s.match(/^\s*\*([A-Z].+)$/)
  if (match)
    return { ordered: false, text: match[1] }
  return null
}

function splitLabeledText(text) {
  var s = stripEmphasis(sanitizeText(text, true, MAX_CELL_CHARS))
  s = s.replace(/^\s+|\s+$/g, "")
  var match = s.match(/^(.{1,42}[.!?])\s+([A-Z][\s\S]*)$/)
  if (!match)
    return { label: "", body: s }
  return { label: match[1], body: match[2] }
}

function parseListAt(lines, start) {
  var first = parseListItem(lines[start])
  if (!first)
    return null
  var ordered = first.ordered
  var items = []
  var i = start
  while (i < lines.length && items.length < MAX_LIST_ITEMS) {
    var trimmed = String(lines[i] || "").replace(/^\s+|\s+$/g, "")
    if (!trimmed) {
      var next = nextNonEmptyLine(lines, i + 1)
      var peeked = next < lines.length ? parseListItem(lines[next]) : null
      if (peeked && peeked.ordered === ordered) {
        i = next
        continue
      }
      break
    }
    var item = parseListItem(lines[i])
    if (!item || item.ordered !== ordered)
      break
    var split = splitLabeledText(item.text)
    items.push({
      label: split.label,
      body: split.body,
      marker: ordered ? String(items.length + 1) : "•"
    })
    i++
  }
  if (!items.length)
    return null
  return { block: { kind: "list", ordered: ordered, items: items }, end: i }
}

function parseQuoteAt(lines, start) {
  if (!/^\s*>/.test(String(lines[start] || "")))
    return null
  var bits = []
  var i = start
  while (i < lines.length) {
    var match = String(lines[i] || "").match(/^\s*>\s?(.*)$/)
    if (!match)
      break
    bits.push(match[1])
    i++
  }
  if (!bits.length)
    return null
  var text = stripEmphasis(sanitizeText(bits.join("\n"), true, MAX_BODY_CHARS))
  var parts = text.split("\n")
  var title = ""
  var body = text
  if (parts.length > 1 && String(parts[0] || "").length <= 40) {
    title = String(parts[0] || "").replace(/^\s+|\s+$/g, "")
    body = parts.slice(1).join("\n").replace(/^\s+|\s+$/g, "")
  }
  return { block: { kind: "quote", caption: title, text: body }, end: i }
}

function parseHigherLevel(line) {
  var s = String(line || "").replace(/^\s+|\s+$/g, "")
  var match = s.match(/^\*{0,2}At higher levels\.?\*{0,2}\s+(.*)$/i)
  if (!match || !match[1])
    return null
  return {
    kind: "quote",
    caption: "At higher levels",
    text: stripEmphasis(sanitizeText(match[1], true, MAX_BODY_CHARS))
  }
}

function prettyStatLabel(label) {
  var s = String(label || "")
  if (/^casting time$/i.test(s))
    return "Casting time"
  if (/^range$/i.test(s))
    return "Range"
  if (/^duration$/i.test(s))
    return "Duration"
  if (/^components$/i.test(s))
    return "Components"
  if (/^classes$/i.test(s))
    return "Classes"
  if (/^prerequisite$/i.test(s))
    return "Prerequisite"
  if (/^category$/i.test(s))
    return "Category"
  if (/^damage$/i.test(s))
    return "Damage"
  if (/^cost$/i.test(s))
    return "Cost"
  if (/^weight$/i.test(s))
    return "Weight"
  if (/^rarity$/i.test(s))
    return "Rarity"
  if (/^attunement$/i.test(s))
    return "Attunement"
  if (/^properties$/i.test(s))
    return "Properties"
  if (/^ac$/i.test(s))
    return "AC"
  if (/^stealth$/i.test(s))
    return "Stealth"
  if (/^strength$/i.test(s))
    return "Strength"
  return s
}

function parseStatLine(line) {
  var s = String(line || "").replace(/^\s+|\s+$/g, "")
  if (!s)
    return null
  var match = s.match(/^(Casting time|Range|Duration|Components|Classes|Prerequisite|Category|Damage|Cost|Weight|Rarity|Attunement|Properties|AC|Stealth|Strength):\s*(.+)$/i)
  if (match)
    return { label: prettyStatLabel(match[1]), value: sanitizeText(match[2], false, 200) }
  if (/^(Cantrip|Level\s+\d+)\b/i.test(s) && s.length < 48)
    return { label: "School", value: sanitizeText(s, false, 80) }
  if (/^(concentration|ritual)(\s*·\s*(concentration|ritual))?$/i.test(s))
    return { label: "Tags", value: sanitizeText(s, false, 40) }
  if (/^(General|Origin|Fighting Style|Epic Boon)$/i.test(s))
    return { label: "Type", value: sanitizeText(s, false, 40) }
  if (/^AC\s+\S/.test(s) && s.indexOf("·") >= 0)
    return { label: "Combat", value: sanitizeText(s, false, 160) }
  if (s.length < 80 && /\bCR\s+/.test(s) && /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\b/i.test(s))
    return { label: "Profile", value: sanitizeText(s, false, 120) }
  return null
}

function parseStatsAt(lines, start) {
  var rows = []
  var i = start
  while (i < lines.length && rows.length < 12) {
    var trimmed = String(lines[i] || "").replace(/^\s+|\s+$/g, "")
    if (!trimmed) {
      if (rows.length) {
        i++
        break
      }
      break
    }
    var row = parseStatLine(trimmed)
    if (!row)
      break
    rows.push(row)
    i++
  }
  if (!rows.length)
    return null
  if (rows.length === 1 && rows[0].label === "Type")
    return null
  return { block: { kind: "stats", rows: rows }, end: i }
}

function parseLabeledRun(lines, start) {
  var items = []
  var i = start
  while (i < lines.length && items.length < MAX_LIST_ITEMS) {
    var trimmed = String(lines[i] || "").replace(/^\s+|\s+$/g, "")
    if (!trimmed)
      break
    if (parseListItem(lines[i]) || parseHeading(trimmed) || looksLikeTableRow(trimmed) || /^\s*>/.test(String(lines[i] || "")))
      break
    var split = splitLabeledText(trimmed)
    if (!split.label)
      break
    items.push({ label: split.label, body: split.body, marker: "•" })
    i++
  }
  if (items.length < 2) {
    if (items.length !== 1)
      return null
    var prev = start - 1
    while (prev >= 0 && String(lines[prev] || "").replace(/^\s+|\s+$/g, "") === "")
      prev--
    if (prev < 0 || !parseHeading(lines[prev]))
      return null
  }
  return { block: { kind: "list", ordered: false, items: items }, end: i }
}

function isCollapsedTableLine(line) {
  var s = String(line || "")
  if (!/\|[\s]*:?-{3,}:?[\s]*\|/.test(s))
    return false
  var cells = splitTableRow(s)
  if (!cells || cells.length < 4)
    return false
  var nonSep = 0
  for (var i = 0; i < cells.length; i++) {
    if (cells[i] && !isSeparatorCell(cells[i]))
      nonSep++
  }
  return nonSep >= 2
}

function expandCollapsedLine(line) {
  if (!isCollapsedTableLine(line))
    return line
  var s = String(line || "")
  s = s.replace(/\s+(Table:)/g, "\n$1")
  s = s.replace(/\|\s+\|/g, "|\n|")
  s = s.replace(/(Table:\s*[^|\n]+)\s*\|/g, "$1\n|")
  return s
}

function expandCollapsedTables(text) {
  var lines = String(text || "").split("\n")
  var out = []
  for (var i = 0; i < lines.length; i++)
    out.push(expandCollapsedLine(lines[i]))
  return out.join("\n")
}

function nextNonEmptyLine(lines, start) {
  var i = start
  while (i < lines.length && String(lines[i] || "").replace(/^\s+|\s+$/g, "") === "")
    i++
  return i
}

function columnWeights(headers, rows) {
  var cols = headers.length
  var maxLens = []
  var c
  var r
  var n
  var w
  var sum = 0
  var weights = []
  if (cols < 1)
    return weights
  for (c = 0; c < cols; c++)
    maxLens[c] = String(headers[c] || "").length
  for (r = 0; r < rows.length; r++) {
    for (c = 0; c < cols; c++) {
      n = String((rows[r] || [])[c] || "").length
      if (n > maxLens[c])
        maxLens[c] = n
    }
  }
  for (c = 0; c < cols; c++) {
    w = Math.max(3, Math.min(36, Math.sqrt(maxLens[c] * 6)))
    if (maxLens[c] <= 4)
      w = Math.max(2.4, w * 0.72)
    weights[c] = w
    sum += w
  }
  if (sum <= 0) {
    for (c = 0; c < cols; c++)
      weights[c] = 1 / cols
    return weights
  }
  for (c = 0; c < cols; c++)
    weights[c] = weights[c] / sum
  return weights
}

function parseMarkdownTable(lines, headerIndex, caption) {
  if (headerIndex < 0 || headerIndex + 1 >= lines.length)
    return null
  var headerCells = splitTableRow(lines[headerIndex])
  var sepCells = splitTableRow(lines[headerIndex + 1])
  if (!headerCells || !sepCells || !isSeparatorRow(sepCells))
    return null
  var colCount = Math.min(MAX_TABLE_COLS, headerCells.length)
  if (colCount < 2)
    return null
  headerCells = headerCells.slice(0, colCount)
  var rows = []
  var leftover = ""
  var i = headerIndex + 2
  while (i < lines.length && rows.length < MAX_TABLE_ROWS) {
    if (!looksLikeTableRow(lines[i]))
      break
    var cells = splitTableRow(lines[i])
    if (!cells)
      break
    if (isSeparatorRow(cells)) {
      i++
      continue
    }
    if (cells.length > colCount) {
      leftover = sanitizeText(cells.slice(colCount).join(" "), true, MAX_BODY_CHARS)
      cells = cells.slice(0, colCount)
    }
    while (cells.length < colCount)
      cells.push("")
    rows.push(cells)
    i++
    if (leftover)
      break
  }
  if (!rows.length)
    return null
  return {
    block: {
      kind: "table",
      caption: caption || "",
      colCount: colCount,
      headers: headerCells,
      rows: rows,
      weights: columnWeights(headerCells, rows)
    },
    end: i,
    leftover: leftover
  }
}

function bodyBlocks(body) {
  var text = sanitizeText(body, true, MAX_BODY_CHARS)
  if (!text)
    return []
  text = expandCollapsedTables(text)
  var lines = text.split("\n")
  var out = []
  var buf = []
  var i = 0

  function flush() {
    var chunk = buf.join("\n").replace(/^\s+|\s+$/g, "")
    buf = []
    if (!chunk)
      return
    out.push({ kind: "text", text: stripEmphasis(chunk) })
  }

  while (i < lines.length && out.length < MAX_BODY_BLOCKS) {
    if (out.length === MAX_BODY_BLOCKS - 1) {
      buf = buf.concat(lines.slice(i))
      break
    }
    var line = lines[i]
    if (out.length === 0 && buf.length === 0) {
      var stats = parseStatsAt(lines, i)
      if (stats) {
        out.push(stats.block)
        i = stats.end
        continue
      }
    }
    var caption = parseTableCaption(line)
    var heading = parseHeading(line)
    var headerIndex = -1
    var tableCaption = ""
    if (caption) {
      var afterCaption = nextNonEmptyLine(lines, i + 1)
      if (afterCaption < lines.length && looksLikeTableRow(lines[afterCaption]) && afterCaption + 1 < lines.length && isSeparatorRow(splitTableRow(lines[afterCaption + 1]))) {
        headerIndex = afterCaption
        tableCaption = caption
      }
    } else if (looksLikeTableRow(line) && i + 1 < lines.length && isSeparatorRow(splitTableRow(lines[i + 1]))) {
      headerIndex = i
    }
    if (headerIndex >= 0) {
      var parsed = parseMarkdownTable(lines, headerIndex, tableCaption)
      if (parsed) {
        flush()
        out.push(parsed.block)
        i = parsed.end
        if (parsed.leftover)
          buf.push(parsed.leftover)
        continue
      }
    }
    if (heading) {
      flush()
      out.push(heading)
      i++
      continue
    }
    var quote = parseQuoteAt(lines, i)
    if (quote) {
      flush()
      out.push(quote.block)
      i = quote.end
      continue
    }
    var higher = parseHigherLevel(line)
    if (higher) {
      flush()
      out.push(higher)
      i++
      continue
    }
    var list = parseListAt(lines, i)
    if (list) {
      flush()
      out.push(list.block)
      i = list.end
      continue
    }
    var labeled = parseLabeledRun(lines, i)
    if (labeled) {
      flush()
      out.push(labeled.block)
      i = labeled.end
      continue
    }
    buf.push(line)
    i++
  }
  flush()
  return out
}

function parseJsonArray(raw) {
  try {
    var value = JSON.parse(String(raw || "[]"))
    return Array.isArray(value) ? value : []
  } catch (e) {
    return []
  }
}

function tableCell(headersJson, rowsJson, row, col) {
  var headers = parseJsonArray(headersJson)
  var rows = parseJsonArray(rowsJson)
  if (row <= 0)
    return String(headers[col] || "")
  var line = rows[row - 1]
  if (!line || !Array.isArray(line))
    return ""
  return String(line[col] || "")
}

function tableWeight(weightsJson, col, colCount) {
  var weights = parseJsonArray(weightsJson)
  var w = Number(weights[col])
  if (w > 0)
    return w
  var n = colCount > 0 ? colCount : 1
  return 1 / n
}

function itemField(itemsJson, index, key) {
  var items = parseJsonArray(itemsJson)
  var item = items[index]
  if (!item || typeof item !== "object")
    return ""
  return String(item[key] || "")
}

function padRight(value, width) {
  var s = String(value || "")
  var cap = width > 0 ? width : 0
  if (cap && s.length > cap)
    s = s.slice(0, Math.max(1, cap - 1)) + "…"
  while (s.length < cap)
    s += " "
  return s
}

function formatTablePlain(caption, headers, rows) {
  var cols = headers ? headers.length : 0
  if (cols < 1)
    return caption || ""
  var widths = []
  var c
  var r
  var n
  for (c = 0; c < cols; c++) {
    widths[c] = String(headers[c] || "").length
    for (r = 0; r < rows.length; r++) {
      n = String((rows[r] || [])[c] || "").length
      if (n > widths[c])
        widths[c] = n
    }
    if (c < cols - 1)
      widths[c] = Math.min(widths[c], 28)
    else
      widths[c] = Math.min(widths[c], 80)
  }

  function fmtRow(cells) {
    var parts = []
    for (c = 0; c < cols; c++) {
      var t = String(cells[c] || "")
      if (c < cols - 1)
        parts.push(padRight(t, widths[c]))
      else
        parts.push(t)
    }
    return parts.join("  ")
  }

  var lines = []
  if (caption)
    lines.push(caption)
  lines.push(fmtRow(headers))
  var rule = []
  for (c = 0; c < cols; c++) {
    var bar = ""
    var len = c < cols - 1 ? widths[c] : Math.min(widths[c], 24)
    while (bar.length < len)
      bar += "─"
    rule.push(bar)
  }
  lines.push(rule.join("  "))
  for (r = 0; r < rows.length; r++)
    lines.push(fmtRow(rows[r]))
  return lines.join("\n")
}

function renderBody(body) {
  var blocks = bodyBlocks(body)
  if (!blocks.length)
    return sanitizeText(body, true, MAX_BODY_CHARS)
  var parts = []
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i]
    if (block.kind === "table")
      parts.push(formatTablePlain(block.caption, block.headers, block.rows))
    else if (block.kind === "list") {
      var items = block.items || []
      var listLines = []
      for (var n = 0; n < items.length; n++) {
        var item = items[n] || {}
        var marker = item.marker || (block.ordered ? String(n + 1) + "." : "•")
        var chunk = String(item.label || "")
        if (chunk && item.body)
          chunk += " " + item.body
        else if (item.body)
          chunk = item.body
        listLines.push(marker + " " + chunk)
      }
      if (listLines.length)
        parts.push(listLines.join("\n"))
    } else if (block.kind === "stats") {
      var rows = block.rows || []
      var statLines = []
      for (var s = 0; s < rows.length; s++) {
        if (!rows[s])
          continue
        statLines.push(String(rows[s].label || "") + ": " + String(rows[s].value || ""))
      }
      if (statLines.length)
        parts.push(statLines.join("\n"))
    } else if (block.kind === "quote") {
      var quoted = block.caption ? block.caption + "\n" + String(block.text || "") : String(block.text || "")
      if (quoted)
        parts.push(quoted)
    } else if (block.text)
      parts.push(block.text)
  }
  return parts.join("\n\n")
}

function copyText(entry) {
  if (!entry)
    return ""
  var title = sanitizeText(entry.name, false, MAX_NAME_CHARS)
  var kind = kindLabel(entry.kind)
  var body = renderBody(entry.body)
  if (!title || !body)
    return ""
  var out = title + "  (" + kind + ")\n\n" + body
  if (out.indexOf("\0") !== -1)
    return ""
  return out
}

function parseExpr(raw) {
  var s = String(raw || "").replace(/\s+/g, "")
  var match = s.match(/^(\d{1,2})d(\d{1,4})([+-]\d{1,3})?$/i)
  if (!match)
    return null
  var n = parseInt(match[1], 10)
  var sides = parseInt(match[2], 10)
  var mod = match[3] ? parseInt(match[3], 10) : 0
  if (n < 1 || n > 40 || sides < 2 || sides > 1000)
    return null
  if (mod < -200 || mod > 200)
    return null
  return { n: n, sides: sides, mod: mod }
}

function exprText(expr) {
  if (!expr)
    return ""
  var s = expr.n + "d" + expr.sides
  if (expr.mod > 0)
    s += "+" + expr.mod
  else if (expr.mod < 0)
    s += String(expr.mod)
  return s
}

function rollExpr(expr, extraDice) {
  var parsed = expr && expr.n ? expr : parseExpr(expr)
  if (!parsed)
    return null
  var n = parsed.n + (extraDice > 0 ? extraDice : 0)
  if (n > 40)
    n = 40
  var rolls = []
  var dice = 0
  for (var i = 0; i < n; i++) {
    var r = 1 + Math.floor(Math.random() * parsed.sides)
    rolls.push(r)
    dice += r
  }
  return {
    n: n,
    sides: parsed.sides,
    mod: parsed.mod,
    rolls: rolls,
    dice: dice,
    total: dice + parsed.mod,
    text: exprText({ n: n, sides: parsed.sides, mod: parsed.mod })
  }
}

function damageTypeAfter(text, index) {
  var tail = String(text || "").slice(index).replace(/^\s+/, "")
  var match = tail.match(/^(Fire|Cold|Lightning|Thunder|Acid|Poison|Necrotic|Radiant|Force|Psychic|Bludgeoning|Piercing|Slashing|Healing)\b/i)
  return match ? match[1] : ""
}

function actionRollSpec(label, body) {
  var text = String(label || "") + " " + String(body || "")
  if (!/\d+d\d+/i.test(text) && !/Attack Roll:/i.test(text))
    return null
  var title = String(label || "").replace(/\.$/, "")
  if (!title)
    title = "Roll"
  var bonus = 0
  var hasHit = false
  var hitMatch = text.match(/Attack Roll:\s*([+-]\d+)/i)
  if (hitMatch) {
    hasHit = true
    bonus = parseInt(hitMatch[1], 10)
    if (bonus < -20 || bonus > 30)
      bonus = 0
  }
  var damage = []
  var re = /(\d+)\s*\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)/gi
  var match
  while ((match = re.exec(text))) {
    var expr = parseExpr(match[2])
    if (!expr)
      continue
    var type = damageTypeAfter(text, match.index + match[0].length)
    var prefix = text.slice(Math.max(0, match.index - 12), match.index).toLowerCase()
    var suffix = text.slice(match.index, match.index + 90).toLowerCase()
    damage.push({
      expr: exprText(expr),
      type: type,
      optional: prefix.indexOf("plus") >= 0 && suffix.indexOf("advantage") >= 0
    })
    if (damage.length >= 6)
      break
  }
  if (!damage.length) {
    var bare = text.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)/i)
    if (bare && !/increases by|increase by/i.test(text.slice(Math.max(0, (bare.index || 0) - 24), bare.index || 0))) {
      var parsed = parseExpr(bare[1])
      if (parsed)
        damage.push({
          expr: exprText(parsed),
          type: damageTypeAfter(text, (bare.index || 0) + bare[1].length),
          optional: false
        })
    }
  }
  if (!hasHit && !damage.length)
    return null
  return {
    type: "action",
    title: sanitizeText(title, false, 80),
    bonus: bonus,
    hasHit: hasHit,
    damage: damage
  }
}

function extractTextDice(text) {
  var s = String(text || "")
  var out = []
  var seen = {}
  var re = /(\d+d\d+(?:\s*[+-]\s*\d+)?)/gi
  var match
  while ((match = re.exec(s))) {
    var before = s.slice(Math.max(0, match.index - 28), match.index).toLowerCase()
    var around = s.slice(Math.max(0, match.index - 12), match.index + match[1].length + 32).toLowerCase()
    if (before.indexOf("increases by") >= 0 || before.indexOf("increase by") >= 0)
      continue
    if (before.indexOf("slot level") >= 0)
      continue
    if (/\broll\s+\d+d\d+\s+(to determine|at the|and consult|on the table)/.test(around))
      continue
    var expr = parseExpr(match[1])
    if (!expr)
      continue
    var type = damageTypeAfter(s, match.index + match[1].length)
    var title = exprText(expr) + (type ? " " + type : "")
    if (seen[title])
      continue
    seen[title] = true
    out.push({ type: "dice", title: title, expr: exprText(expr), kind: type })
    if (out.length >= 6)
      break
  }
  return out
}

function parseRangeCell(cell) {
  var s = String(cell || "").replace(/\s+/g, "").replace(/[–—−]/g, "-")
  if (!s || s === "—" || s === "-" || s === "–")
    return null
  if (s === "00")
    return { lo: 100, hi: 100 }
  if (/^\d+$/.test(s)) {
    var n = parseInt(s, 10)
    if (s.length >= 2 && n === 0)
      n = 100
    return { lo: n, hi: n }
  }
  var match = s.match(/^(\d+)-(\d+)$/)
  if (!match)
    return null
  var a = parseInt(match[1], 10)
  var b = parseInt(match[2], 10)
  if (match[1].length >= 2 && a === 0)
    a = 100
  if (match[2].length >= 2 && b === 0)
    b = 100
  if (b < a) {
    var tmp = a
    a = b
    b = tmp
  }
  return { lo: a, hi: b }
}

function tableRollSpec(headers, rows, caption) {
  if (!rows || rows.length < 2 || rows.length > 40)
    return null
  var header0 = String((headers && headers[0]) || "")
  var cap = String(caption || "")
  var dieMatch = (header0 + " " + cap).match(/\b1?d(\d{1,3})\b/i)
  var ranges = []
  var i
  for (i = 0; i < rows.length; i++) {
    var rng = parseRangeCell((rows[i] || [])[0])
    if (!rng)
      return null
    var rest = (rows[i] || []).slice(1).join(" · ")
    ranges.push({
      lo: rng.lo,
      hi: rng.hi,
      index: i,
      text: sanitizeText(rest || String((rows[i] || [])[0] || ""), false, 240)
    })
  }
  var min = ranges[0].lo
  var max = ranges[0].hi
  for (i = 1; i < ranges.length; i++) {
    if (ranges[i].lo < min)
      min = ranges[i].lo
    if (ranges[i].hi > max)
      max = ranges[i].hi
  }
  var die = dieMatch ? parseInt(dieMatch[1], 10) : 0
  if (!die) {
    if (min !== 1 || max < 2 || max > 20)
      return null
    if (rows.length > 12 && max > 12)
      return null
    die = max
  }
  if (die < 2 || die > 100)
    return null
  return {
    type: "table",
    title: sanitizeText(cap || header0 || "Table", false, 80),
    die: die,
    ranges: ranges
  }
}

function pickTableRange(spec, value) {
  if (!spec || !spec.ranges)
    return null
  for (var i = 0; i < spec.ranges.length; i++) {
    if (value >= spec.ranges[i].lo && value <= spec.ranges[i].hi)
      return spec.ranges[i]
  }
  return null
}

function actionRollJson(label, body) {
  var spec = actionRollSpec(label, body)
  return spec ? JSON.stringify(spec) : ""
}

function tableRollJson(headersJson, rowsJson, caption) {
  var spec = tableRollSpec(parseJsonArray(headersJson), parseJsonArray(rowsJson), caption)
  return spec ? JSON.stringify(spec) : ""
}

function textDiceJson(text) {
  var list = extractTextDice(text)
  return list.length ? JSON.stringify(list) : "[]"
}

function collectRolls(body) {
  var blocks = bodyBlocks(body)
  var out = []
  var i
  var j
  for (i = 0; i < blocks.length; i++) {
    var block = blocks[i]
    if (block.kind === "list") {
      var items = block.items || []
      for (j = 0; j < items.length; j++) {
        var action = actionRollSpec(items[j].label, items[j].body)
        if (action)
          out.push(action)
      }
    } else if (block.kind === "table") {
      var table = tableRollSpec(block.headers, block.rows, block.caption)
      if (table)
        out.push(table)
    } else if (block.kind === "text" || block.kind === "quote") {
      var dice = extractTextDice(block.text)
      for (j = 0; j < dice.length; j++)
        out.push(dice[j])
    }
    if (out.length >= 16)
      break
  }
  return out
}

function collectRollsJson(body) {
  return JSON.stringify(collectRolls(body))
}

function executeRoll(specRaw) {
  var spec = specRaw
  if (typeof specRaw === "string") {
    try {
      spec = JSON.parse(specRaw)
    } catch (e) {
      return null
    }
  }
  if (!spec || !spec.type)
    return null
  if (spec.type === "dice") {
    var rolled = rollExpr(spec.expr, 0)
    if (!rolled)
      return null
    return {
      title: String(spec.title || rolled.text),
      summary: String(rolled.total),
      detail: rolled.text + " → " + rolled.rolls.join("+") + (rolled.mod ? (rolled.mod > 0 ? "+" : "") + rolled.mod : ""),
      tableRow: -1,
      tableKey: ""
    }
  }
  if (spec.type === "table") {
    var die = spec.die > 0 ? spec.die : 20
    var value = 1 + Math.floor(Math.random() * die)
    var hit = pickTableRange(spec, value)
    var label = hit ? hit.text : "—"
    return {
      title: String(spec.title || "Table"),
      summary: "d" + die + " → " + value,
      detail: hit ? (hit.lo === hit.hi ? String(hit.lo) : hit.lo + "–" + hit.hi) + "  " + label : "no matching row",
      tableRow: hit ? hit.index + 1 : -1,
      tableKey: String(spec.title || "")
    }
  }
  if (spec.type === "action") {
    var lines = []
    var bits = []
    var d20 = 0
    if (spec.hasHit) {
      d20 = 1 + Math.floor(Math.random() * 20)
      var hitTotal = d20 + (spec.bonus || 0)
      var tag = d20 === 20 ? " crit" : (d20 === 1 ? " miss" : "")
      bits.push((d20 === 20 ? "nat 20" : (d20 === 1 ? "nat 1" : String(hitTotal))) + " to hit")
      lines.push("1d20" + (spec.bonus >= 0 ? "+" + spec.bonus : spec.bonus) + " → " + d20 + (spec.bonus >= 0 ? "+" : "") + spec.bonus + tag)
    }
    var extra = d20 === 20 ? true : false
    var dmg = spec.damage || []
    for (var i = 0; i < dmg.length; i++) {
      if (dmg[i].optional)
        continue
      var parsed = parseExpr(dmg[i].expr)
      var more = extra && parsed ? parsed.n : 0
      var r = rollExpr(parsed, more)
      if (!r)
        continue
      var label = dmg[i].type || "damage"
      bits.push(r.total + " " + label.toLowerCase())
      lines.push(r.text + " → " + r.rolls.join("+") + (r.mod ? (r.mod > 0 ? "+" : "") + r.mod : "") + " " + label.toLowerCase())
    }
    return {
      title: String(spec.title || "Attack"),
      summary: bits.join("  ·  ") || "—",
      detail: lines.join("   "),
      tableRow: -1,
      tableKey: ""
    }
  }
  return null
}
