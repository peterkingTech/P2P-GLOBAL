import ExpoModulesCore
import WidgetKit

/// JS bridge — see lib/widgetSync.ts. Stores ONE JSON snapshot in the App
/// Group shared with the widget extension (plugins/withP2PWidgets.js), then
/// asks WidgetKit to redraw. The App Group id comes from Info.plist
/// ("P2PAppGroup", set by the plugin) so staging builds use their own group.
public class P2PWidgetsModule: Module {
  static let snapshotKey = "p2p.widgets.snapshot"

  static var sharedDefaults: UserDefaults? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "P2PAppGroup") as? String, !group.isEmpty else { return nil }
    return UserDefaults(suiteName: group)
  }

  public func definition() -> ModuleDefinition {
    Name("P2PWidgets")

    Function("setSnapshot") { (json: String) in
      P2PWidgetsModule.sharedDefaults?.set(json, forKey: P2PWidgetsModule.snapshotKey)
      WidgetCenter.shared.reloadAllTimelines()
    }

    Function("clearSnapshot") {
      P2PWidgetsModule.sharedDefaults?.removeObject(forKey: P2PWidgetsModule.snapshotKey)
      WidgetCenter.shared.reloadAllTimelines()
    }

    AsyncFunction("hasInstalledWidgets") { (promise: Promise) in
      WidgetCenter.shared.getCurrentConfigurations { result in
        switch result {
        case .success(let infos): promise.resolve(!infos.isEmpty)
        case .failure: promise.resolve(false)
        }
      }
    }
  }
}
