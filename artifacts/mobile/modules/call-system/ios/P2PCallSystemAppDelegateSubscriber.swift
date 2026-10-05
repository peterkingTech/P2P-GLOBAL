import ExpoModulesCore
import UIKit

/// Starts PushKit at launch — a VoIP push that wakes a closed app must find
/// a registry already waiting — and routes Phone → Recents "call back" taps.
public class P2PCallSystemAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    CallKitManager.shared.startPushRegistry()
    return true
  }

  public func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([any UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    return CallKitManager.shared.handleUserActivity(userActivity)
  }
}
