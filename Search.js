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
  feats: "feat"
}

var KINDS = {
  spell: true,
  monster: true,
  condition: true,
  rule: true,
  feat: true
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
  return sanitizeText(value, false, MAX_FILTER_CHARS)
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

function parseQuery(text) {
  var query = sanitizeFilter(text).toLowerCase()
  var kind = ""
  var rest = query
  var spaced = query.match(/^(spell|spells|monster|monsters|creature|creatures|condition|conditions|rule|rules|feat|feats)[:\s]+(.*)$/)
  if (spaced) {
    kind = KIND_ALIASES[spaced[1]] || ""
    rest = String(spaced[2] || "").replace(/^\s+|\s+$/g, "")
  }
  return { kind: kind, text: rest, raw: query }
}

function scoreEntry(entry, kind, needle) {
  if (kind && entry.kind !== kind)
    return -1
  if (!needle) {
    if (kind)
      return 50
    return entry.kind === "condition" ? 10 : -1
  }
  var name = String(entry.name || "").toLowerCase()
  if (name === needle)
    return 0
  if (name.indexOf(needle) === 0)
    return 1
  var words = name.split(/\s+/)
  for (var i = 0; i < words.length; i++)
    if (words[i].indexOf(needle) === 0)
      return 2
  if (name.indexOf(needle) >= 0)
    return 3
  var hay = String(entry.haystack || "")
  if (hay.indexOf(needle) >= 0)
    return entry.tags && String(entry.tags).indexOf(needle) >= 0 ? 4 : 5
  return -1
}

function filterEntries(entries, text, limit) {
  var parsed = parseQuery(text)
  var cap = limit > 0 ? limit : MAX_RESULTS
  var list = entries || []
  if (list.length > MAX_ENTRIES)
    list = list.slice(0, MAX_ENTRIES)
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
    out.push(scored[j].entry)
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
  return "Entry"
}

function copyText(entry) {
  if (!entry)
    return ""
  var title = sanitizeText(entry.name, false, MAX_NAME_CHARS)
  var kind = kindLabel(entry.kind)
  var body = sanitizeText(entry.body, true, MAX_BODY_CHARS)
  if (!title || !body)
    return ""
  var out = title + "  (" + kind + ")\n\n" + body
  if (out.indexOf("\0") !== -1)
    return ""
  return out
}
