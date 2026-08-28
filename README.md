# SRD Lookup

Summon, type, read, dismiss. A 5e SRD search overlay for the Omarchy bar — the emoji picker, but for *prone*, *counterspell*, and *goblin*.

Plugin id: `io.github.cozidian.dnd`

D&D Beyond has no public API, so this does not talk to your character sheet. It searches a local snapshot of the **System Reference Document 5.2** (the 2024 / “5.5” rules, CC BY 4.0) via [Open5e](https://open5e.com/): conditions, spells, monsters, rules, and feats.

## Install

```sh
omarchy plugin add https://github.com/Cozidian/omarchy-dnd.git --enable
```

From this checkout:

```sh
rsync -a --delete ./ ~/.config/omarchy/plugins/io.github.cozidian.dnd/
omarchy-shell shell rescanPlugins
omarchy plugin enable io.github.cozidian.dnd --section center
```

## Usage

Click the book on the bar, or:

```sh
omarchy-shell shell toggle io.github.cozidian.dnd
```

Suggested Hyprland bind (pick a chord that is free):

```lua
o.bind("SUPER + SHIFT + D", "SRD lookup", "omarchy-shell shell toggle io.github.cozidian.dnd")
```

Type to search. Prefixes narrow the index:

- `spell fireball`
- `monster goblin`
- `rule cover`
- `feat alert`
- `condition prone`

With an empty query, the list is just the conditions — the thing you look up mid-turn.

- **Up / Down** move
- **Enter** or **Ctrl+C** copies the entry
- **Esc** clears the query, then closes

## Data

`data/srd.json` is generated from Open5e (`srd-2024` / SRD 5.2). Refresh it with:

```sh
python3 scripts/fetch-srd.py
```

The refresh path is HTTPS-only to `api.open5e.com`, with response-byte, page, entry, and string-length ceilings. Redirects are refused before they are followed unless the next URL is still HTTPS `api.open5e.com`. Names, summaries, and bodies are stripped of markup and control characters before they are written. The overlay loads the snapshot through an isolated (`python3 -I`) helper that opens one no-follow, nonblocking regular-file descriptor (byte-capped, 2s deadline), keeps at most 4000 entries, searches a 1 KiB haystack per entry, and renders every `Text` sink as `Text.PlainText`. Copy feeds `/usr/bin/wl-copy --` on stdin; snapshot text never reaches a shell.

```sh
python3 tests/test_fetch.py
python3 tests/test_read_index.py
node tests/test_search.js
```

The plugin code is MIT. SRD 5.2 text is CC BY 4.0, as published by Wizards of the Coast and redistributed by Open5e.

## Remove

```sh
omarchy plugin remove io.github.cozidian.dnd
```
