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
  return s
}

function parseStatLine(line) {
  var s = String(line || "").replace(/^\s+|\s+$/g, "")
  if (!s)
    return null
  var match = s.match(/^(Casting time|Range|Duration|Components|Classes|Prerequisite):\s*(.+)$/i)
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
