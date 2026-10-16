import Intents
import UserNotifications

// P2P Global — iOS Notification Service Extension (sender photos on banners).
//
// Runs on the device when a push with `mutable-content` arrives (the API sets
// it only when it attaches a sender photo: lib/notificationPrivacy.ts +
// pushDispatch.ts). Expo delivers the photo URL at
// userInfo["body"]["_richContent"]["image"] and our own data (senderId,
// conversationId, …) in userInfo["body"].
//
// 1. Preferred: a Communication Notification — the sender's photo and name
//    shown like a messaging app (INSendMessageIntent, iOS 15+). Needs the
//    "Communication Notifications" capability on the app.
// 2. Fallback: the photo as an image attachment.
// 3. Anything fails or times out: the original notification, unchanged.
// Never adds message content; the title/body are exactly what the server sent.
class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttemptContent: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    bestAttemptContent = content

    let body = request.content.userInfo["body"] as? [String: Any] ?? [:]
    guard let rich = body["_richContent"] as? [String: Any],
          let urlString = rich["image"] as? String,
          let url = URL(string: urlString),
          url.scheme == "https" else {
      contentHandler(content)
      return
    }

    let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, _ in
      guard let self = self else { return }
      let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
      guard ok, let data = data, !data.isEmpty, data.count < 5_000_000 else {
        self.finish(content)
        return
      }
      if #available(iOS 15.0, *), let updated = self.communicationContent(content, body: body, imageData: data) {
        self.finish(updated)
        return
      }
      self.finish(self.withAttachment(content, data: data))
    }
    task.resume()
  }

  override func serviceExtensionTimeWillExpire() {
    if let bestAttemptContent = bestAttemptContent { finish(bestAttemptContent) }
  }

  private func finish(_ content: UNNotificationContent) {
    guard let handler = contentHandler else { return }
    contentHandler = nil
    handler(content)
  }

  @available(iOS 15.0, *)
  private func communicationContent(_ content: UNMutableNotificationContent, body: [String: Any], imageData: Data) -> UNNotificationContent? {
    let senderId = (body["senderId"] ?? body["fromUserId"] ?? body["responderId"] ?? body["learnerId"] ?? body["requesterId"] ?? body["callerId"]) as? String
    guard let senderId = senderId, !content.title.isEmpty else { return nil }
    let sender = INPerson(
      personHandle: INPersonHandle(value: senderId, type: .unknown),
      nameComponents: nil,
      displayName: content.title,
      image: INImage(imageData: imageData),
      contactIdentifier: nil,
      customIdentifier: senderId
    )
    let conversationId = (body["conversationId"] as? String) ?? senderId
    let intent = INSendMessageIntent(
      recipients: nil,
      outgoingMessageType: .outgoingMessageText,
      content: content.body,
      speakableGroupName: nil,
      conversationIdentifier: conversationId,
      serviceName: nil,
      sender: sender,
      attachments: nil
    )
    intent.setImage(INImage(imageData: imageData), forParameterNamed: \.sender)
    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .incoming
    interaction.donate(completion: nil)
    return try? content.updating(from: intent)
  }

  private func withAttachment(_ content: UNMutableNotificationContent, data: Data) -> UNNotificationContent {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString, isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let file = dir.appendingPathComponent("sender.jpg")
      try data.write(to: file)
      let attachment = try UNNotificationAttachment(identifier: "sender-photo", url: file, options: nil)
      content.attachments = [attachment]
    } catch {
      // Keep the notification without a photo.
    }
    return content
  }
}
