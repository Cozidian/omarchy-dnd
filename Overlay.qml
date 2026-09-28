import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons
import qs.Ui
import "Search.js" as Search

Item {
  id: root

  property string omarchyPath: Quickshell.env("OMARCHY_PATH")
  property var shell: null
  property var manifest: null

  property bool opened: false
  property string filterText: ""
  property int selectedIndex: 0
  property bool cursorActive: false
  property var entries: []
  property string copiedHint: ""
  property string pendingCopy: ""
  property string rollTitle: ""
  property string rollSummary: ""
  property string rollDetail: ""
  property int rollTableRow: -1
  property string rollTableKey: ""
  property int selectedRoll: 0
  property int rollCount: 0
  property var pins: []
  property string pendingPins: ""
  property bool pinsLoaded: false
  property bool pinsDirty: false

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color border: Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.spacing.panelPadding
  property int headerHeight: Math.max(Style.space(48), Style.font.heading + Style.font.caption + Style.spacing.controlPaddingY * 2)
  property int contentSpacing: Style.spacing.md
  property int cardWidth: Math.min(Style.space(920), panel.width - Style.gapsOut * 2)
  property int cardHeight: Math.min(Style.space(620), panel.height - Style.gapsOut * 2)
  property int rowHeight: Math.max(Style.space(52), Style.font.body + Style.font.caption + Style.spacing.rowPaddingX * 2)

  readonly property string pluginDir: {
    if (manifest && manifest.__sourceDir)
      return manifest.__sourceDir
    return String(Qt.resolvedUrl(".")).replace(/^file:\/\//, "").replace(/\/$/, "")
  }
  readonly property string dataPath: root.pluginDir ? root.pluginDir + "/data/srd.json" : ""
  readonly property string indexReaderScript: root.pluginDir ? root.pluginDir + "/scripts/read-index.py" : ""
  readonly property string pinsStateScript: root.pluginDir ? root.pluginDir + "/scripts/pins-state.py" : ""
  readonly property string pinsPath: (Quickshell.env("HOME") || "") + "/.local/state/omarchy/dnd-recents.json"

  function open(payloadJson) {
    root.opened = true
    root.readPinsBounded()
    root.filterText = ""
    root.selectedIndex = 0
    root.cursorActive = true
    root.copiedHint = ""
    root.rebuildDisplay()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
  }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide((root.manifest && root.manifest.id) || "io.github.cozidian.dnd")
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function readIndexBounded() {
    if (!root.dataPath || !root.indexReaderScript) {
      root.loadEntries("")
      return
    }
    if (indexReader.running)
      indexReader.running = false
    indexReader.running = true
  }

  function loadEntries(raw) {
    root.entries = Search.parseIndex(raw)
    if (root.opened) root.rebuildDisplay()
  }

  function rebuildDisplay() {
    var out = Search.filterEntries(root.entries, root.filterText, 80, root.pins)
    displayModel.clear()
    for (var i = 0; i < out.length; i++) {
      displayModel.append({
        name: String(out[i].name || ""),
        kind: String(out[i].kind || ""),
        kindLabel: Search.kindLabel(out[i].kind),
        summary: String(out[i].summary || ""),
        body: String(out[i].body || ""),
        group: String(out[i].group || ""),
        pinned: out[i].pinned ? 1 : 0
      })
    }
    if (displayModel.count === 0) selectedIndex = 0
    else if (selectedIndex >= displayModel.count) selectedIndex = displayModel.count - 1
    else if (selectedIndex < 0) selectedIndex = 0
    cursorActive = displayModel.count > 0
    root.rebuildDetail()
    Qt.callLater(function() {
      if (displayModel.count > 0) resultList.positionViewAtIndex(root.selectedIndex, ListView.Contain)
    })
  }

  function wash(c, a) {
    return Qt.rgba(c.r, c.g, c.b, a)
  }

  function clearRoll() {
    root.rollTitle = ""
    root.rollSummary = ""
    root.rollDetail = ""
    root.rollTableRow = -1
    root.rollTableKey = ""
  }

  function applyRoll(result) {
    if (!result) {
      root.clearRoll()
      return
    }
    root.rollTitle = String(result.title || "")
    root.rollSummary = String(result.summary || "")
    root.rollDetail = String(result.detail || "")
    root.rollTableRow = result.tableRow >= 0 ? result.tableRow : -1
    root.rollTableKey = String(result.tableKey || "")
  }

  function performRoll(specJson, rollIndex, advantage) {
    if (!specJson)
      return
    if (rollIndex >= 0)
      root.selectedRoll = rollIndex
    root.applyRoll(Search.executeRoll(specJson, advantage ? { advantage: true } : null))
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function rollPrimary(advantage) {
    var row = root.currentRow()
    if (!row)
      return
    var rolls = Search.collectRolls(row.body)
    if (!rolls || !rolls.length)
      return
    var index = root.selectedRoll
    if (index < 0 || index >= rolls.length)
      index = 0
    root.selectedRoll = index
    root.applyRoll(Search.executeRoll(JSON.stringify(rolls[index]), advantage ? { advantage: true } : null))
  }

  function cycleRoll(delta) {
    if (root.rollCount < 1)
      return
    root.selectedRoll = Search.cycleIndex(root.selectedRoll, root.rollCount, delta)
  }

  function rollChipColor(index) {
    return root.wash(root.selectedBackground, index === root.selectedRoll && root.rollCount > 0 ? 0.58 : 0.28)
  }

  function rebuildDetail() {
    bodyModel.clear()
    root.clearRoll()
    root.selectedRoll = 0
    root.rollCount = 0
    var row = root.currentRow()
    var blocks = Search.bodyBlocks(row ? row.body : "")
    var rollNo = 0
    function takeRoll() {
      if (rollNo >= Search.MAX_ROLLS)
        return -1
      var n = rollNo
      rollNo++
      return n
    }
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i]
      var kind = String(block.kind || "text")
      var isTable = kind === "table"
      var isList = kind === "list"
      var isStats = kind === "stats"
      var isText = kind === "text"
      var isQuote = kind === "quote"
      var rows = isTable ? (block.rows || []) : (isStats ? (block.rows || []) : [])
      var items = isList ? (block.items || []) : []
      if (isList) {
        for (var n = 0; n < items.length; n++) {
          if (Search.actionRollSpec(items[n].label, items[n].body))
            items[n].rollIndex = takeRoll()
          else
            items[n].rollIndex = -1
        }
      }
      var tableRoll = isTable ? Search.tableRollJson(JSON.stringify(block.headers || []), JSON.stringify(rows), block.caption || "") : ""
      var tableRollIndex = tableRoll ? takeRoll() : -1
      var dice = (isText || isQuote) ? Search.extractTextDice(block.text || "") : []
      for (var d = 0; d < dice.length; d++)
        dice[d].rollIndex = takeRoll()
      bodyModel.append({
        kind: kind,
        text: String(block.text || ""),
        caption: String(block.caption || ""),
        colCount: isTable ? (block.colCount || 0) : 0,
        rowCount: isTable ? (1 + rows.length) : (isList ? items.length : (isStats ? rows.length : 0)),
        ordered: block.ordered ? 1 : 0,
        headersJson: isTable ? JSON.stringify(block.headers || []) : "[]",
        rowsJson: isTable ? JSON.stringify(rows) : "[]",
        weightsJson: isTable ? JSON.stringify(block.weights || []) : "[]",
        itemsJson: isList ? JSON.stringify(items) : (isStats ? JSON.stringify(rows) : "[]"),
        rollJson: tableRoll,
        tableRollIndex: tableRollIndex,
        diceJson: dice.length ? JSON.stringify(dice) : "[]"
      })
    }
    root.rollCount = rollNo
    if (detailFlick)
      detailFlick.contentY = 0
  }

  function setFilter(nextFilter) {
    root.filterText = Search.sanitizeFilter(nextFilter)
    root.selectedIndex = 0
    root.cursorActive = true
    root.copiedHint = ""
    root.rebuildDisplay()
  }

  function selectNamed(kind, name) {
    var want = String(name || "").toLowerCase()
    for (var i = 0; i < displayModel.count; i++) {
      var row = displayModel.get(i)
      if (row && row.kind === kind && String(row.name || "").toLowerCase() === want) {
        root.selectedIndex = i
        root.cursorActive = true
        resultList.positionViewAtIndex(i, ListView.Contain)
        return
      }
    }
  }

  function loadPins(raw) {
    if (root.pinsDirty)
      return
    var state = Search.parseState(raw)
    root.pinsLoaded = true
    if (Search.sameRefs(state.pins, root.pins))
      return
    root.pins = state.pins
    if (root.opened)
      root.rebuildDisplay()
  }

  function readPinsBounded() {
    if (!root.pinsPath || !root.pinsStateScript) {
      root.loadPins("")
      return
    }
    if (pinsReader.running)
      pinsReader.running = false
    pinsReader.running = true
  }

  function savePins() {
    if (!root.pinsPath || !root.pinsStateScript)
      return
    root.pendingPins = Search.serializeState(root.pins)
    if (pinsWriter.running)
      pinsWriter.running = false
    pinsWriter.stdinEnabled = true
    pinsWriter.running = true
  }

  function togglePinCurrent() {
    var row = root.currentRow()
    if (!row)
      return
    var kind = row.kind
    var name = row.name
    if (!Search.isPinned(root.pins, kind, name) && (root.pins || []).length >= Search.MAX_PINS) {
      root.copiedHint = "Pin limit"
      copiedTimer.restart()
      return
    }
    root.pins = Search.togglePin(root.pins, kind, name)
    root.pinsDirty = true
    root.copiedHint = Search.isPinned(root.pins, kind, name) ? "Pinned" : "Unpinned"
    copiedTimer.restart()
    root.savePins()
    root.rebuildDisplay()
    root.selectNamed(kind, name)
  }

  function select(delta) {
    if (displayModel.count === 0) return
    if (!cursorActive) {
      cursorActive = true
      selectedIndex = delta < 0 ? displayModel.count - 1 : 0
    } else {
      selectedIndex = (selectedIndex + delta + displayModel.count) % displayModel.count
    }
    resultList.positionViewAtIndex(selectedIndex, ListView.Contain)
  }

  function scrollDetail(direction) {
    if (!detailFlick)
      return
    if (typeof detailFlick.cancelFlick === "function")
      detailFlick.cancelFlick()
    var origin = Number(detailFlick.originY) || 0
    var maxY = origin + Math.max(0, detailFlick.contentHeight - detailFlick.height)
    if (maxY <= origin && detailFlick.contentY <= origin)
      return
    var step = Math.max(Style.space(64), Math.round(detailFlick.height * 0.5))
    var next = detailFlick.contentY + direction * step
    if (next < origin)
      next = origin
    else if (next > maxY)
      next = maxY
    detailFlick.contentY = next
  }

  function currentRow() {
    if (selectedIndex < 0 || selectedIndex >= displayModel.count) return null
    return displayModel.get(selectedIndex)
  }

  function copyCurrent() {
    var row = root.currentRow()
    if (!row) return
    var text = Search.copyText(row)
    if (!text || text.indexOf("\0") !== -1) return
    root.pendingCopy = text
    if (copier.running)
      copier.running = false
    copier.stdinEnabled = true
    copier.running = true
    root.copiedHint = "Copied"
    copiedTimer.restart()
  }

  onSelectedIndexChanged: root.rebuildDetail()

  ListModel { id: displayModel }
  ListModel { id: bodyModel }

  Timer {
    id: copiedTimer
    interval: 1400
    repeat: false
    onTriggered: root.copiedHint = ""
  }

  FileView {
    path: root.dataPath
    preload: false
    watchChanges: true
    printErrors: false
    onFileChanged: root.readIndexBounded()
  }

  Process {
    id: pinsReader
    running: false
    command: (root.pinsPath && root.pinsStateScript)
      ? ["/usr/bin/python3", "-I", "-B", "--", root.pinsStateScript, "read", root.pinsPath, String(Search.MAX_STATE_BYTES)]
      : ["/usr/bin/true"]
    stdout: StdioCollector {
      id: pinsOut
      waitForEnd: true
    }
    onExited: function(exitCode) {
      var raw = String(pinsOut.text || "")
      if (exitCode === 0 && raw.length <= Search.MAX_STATE_BYTES)
        root.loadPins(raw)
      else if (!root.pinsLoaded)
        root.loadPins("")
    }
  }

  Process {
    id: pinsWriter
    running: false
    stdinEnabled: true
    command: (root.pinsPath && root.pinsStateScript)
      ? ["/usr/bin/python3", "-I", "-B", "--", root.pinsStateScript, "write", root.pinsPath, String(Search.MAX_STATE_BYTES)]
      : ["/usr/bin/true"]
    onStarted: {
      pinsWriter.write(root.pendingPins)
      pinsWriter.stdinEnabled = false
      root.pendingPins = ""
    }
    onExited: function(exitCode) {
      if (exitCode === 0) {
        root.pinsDirty = false
        root.pinsLoaded = true
      }
    }
  }

  Process {
    id: indexReader
    running: false
    command: (root.dataPath && root.indexReaderScript)
      ? ["/usr/bin/python3", "-I", "-B", "--", root.indexReaderScript, root.dataPath, String(Search.MAX_INDEX_BYTES)]
      : ["/usr/bin/true"]
    stdout: StdioCollector {
      id: indexOut
      waitForEnd: true
    }
    onExited: function(exitCode) {
      var raw = String(indexOut.text || "")
      if (!root.dataPath || !root.indexReaderScript || exitCode !== 0 || raw.length > Search.MAX_INDEX_BYTES)
        root.loadEntries("")
      else
        root.loadEntries(raw)
    }
  }

  Process {
    id: copier
    running: false
    stdinEnabled: true
    command: ["/usr/bin/wl-copy", "--"]
    onStarted: {
      if (root.pendingCopy !== "")
        copier.write(root.pendingCopy)
      copier.stdinEnabled = false
      root.pendingCopy = ""
    }
  }

  Component.onCompleted: {
    root.readIndexBounded()
    root.readPinsBounded()
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "omarchy-srd-lookup"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: root.cardHeight
      radius: root.cornerRadius
      anchors.centerIn: parent
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true

        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          if (event.key === Qt.Key_Escape) {
            if (root.filterText) root.setFilter("")
            else root.dismiss()
            event.accepted = true
          } else if (event.key === Qt.Key_C && (event.modifiers & Qt.ControlModifier)) {
            root.copyCurrent()
            event.accepted = true
          } else if (event.key === Qt.Key_R && (event.modifiers & Qt.ControlModifier)) {
            root.rollPrimary(!!(event.modifiers & Qt.ShiftModifier))
            event.accepted = true
          } else if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
            root.cycleRoll((event.key === Qt.Key_Backtab || (event.modifiers & Qt.ShiftModifier)) ? -1 : 1)
            event.accepted = true
          } else if (event.key === Qt.Key_BracketLeft) {
            root.cycleRoll(-1)
            event.accepted = true
          } else if (event.key === Qt.Key_BracketRight) {
            root.cycleRoll(1)
            event.accepted = true
          } else if (event.key === Qt.Key_P && (event.modifiers & Qt.ControlModifier)) {
            root.togglePinCurrent()
            event.accepted = true
          } else if (event.key === Qt.Key_Up && (event.modifiers & Qt.ControlModifier)) {
            root.scrollDetail(-1)
            event.accepted = true
          } else if (event.key === Qt.Key_Down && (event.modifiers & Qt.ControlModifier)) {
            root.scrollDetail(1)
            event.accepted = true
          } else if (Util.editsFilter(event, root.filterText)) {
            root.setFilter(Util.editedFilter(event, root.filterText))
            event.accepted = true
          } else if (event.key === Qt.Key_Up) {
            root.select(-1)
            event.accepted = true
          } else if (event.key === Qt.Key_Down) {
            root.select(1)
            event.accepted = true
          } else if (event.key === Qt.Key_PageUp) {
            root.select(-8)
            event.accepted = true
          } else if (event.key === Qt.Key_PageDown) {
            root.select(8)
            event.accepted = true
          } else if (event.key === Qt.Key_Home) {
            root.selectedIndex = 0
            event.accepted = true
          } else if (event.key === Qt.Key_End) {
            if (displayModel.count > 0) root.selectedIndex = displayModel.count - 1
            event.accepted = true
          } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            if (root.cursorActive) root.copyCurrent()
            else if (displayModel.count > 0) root.cursorActive = true
            event.accepted = true
          } else if (event.key === Qt.Key_Space) {
            if (event.modifiers & Qt.ControlModifier) return
            root.setFilter(root.filterText + " ")
            event.accepted = true
          } else if (event.text && event.text.length === 1 && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127) {
            if (event.modifiers & Qt.ControlModifier) return
            root.setFilter(root.filterText + event.text)
            event.accepted = true
          }
        }
      }

      Column {
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        spacing: root.contentSpacing

        Rectangle {
          width: parent.width
          height: root.headerHeight
          radius: root.cornerRadius
          color: "transparent"

          Column {
            anchors.left: parent.left
            anchors.right: hintText.left
            anchors.rightMargin: Style.space(12)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              width: parent.width
              text: root.filterText || "Search the SRD…"
              textFormat: Text.PlainText
              color: root.foreground
              opacity: root.filterText ? 1 : 0.58
              font.family: root.fontFamily
              font.pixelSize: Style.font.heading
              elide: Text.ElideRight
            }

            Text {
              width: parent.width
              visible: root.filterText === ""
              text: "mon gob  ·  sp fire  ·  weap dagger  ·  mag bag"
              textFormat: Text.PlainText
              color: root.foreground
              opacity: 0.45
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }
          }

          Text {
            id: hintText
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            text: root.copiedHint !== "" ? root.copiedHint : "Enter copies  ·  Ctrl+R rolls  ·  Ctrl+↑/↓ scrolls"
            textFormat: Text.PlainText
            color: root.foreground
            opacity: 0.45
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        Item {
          width: parent.width
          height: parent.height - root.headerHeight - root.contentSpacing

          Row {
            anchors.fill: parent
            spacing: Style.space(12)
            visible: displayModel.count > 0

            ListView {
              id: resultList
              width: Math.round(parent.width * 0.38)
              height: parent.height
              model: displayModel
              clip: true
              spacing: Style.space(4)
              boundsBehavior: Flickable.StopAtBounds
              section.property: "group"
              section.criteria: ViewSection.FullString
              section.delegate: Item {
                required property string section
                width: ListView.view.width
                height: section ? Style.font.caption + Style.space(12) : 0
                visible: section !== ""

                Text {
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.bottom: parent.bottom
                  anchors.bottomMargin: Style.space(2)
                  text: section
                  textFormat: Text.PlainText
                  color: root.foreground
                  opacity: 0.45
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  font.bold: true
                  elide: Text.ElideRight
                }
              }

              delegate: Rectangle {
                id: row
                required property int index
                required property string name
                required property string kind
                required property string kindLabel
                required property string summary
                required property string body
                required property string group
                required property int pinned

                readonly property bool hasCursor: root.cursorActive && index === root.selectedIndex

                width: ListView.view.width
                height: root.rowHeight
                radius: root.cornerRadius
                color: hasCursor ? root.selectedBackground : "transparent"

                Column {
                  anchors.fill: parent
                  anchors.leftMargin: Style.space(12)
                  anchors.rightMargin: Style.space(12)
                  anchors.topMargin: Style.space(8)
                  anchors.bottomMargin: Style.space(8)
                  spacing: Style.space(2)

                  Row {
                    width: parent.width
                    spacing: Style.space(8)

                    Text {
                      text: row.kindLabel
                      textFormat: Text.PlainText
                      color: row.hasCursor ? root.selectedText : root.foreground
                      opacity: 0.55
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                      font.bold: true
                      anchors.verticalCenter: parent.verticalCenter
                    }

                    Text {
                      width: parent.width - parent.children[0].width - parent.spacing
                      text: row.name
                      textFormat: Text.PlainText
                      color: row.hasCursor ? root.selectedText : root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      font.bold: true
                      elide: Text.ElideRight
                    }
                  }

                  Text {
                    width: parent.width
                    text: row.summary
                    textFormat: Text.PlainText
                    color: row.hasCursor ? root.selectedText : root.foreground
                    opacity: 0.7
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    elide: Text.ElideRight
                  }
                }

                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onContainsMouseChanged: if (containsMouse) {
                    root.cursorActive = true
                    root.selectedIndex = index
                  }
                  onClicked: {
                    root.cursorActive = true
                    root.selectedIndex = index
                  }
                  onDoubleClicked: root.copyCurrent()
                }
              }
            }

            Flickable {
              id: detailFlick
              width: parent.width - resultList.width - parent.spacing
              height: parent.height
              clip: true
              contentWidth: width
              contentHeight: detailColumn.implicitHeight
              boundsBehavior: Flickable.StopAtBounds
              interactive: contentHeight > height

              Column {
                id: detailColumn
                width: detailFlick.width
                spacing: Style.space(10)

                Text {
                  width: parent.width
                  text: root.currentRow() ? root.currentRow().name : ""
                  textFormat: Text.PlainText
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.title
                  font.bold: true
                  wrapMode: Text.WordWrap
                }

                Rectangle {
                  visible: root.currentRow() !== null
                  radius: height / 2
                  color: root.wash(root.selectedBackground, 0.38)
                  implicitHeight: kindPillText.implicitHeight + Style.space(6)
                  implicitWidth: kindPillText.implicitWidth + Style.space(16)
                  height: implicitHeight
                  width: implicitWidth

                  Text {
                    id: kindPillText
                    anchors.centerIn: parent
                    text: root.currentRow() ? root.currentRow().kindLabel : ""
                    textFormat: Text.PlainText
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    font.bold: true
                  }
                }

                Rectangle {
                  visible: root.rollSummary !== ""
                  width: parent.width
                  implicitHeight: rollBannerInner.implicitHeight + Style.space(14)
                  height: implicitHeight
                  radius: Math.max(6, Math.round(root.cornerRadius * 0.45))
                  color: root.wash(root.selectedBackground, 0.22)
                  border.color: root.border
                  border.width: 1

                  Column {
                    id: rollBannerInner
                    x: Style.space(12)
                    y: Style.space(7)
                    width: parent.width - Style.space(24)
                    spacing: Style.space(2)

                    Text {
                      width: parent.width
                      text: root.rollTitle !== "" ? root.rollTitle + "  ·  " + root.rollSummary : root.rollSummary
                      textFormat: Text.PlainText
                      color: root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      font.bold: true
                      wrapMode: Text.WordWrap
                    }

                    Text {
                      width: parent.width
                      visible: root.rollDetail !== ""
                      text: root.rollDetail
                      textFormat: Text.PlainText
                      color: root.foreground
                      opacity: 0.75
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                      wrapMode: Text.WordWrap
                    }
                  }
                }

                Repeater {
                  model: bodyModel

                  Column {
                    id: blockCol
                    required property string kind
                    required property string text
                    required property string caption
                    required property int colCount
                    required property int rowCount
                    required property int ordered
                    required property string headersJson
                    required property string rowsJson
                    required property string weightsJson
                    required property string itemsJson
                    required property string rollJson
                    required property int tableRollIndex
                    required property string diceJson

                    width: detailColumn.width
                    spacing: Style.space(6)

                    Text {
                      width: parent.width
                      visible: blockCol.kind === "heading"
                      text: blockCol.kind === "heading" ? blockCol.text : ""
                      textFormat: Text.PlainText
                      color: root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      font.bold: true
                      wrapMode: Text.WordWrap
                    }

                    Rectangle {
                      visible: blockCol.kind === "heading"
                      width: Math.min(parent.width, Style.space(64))
                      height: 1
                      color: root.border
                      opacity: 0.45
                    }

                    Text {
                      width: parent.width
                      visible: blockCol.kind === "text"
                      text: blockCol.kind === "text" ? blockCol.text : ""
                      textFormat: Text.PlainText
                      color: root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      wrapMode: Text.WordWrap
                    }

                    Flow {
                      width: parent.width
                      visible: blockCol.diceJson !== "" && blockCol.diceJson !== "[]"
                      spacing: Style.space(8)

                      Repeater {
                        model: {
                          try {
                            return JSON.parse(blockCol.diceJson)
                          } catch (e) {
                            return []
                          }
                        }

                        Rectangle {
                          required property var modelData
                          readonly property int rollIndex: Number(modelData && modelData.rollIndex)
                          radius: height / 2
                          color: root.rollChipColor(rollIndex)
                          border.color: root.border
                          border.width: rollIndex === root.selectedRoll ? 2 : 1
                          implicitHeight: diceChipText.implicitHeight + Style.space(8)
                          implicitWidth: diceChipText.implicitWidth + Style.space(18)
                          height: implicitHeight
                          width: implicitWidth

                          Text {
                            id: diceChipText
                            anchors.centerIn: parent
                            text: "Roll " + String(modelData && modelData.title ? modelData.title : "dice")
                            textFormat: Text.PlainText
                            color: root.foreground
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.caption
                            font.bold: true
                          }

                          MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: root.performRoll(JSON.stringify(modelData), rollIndex)
                          }
                        }
                      }
                    }

                    Flow {
                      width: parent.width
                      visible: blockCol.kind === "stats" && blockCol.rowCount > 0
                      spacing: Style.space(8)

                      Repeater {
                        model: blockCol.kind === "stats" ? blockCol.rowCount : 0

                        Rectangle {
                          required property int index
                          radius: Math.max(6, Math.round(root.cornerRadius * 0.4))
                          color: root.wash(root.foreground, 0.06)
                          border.color: root.border
                          border.width: 1
                          implicitWidth: Math.min(
                            blockCol.width,
                            Math.max(Style.space(88), statChipInner.implicitWidth + Style.space(16))
                          )
                          implicitHeight: statChipInner.implicitHeight + Style.space(12)
                          height: implicitHeight
                          width: implicitWidth

                          Column {
                            id: statChipInner
                            x: Style.space(8)
                            y: Style.space(6)
                            width: Math.min(blockCol.width - Style.space(16), implicitWidth)
                            spacing: Style.space(2)

                            Text {
                              text: Search.itemField(blockCol.itemsJson, index, "label")
                              textFormat: Text.PlainText
                              color: root.foreground
                              opacity: 0.55
                              font.family: root.fontFamily
                              font.pixelSize: Style.font.caption
                              font.bold: true
                            }

                            Text {
                              width: Math.min(blockCol.width - Style.space(40), Math.max(Style.space(72), implicitWidth))
                              text: Search.itemField(blockCol.itemsJson, index, "value")
                              textFormat: Text.PlainText
                              color: root.foreground
                              font.family: root.fontFamily
                              font.pixelSize: Style.font.caption
                              wrapMode: Text.WordWrap
                            }
                          }
                        }
                      }
                    }

                    Rectangle {
                      visible: blockCol.kind === "quote"
                      width: parent.width
                      implicitHeight: quoteInner.implicitHeight + Style.space(16)
                      height: implicitHeight
                      radius: Math.max(6, Math.round(root.cornerRadius * 0.45))
                      color: root.wash(root.selectedBackground, 0.12)
                      border.color: root.border
                      border.width: 1
                      clip: true

                      Rectangle {
                        width: Style.space(4)
                        height: parent.height
                        color: root.selectedBackground
                      }

                      Column {
                        id: quoteInner
                        x: Style.space(14)
                        y: Style.space(8)
                        width: parent.width - Style.space(22)
                        spacing: Style.space(4)

                        Text {
                          width: parent.width
                          visible: blockCol.caption !== ""
                          text: blockCol.caption
                          textFormat: Text.PlainText
                          color: root.foreground
                          font.family: root.fontFamily
                          font.pixelSize: Style.font.caption
                          font.bold: true
                          wrapMode: Text.WordWrap
                        }

                        Text {
                          width: parent.width
                          text: blockCol.text
                          textFormat: Text.PlainText
                          color: root.foreground
                          opacity: 0.92
                          font.family: root.fontFamily
                          font.pixelSize: Style.font.body
                          wrapMode: Text.WordWrap
                        }
                      }
                    }

                    Column {
                      width: parent.width
                      visible: blockCol.kind === "list" && blockCol.rowCount > 0
                      spacing: Style.space(8)

                      Repeater {
                        model: blockCol.kind === "list" ? blockCol.rowCount : 0

                        Row {
                          required property int index
                          width: parent.width
                          spacing: Style.space(8)
                          readonly property string itemLabel: Search.itemField(blockCol.itemsJson, index, "label")
                          readonly property string itemBody: Search.itemField(blockCol.itemsJson, index, "body")
                          readonly property string itemRoll: Search.actionRollJson(itemLabel, itemBody)
                          readonly property int itemRollIndex: Search.itemInt(blockCol.itemsJson, index, "rollIndex", -1)

                          Item {
                            width: Style.space(16)
                            height: Style.space(16)

                            Rectangle {
                              visible: blockCol.ordered === 0
                              width: Style.space(7)
                              height: Style.space(7)
                              radius: width / 2
                              color: root.selectedBackground
                              anchors.horizontalCenter: parent.horizontalCenter
                              anchors.top: parent.top
                              anchors.topMargin: Math.max(2, Math.round((Style.font.body - height) / 2))
                            }

                            Text {
                              visible: blockCol.ordered !== 0
                              anchors.horizontalCenter: parent.horizontalCenter
                              anchors.top: parent.top
                              text: Search.itemField(blockCol.itemsJson, index, "marker")
                              textFormat: Text.PlainText
                              color: root.selectedBackground
                              font.family: root.fontFamily
                              font.pixelSize: Style.font.caption
                              font.bold: true
                            }
                          }

                          Column {
                            width: parent.width - Style.space(24) - (itemRoll !== "" ? Style.space(64) : 0)
                            spacing: Style.space(2)

                            Text {
                              width: parent.width
                              visible: itemLabel !== ""
                              text: itemLabel
                              textFormat: Text.PlainText
                              color: root.foreground
                              font.family: root.fontFamily
                              font.pixelSize: Style.font.body
                              font.bold: true
                              wrapMode: Text.WordWrap
                            }

                            Text {
                              width: parent.width
                              text: itemBody
                              textFormat: Text.PlainText
                              color: root.foreground
                              opacity: itemLabel !== "" ? 0.88 : 1
                              font.family: root.fontFamily
                              font.pixelSize: Style.font.body
                              wrapMode: Text.WordWrap
                            }
                          }

                          Rectangle {
                            visible: itemRoll !== ""
                            radius: height / 2
                            color: root.rollChipColor(itemRollIndex)
                            border.color: root.border
                            border.width: itemRollIndex === root.selectedRoll ? 2 : 1
                            implicitHeight: Style.font.caption + Style.space(10)
                            implicitWidth: rollChipLabel.implicitWidth + Style.space(16)
                            height: implicitHeight
                            width: implicitWidth
                            anchors.top: parent.top

                            Text {
                              id: rollChipLabel
                              anchors.centerIn: parent
                              text: "Roll"
                              textFormat: Text.PlainText
                              color: root.foreground
                              font.family: root.fontFamily
                              font.pixelSize: Style.font.caption
                              font.bold: true
                            }

                            MouseArea {
                              anchors.fill: parent
                              cursorShape: Qt.PointingHandCursor
                              onClicked: root.performRoll(itemRoll, itemRollIndex)
                            }
                          }
                        }
                      }
                    }

                    Row {
                      width: parent.width
                      visible: blockCol.kind === "table" && (blockCol.caption !== "" || blockCol.rollJson !== "")
                      spacing: Style.space(8)

                      Text {
                        width: parent.width - (blockCol.rollJson !== "" ? Style.space(80) : 0)
                        visible: blockCol.caption !== ""
                        text: blockCol.caption
                        textFormat: Text.PlainText
                        color: root.foreground
                        opacity: 0.62
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.caption
                        font.bold: true
                        wrapMode: Text.WordWrap
                      }

                      Rectangle {
                        visible: blockCol.rollJson !== ""
                        radius: height / 2
                        color: root.rollChipColor(blockCol.tableRollIndex)
                        border.color: root.border
                        border.width: blockCol.tableRollIndex === root.selectedRoll ? 2 : 1
                        implicitHeight: Style.font.caption + Style.space(10)
                        implicitWidth: tableRollLabel.implicitWidth + Style.space(16)
                        height: implicitHeight
                        width: implicitWidth

                        Text {
                          id: tableRollLabel
                          anchors.centerIn: parent
                          text: "Roll"
                          textFormat: Text.PlainText
                          color: root.foreground
                          font.family: root.fontFamily
                          font.pixelSize: Style.font.caption
                          font.bold: true
                        }

                        MouseArea {
                          anchors.fill: parent
                          cursorShape: Qt.PointingHandCursor
                          onClicked: root.performRoll(blockCol.rollJson, blockCol.tableRollIndex)
                        }
                      }
                    }

                    Rectangle {
                      id: tableFrame
                      visible: blockCol.kind === "table" && blockCol.rowCount > 0
                      width: parent.width
                      implicitHeight: visible ? tableRows.implicitHeight + 2 : 0
                      height: implicitHeight
                      radius: Math.max(6, Math.round(root.cornerRadius * 0.45))
                      color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.035)
                      border.color: root.border
                      border.width: 1
                      clip: true

                      Column {
                        id: tableRows
                        width: parent.width
                        y: 1

                        Repeater {
                          model: blockCol.rowCount

                          Rectangle {
                            id: tableRow
                            required property int index
                            width: tableRows.width
                            readonly property int rowIndex: index
                            readonly property bool isHeader: rowIndex === 0
                            readonly property bool isLast: rowIndex === blockCol.rowCount - 1
                            readonly property bool isRolled: !isHeader && rowIndex === root.rollTableRow && (
                              blockCol.caption === root.rollTableKey
                              || (blockCol.caption === "" && Search.tableCell(blockCol.headersJson, blockCol.rowsJson, 0, 0) === root.rollTableKey)
                            )
                            implicitHeight: rowInner.implicitHeight + Style.space(10)
                            height: implicitHeight
                            color: tableRow.isHeader
                              ? Qt.rgba(root.selectedBackground.r, root.selectedBackground.g, root.selectedBackground.b, 0.38)
                              : (tableRow.isRolled
                                  ? Qt.rgba(root.selectedBackground.r, root.selectedBackground.g, root.selectedBackground.b, 0.32)
                                  : (tableRow.rowIndex % 2 === 0
                                      ? Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.04)
                                      : "transparent"))

                            Row {
                              id: rowInner
                              x: Style.space(8)
                              y: Style.space(5)
                              width: parent.width - Style.space(16)
                              spacing: Style.space(10)

                              Repeater {
                                model: blockCol.colCount

                                Text {
                                  required property int index
                                  readonly property real weight: Search.tableWeight(blockCol.weightsJson, index, blockCol.colCount)
                                  width: Math.max(1, Math.floor((rowInner.width - rowInner.spacing * Math.max(0, blockCol.colCount - 1)) * weight))
                                  text: Search.tableCell(blockCol.headersJson, blockCol.rowsJson, tableRow.rowIndex, index)
                                  textFormat: Text.PlainText
                                  color: root.foreground
                                  opacity: tableRow.isHeader || index === 0 ? 1 : 0.88
                                  font.family: root.fontFamily
                                  font.pixelSize: Style.font.caption
                                  font.bold: tableRow.isHeader || index === 0
                                  wrapMode: Text.WordWrap
                                }
                              }
                            }

                            Rectangle {
                              anchors.left: parent.left
                              anchors.right: parent.right
                              anchors.bottom: parent.bottom
                              height: 1
                              visible: !tableRow.isLast
                              color: root.border
                              opacity: tableRow.isHeader ? 0.7 : 0.28
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }

          Column {
            anchors.centerIn: parent
            spacing: Style.space(8)
            visible: displayModel.count === 0
            width: parent.width * 0.7

            Text {
              width: parent.width
              text: root.entries.length === 0 ? "No SRD index loaded" : "No matches for “" + root.filterText + "”"
              textFormat: Text.PlainText
              color: root.foreground
              opacity: 0.7
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              horizontalAlignment: Text.AlignHCenter
              wrapMode: Text.WordWrap
            }
          }
        }
      }
    }
  }
}
