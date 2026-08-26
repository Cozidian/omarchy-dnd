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

function parseIndex(raw) {
  if (!raw) return []
  try {
    var parsed = JSON.parse(String(raw))
  } catch (e) {
    return []
  }
  if (!parsed || !Array.isArray(parsed.entries)) return []
  return parsed.entries
}

function parseQuery(text) {
  var query = String(text || "").trim().toLowerCase()
  var kind = ""
  var rest = query
  var spaced = query.match(/^(spell|spells|monster|monsters|creature|creatures|condition|conditions|rule|rules|feat|feats)[:\s]+(.*)$/)
  if (spaced) {
    kind = KIND_ALIASES[spaced[1]] || ""
    rest = String(spaced[2] || "").trim()
  }
  return { kind: kind, text: rest, raw: query }
}

function scoreEntry(entry, kind, needle) {
  if (kind && entry.kind !== kind) return -1
  if (!needle) {
    if (kind) return 50
    return entry.kind === "condition" ? 10 : -1
  }
  var name = String(entry.name || "").toLowerCase()
  if (name === needle) return 0
  if (name.indexOf(needle) === 0) return 1
  var words = name.split(/\s+/)
  for (var i = 0; i < words.length; i++)
    if (words[i].indexOf(needle) === 0) return 2
  if (name.indexOf(needle) >= 0) return 3
  var tags = String(entry.tags || "")
  if (tags.indexOf(needle) >= 0) return 4
  var body = String(entry.body || "").toLowerCase()
  if (body.indexOf(needle) >= 0) return 5
  return -1
}

function filterEntries(entries, text, limit) {
  var parsed = parseQuery(text)
  var cap = limit > 0 ? limit : 80
  var scored = []
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i]
    var score = scoreEntry(entry, parsed.kind, parsed.text)
    if (score < 0) continue
    scored.push({ score: score, index: i, entry: entry })
  }
  scored.sort(function(a, b) {
    if (a.score !== b.score) return a.score - b.score
    var an = String(a.entry.name || "").toLowerCase()
    var bn = String(b.entry.name || "").toLowerCase()
    if (an < bn) return -1
    if (an > bn) return 1
    return 0
  })
  var out = []
  for (var j = 0; j < scored.length && out.length < cap; j++)
    out.push(scored[j].entry)
  return out
}

function kindLabel(kind) {
  if (kind === "spell") return "Spell"
  if (kind === "monster") return "Monster"
  if (kind === "condition") return "Condition"
  if (kind === "rule") return "Rule"
  if (kind === "feat") return "Feat"
  return "Entry"
}

function copyText(entry) {
  if (!entry) return ""
  var title = entry.name || ""
  var kind = kindLabel(entry.kind)
  var body = entry.body || ""
  return title + "  (" + kind + ")\n\n" + body
}
