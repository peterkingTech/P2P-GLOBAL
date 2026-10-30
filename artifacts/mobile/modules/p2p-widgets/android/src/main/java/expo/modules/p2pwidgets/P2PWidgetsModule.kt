package expo.modules.p2pwidgets

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS bridge — see lib/widgetSync.ts. Stores the snapshot, then redraws every placed P2P widget. */
class P2PWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("P2PWidgets")

    Function("setSnapshot") { json: String ->
      val ctx = appContext.reactContext
      if (ctx != null) {
        WidgetStore.write(ctx, json)
        P2PWidgets.updateAll(ctx)
      }
    }

    Function("clearSnapshot") {
      val ctx = appContext.reactContext
      if (ctx != null) {
        WidgetStore.clear(ctx)
        P2PWidgets.updateAll(ctx)
      }
    }

    AsyncFunction("hasInstalledWidgets") {
      val ctx = appContext.reactContext
      if (ctx == null) false else P2PWidgets.installedCount(ctx) > 0
    }
  }
}
