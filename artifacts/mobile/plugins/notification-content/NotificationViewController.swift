import AVFoundation
import UIKit
import UserNotifications
import UserNotificationsUI

// P2P Global — iOS Notification Content Extension (the long-press view).
//
// Used for pushes in category "p2p_message" (sent only when the recipient
// shows sender identity: "Name and message" or "Name only"; never for
// "Nothing", never for calls). Layout: sender photo LEFT, name + text in the
// middle, P2P mark RIGHT; for an attached voice note, a play/pause button.
//
// It shows ONLY what the Notification Service Extension put in the delivered
// notification (title/body, userInfo["p2pPreview"], the "voice" attachment)
// — it fetches nothing itself. Name only → identity + generic wording, no text
// or audio. iOS's own lock-screen preview setting is respected by the system
// (this view only appears when iOS allows the notification to expand).
//
// Tapping anywhere except the play button performs the notification's
// default action — the app opens and the existing tap handler routes and
// marks read exactly once. Audio stops when the view goes away.
class NotificationViewController: UIViewController, UNNotificationContentExtension, AVAudioPlayerDelegate {
  private let avatar = UIImageView()
  private let initialLabel = UILabel()
  private let nameLabel = UILabel()
  private let bodyLabel = UILabel()
  private let logo = UIImageView()
  private let playButton = UIButton(type: .system)
  private let voiceLabel = UILabel()
  private let voiceRow = UIStackView()

  private var player: AVAudioPlayer?
  private var scopedURL: URL?
  private var durationText = ""

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear

    avatar.contentMode = .scaleAspectFill
    avatar.clipsToBounds = true
    avatar.layer.cornerRadius = 24
    avatar.backgroundColor = .secondarySystemFill
    avatar.isAccessibilityElement = false
    initialLabel.font = UIFont.preferredFont(forTextStyle: .title3)
    initialLabel.textColor = .secondaryLabel
    initialLabel.textAlignment = .center
    avatar.addSubview(initialLabel)

    nameLabel.font = UIFont.preferredFont(forTextStyle: .headline)
    nameLabel.adjustsFontForContentSizeCategory = true
    nameLabel.textColor = .label
    nameLabel.numberOfLines = 1
    bodyLabel.font = UIFont.preferredFont(forTextStyle: .body)
    bodyLabel.adjustsFontForContentSizeCategory = true
    bodyLabel.textColor = .label
    bodyLabel.numberOfLines = 0

    logo.contentMode = .scaleAspectFit
    logo.image = UIImage(named: "P2PLogo", in: Bundle(for: NotificationViewController.self), compatibleWith: nil)
    logo.layer.cornerRadius = 6
    logo.clipsToBounds = true
    logo.isAccessibilityElement = true
    logo.accessibilityLabel = "P2P Global"

    playButton.tintColor = .systemGreen
    playButton.addTarget(self, action: #selector(togglePlayback), for: .touchUpInside)
    playButton.accessibilityLabel = "Play voice message"
    voiceLabel.font = UIFont.preferredFont(forTextStyle: .subheadline)
    voiceLabel.adjustsFontForContentSizeCategory = true
    voiceLabel.textColor = .secondaryLabel
    voiceLabel.numberOfLines = 0
    voiceRow.axis = .horizontal
    voiceRow.spacing = 10
    voiceRow.alignment = .center
    voiceRow.addArrangedSubview(playButton)
    voiceRow.addArrangedSubview(voiceLabel)
    voiceRow.isHidden = true

    let textStack = UIStackView(arrangedSubviews: [nameLabel, bodyLabel, voiceRow])
    textStack.axis = .vertical
    textStack.spacing = 4

    let row = UIStackView(arrangedSubviews: [avatar, textStack, logo])
    row.axis = .horizontal
    row.alignment = .top
    row.spacing = 12
    row.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(row)
    initialLabel.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      row.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
      row.topAnchor.constraint(equalTo: view.topAnchor, constant: 14),
      row.bottomAnchor.constraint(lessThanOrEqualTo: view.bottomAnchor, constant: -14),
      avatar.widthAnchor.constraint(equalToConstant: 48),
      avatar.heightAnchor.constraint(equalToConstant: 48),
      logo.widthAnchor.constraint(equalToConstant: 28),
      logo.heightAnchor.constraint(equalToConstant: 28),
      playButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
      playButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
      initialLabel.centerXAnchor.constraint(equalTo: avatar.centerXAnchor),
      initialLabel.centerYAnchor.constraint(equalTo: avatar.centerYAnchor),
    ])

    // Taps outside the play button open the app the normal way.
    let tap = UITapGestureRecognizer(target: self, action: #selector(openApp))
    tap.cancelsTouchesInView = false
    view.addGestureRecognizer(tap)
  }

  func didReceive(_ notification: UNNotification) {
    let content = notification.request.content
    let p2p = content.userInfo["p2pPreview"] as? [String: Any] ?? [:]
    let name = content.title.isEmpty ? "P2P Global" : content.title
    nameLabel.text = name
    initialLabel.text = String(name.prefix(1)).uppercased()

    if let b64 = p2p["photo"] as? String, let data = Data(base64Encoded: b64), let img = UIImage(data: data) {
      avatar.image = img
      initialLabel.isHidden = true
    }

    let kind = p2p["kind"] as? String
    if kind == "text", let text = p2p["text"] as? String, !text.isEmpty {
      bodyLabel.text = text
    } else {
      bodyLabel.text = content.body // generic wording ("sent you a message")
    }

    if let d = p2p["durationSeconds"] as? NSNumber, d.intValue > 0 {
      durationText = String(format: "%d:%02d", d.intValue / 60, d.intValue % 60)
    }
    if kind == "voice" {
      if (p2p["voiceAttached"] as? Bool) == true, let attachment = content.attachments.first(where: { $0.identifier == "voice" }) {
        prepareAudio(attachment.url)
      } else if (p2p["voiceTooLong"] as? Bool) == true {
        showVoice(enabled: false, text: "This voice message is too long to preview here. Tap to open P2P Global.")
      }
    }
    view.accessibilityLabel = [name, bodyLabel.text].compactMap { $0 }.joined(separator: ". ")
    resizeToFit()
  }

  // Grow/shrink the expanded view to the content (long texts aren't clipped).
  private func resizeToFit() {
    guard let row = view.subviews.first else { return }
    let width = view.bounds.width > 0 ? view.bounds.width : UIScreen.main.bounds.width
    let fitted = row.systemLayoutSizeFitting(
      CGSize(width: width - 32, height: UIView.layoutFittingCompressedSize.height),
      withHorizontalFittingPriority: .required,
      verticalFittingPriority: .fittingSizeLevel
    )
    preferredContentSize = CGSize(width: width, height: ceil(fitted.height) + 28)
  }

  // MARK: - Voice

  private func prepareAudio(_ url: URL) {
    let scoped = url.startAccessingSecurityScopedResource()
    if scoped { scopedURL = url }
    guard let p = try? AVAudioPlayer(contentsOf: url) else {
      showVoice(enabled: false, text: "Voice message unavailable. Tap to open P2P Global.")
      return
    }
    p.delegate = self
    p.prepareToPlay()
    player = p
    if durationText.isEmpty, p.duration > 0 {
      let s = Int(p.duration.rounded())
      durationText = String(format: "%d:%02d", s / 60, s % 60)
    }
    showVoice(enabled: true, text: durationText.isEmpty ? "Voice message" : "Voice message · \(durationText)")
    NotificationCenter.default.addObserver(self, selector: #selector(audioInterrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
  }

  private func showVoice(enabled: Bool, text: String) {
    voiceRow.isHidden = false
    playButton.isHidden = !enabled
    voiceLabel.text = text
    updatePlayButton(playing: false)
    resizeToFit()
  }

  private func updatePlayButton(playing: Bool) {
    let symbol = playing ? "pause.circle.fill" : "play.circle.fill"
    playButton.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 30)), for: .normal)
    playButton.accessibilityLabel = playing ? "Pause voice message" : "Play voice message"
  }

  @objc private func togglePlayback() {
    guard let p = player else { return }
    if p.isPlaying {
      p.pause()
      updatePlayButton(playing: false)
    } else {
      try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
      try? AVAudioSession.sharedInstance().setActive(true)
      if p.play() { updatePlayButton(playing: true) }
    }
  }

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    player.currentTime = 0
    updatePlayButton(playing: false)
  }

  @objc private func audioInterrupted(_ note: Notification) {
    player?.pause()
    updatePlayButton(playing: false)
  }

  @objc private func openApp() {
    stopAudio()
    extensionContext?.performNotificationDefaultAction()
  }

  private func stopAudio() {
    player?.stop()
    player = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    if let url = scopedURL { url.stopAccessingSecurityScopedResource(); scopedURL = nil }
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    stopAudio()
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    player?.stop()
    if let url = scopedURL { url.stopAccessingSecurityScopedResource() }
  }
}
