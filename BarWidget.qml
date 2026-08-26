import QtQuick
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "io.github.cozidian.dnd"

  function toggleOverlay() {
    if (root.bar && root.bar.shell && typeof root.bar.shell.toggle === "function") {
      root.bar.shell.toggle(root.moduleName, "{}")
      return
    }
    if (root.bar) root.bar.run("omarchy-shell shell toggle io.github.cozidian.dnd '{}'")
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰂺"
    tooltipText: "Search the SRD"
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.LeftButton) root.toggleOverlay()
    }
  }
}
