import ExpoModulesCore
import AVFoundation
import MediaPlayer

/// JS bridge — see lib/listen/fileSpeech.ts.
///
/// 1. `synthesize`: the phone's OWN voice (AVSpeechSynthesizer) written to a
///    temporary audio file instead of the speaker, so the shared Listen player
///    can play it through expo-audio — real background audio with a lock
///    screen. The file lives in Caches/p2p-speech and is deleted after it is
///    played (`remove`); nothing is kept (licensed text).
/// 2. `setTrackCommands`: the lock screen / headphones "next" and "previous"
///    buttons (expo-audio's own Now Playing session doesn't offer them), sent
///    to JS as `onRemoteCommand` so they move between Scripture passages.
public class P2PSpeechAudioModule: Module {
  private let synthesizer = AVSpeechSynthesizer()
  private var nextTarget: Any?
  private var previousTarget: Any?

  static var folder: URL {
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("p2p-speech", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  public func definition() -> ModuleDefinition {
    Name("P2PSpeechAudio")
    Events("onRemoteCommand")

    AsyncFunction("synthesize") { (text: String, language: String, voice: String?, rate: Double, promise: Promise) in
      let utterance = AVSpeechUtterance(string: text)
      if let voice, let v = AVSpeechSynthesisVoice(identifier: voice) { utterance.voice = v }
      else if !language.isEmpty { utterance.voice = AVSpeechSynthesisVoice(language: language) }
      // Same rate scale as expo-speech (1.0 = the system's normal speed).
      utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, Float(rate) * AVSpeechUtteranceDefaultSpeechRate))

      let url = P2PSpeechAudioModule.folder.appendingPathComponent("\(UUID().uuidString).caf")
      var file: AVAudioFile?
      var frames: AVAudioFramePosition = 0
      var sampleRate: Double = 0
      var finished = false
      self.synthesizer.write(utterance) { buffer in
        guard !finished, let pcm = buffer as? AVAudioPCMBuffer else { return }
        if pcm.frameLength == 0 {
          // The end of the utterance.
          finished = true
          if file == nil { promise.reject("E_EMPTY", "The voice produced no audio for this text."); return }
          file = nil   // closes the file
          let ms = sampleRate > 0 ? Int(Double(frames) / sampleRate * 1000) : 0
          promise.resolve(["uri": url.absoluteString, "durationMs": ms])
          return
        }
        do {
          if file == nil {
            file = try AVAudioFile(forWriting: url, settings: pcm.format.settings, commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
            sampleRate = pcm.format.sampleRate
          }
          try file?.write(from: pcm)
          frames += AVAudioFramePosition(pcm.frameLength)
        } catch {
          finished = true
          file = nil
          promise.reject("E_WRITE", "Couldn't prepare the audio: \(error.localizedDescription)")
        }
      }
    }

    Function("remove") { (uri: String) in
      guard let url = URL(string: uri), url.isFileURL, url.path.hasPrefix(P2PSpeechAudioModule.folder.path) else { return }
      try? FileManager.default.removeItem(at: url)
    }

    Function("clearAll") {
      let dir = P2PSpeechAudioModule.folder
      for f in (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] { try? FileManager.default.removeItem(at: f) }
    }

    Function("setTrackCommands") { (enabled: Bool) in
      DispatchQueue.main.async {
        let center = MPRemoteCommandCenter.shared()
        if let t = self.nextTarget { center.nextTrackCommand.removeTarget(t); self.nextTarget = nil }
        if let t = self.previousTarget { center.previousTrackCommand.removeTarget(t); self.previousTarget = nil }
        center.nextTrackCommand.isEnabled = enabled
        center.previousTrackCommand.isEnabled = enabled
        guard enabled else { return }
        self.nextTarget = center.nextTrackCommand.addTarget { [weak self] _ in
          self?.sendEvent("onRemoteCommand", ["command": "next"]); return .success
        }
        self.previousTarget = center.previousTrackCommand.addTarget { [weak self] _ in
          self?.sendEvent("onRemoteCommand", ["command": "previous"]); return .success
        }
      }
    }

    Function("trackCommandsSupported") { () -> Bool in true }
  }
}
