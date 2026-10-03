package expo.modules.callforegroundservice

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CallForegroundServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CallForegroundService")

    Function("start") { isVideo: Boolean ->
      val context = appContext.reactContext ?: return@Function
      CallForegroundService.start(context, isVideo)
    }

    Function("stop") {
      appContext.reactContext?.let { CallForegroundService.stop(it) }
    }
  }
}
