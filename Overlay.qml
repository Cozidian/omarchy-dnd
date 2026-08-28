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

  function open(payloadJson) {
    root.opened = true
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
    var out = Search.filterEntries(root.entries, root.filterText, 80)
    displayModel.clear()
    for (var i = 0; i < out.length; i++) {
      displayModel.append({
        name: String(out[i].name || ""),
        kind: String(out[i].kind || ""),
        kindLabel: Search.kindLabel(out[i].kind),
        summary: String(out[i].summary || ""),
        body: String(out[i].body || "")
      })
    }
    if (displayModel.count === 0) selectedIndex = 0
    else if (selectedIndex >= displayModel.count) selectedIndex = displayModel.count - 1
    else if (selectedIndex < 0) selectedIndex = 0
    cursorActive = displayModel.count > 0
    Qt.callLater(function() {
      if (displayModel.count > 0) resultList.positionViewAtIndex(root.selectedIndex, ListView.Contain)
    })
  }

  function setFilter(nextFilter) {
    root.filterText = Search.sanitizeFilter(nextFilter)
    root.selectedIndex = 0
    root.cursorActive = true
    root.copiedHint = ""
    root.rebuildDisplay()
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

  function currentRow() {
    if (selectedIndex < 0 || selectedIndex >= displayModel.count) return null
    return displayModel.get(selectedIndex)
  }

  function copyCurrent() {
    var row = root.currentRow()
    if (!row) return
    var text = Search.copyText(row)
    if (!text) return
    Quickshell.execDetached(["bash", "-c", "printf %s " + Util.shellQuote(text) + " | wl-copy"])
    root.copiedHint = "Copied"
    copiedTimer.restart()
  }

  ListModel { id: displayModel }

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
    id: indexReader
    running: false
    command: (root.dataPath && root.indexReaderScript)
      ? ["/usr/bin/python3", "-B", "--", root.indexReaderScript, root.dataPath, String(Search.MAX_INDEX_BYTES)]
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

  Component.onCompleted: root.readIndexBounded()

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
              text: "spell fireball  ·  monster goblin  ·  rule cover  ·  feat alert"
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
            text: root.copiedHint !== "" ? root.copiedHint : "Enter copies  ·  Esc closes"
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

              delegate: Rectangle {
                id: row
                required property int index
                required property string name
                required property string kind
                required property string kindLabel
                required property string summary
                required property string body

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

                Text {
                  width: parent.width
                  visible: root.currentRow() !== null
                  text: root.currentRow() ? root.currentRow().kindLabel : ""
                  textFormat: Text.PlainText
                  color: root.foreground
                  opacity: 0.55
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  font.bold: true
                }

                Text {
                  width: parent.width
                  text: root.currentRow() ? root.currentRow().body : ""
                  textFormat: Text.PlainText
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  wrapMode: Text.WordWrap
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
