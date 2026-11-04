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
  private var nextTarget: Any?
  private var previousTarget: Any?
  // Sentences are written ONE AT A TIME, each with its own synthesizer: a second
  // write on a synthesizer that is still writing silently ends the first (its
  // promise never settled, so a playlist stopped after the passage heading).
  // Touched on the main queue only.
  private var pending: [SpeechJob] = []
  private var running: SpeechJob?

  static var folder: URL {
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("p2p-speech", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  private func runNext() {
    guard running == nil, !pending.isEmpty else { return }
    let job = pending.removeFirst()
    running = job
    job.start { [weak self] in
      DispatchQueue.main.async {
        guard let self else { return }
        if self.running === job { self.running = nil }
        self.runNext()
      }
    }
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
      // Writing is much faster than speaking; this only stops a stuck job from blocking the queue.
      let timeout = 12.0 + Double(text.count) * 0.05 / max(rate, 0.25)
      let job = SpeechJob(utterance: utterance, url: url, timeout: timeout, promise: promise)
      DispatchQueue.main.async {
        self.pending.append(job)
        self.runNext()
      }
    }

    Function("remove") { (uri: String) in
      guard let url = URL(string: uri), url.isFileURL, url.path.hasPrefix(P2PSpeechAudioModule.folder.path) else { return }
      try? FileManager.default.removeItem(at: url)
    }

    Function("clearAll") {
      DispatchQueue.main.async {
        for job in self.pending { job.cancel() }
        self.pending.removeAll()
      }
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

/// One sentence written to one file. It ends exactly once, at whichever comes
/// first: the synthesizer's empty end-of-audio buffer, its "finished" delegate
/// call (some iOS versions never send the empty buffer), or the time limit.
private final class SpeechJob: NSObject, AVSpeechSynthesizerDelegate {
  private let synthesizer = AVSpeechSynthesizer()
  private let utterance: AVSpeechUtterance
  private let url: URL
  private let timeout: TimeInterval
  private let promise: Promise
  // Buffers arrive on a background thread; everything below is guarded by `lock`.
  private let lock = NSLock()
  private var file: AVAudioFile?
  private var frames: AVAudioFramePosition = 0
  private var sampleRate: Double = 0
  private var settled = false
  private var onEnd: (() -> Void)?

  init(utterance: AVSpeechUtterance, url: URL, timeout: TimeInterval, promise: Promise) {
    self.utterance = utterance
    self.url = url
    self.timeout = timeout
    self.promise = promise
    super.init()
    synthesizer.delegate = self
  }

  func start(onEnd: @escaping () -> Void) {
    lock.lock()
    self.onEnd = onEnd
    lock.unlock()
    synthesizer.write(utterance) { [weak self] buffer in self?.receive(buffer) }
    DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
      guard let self else { return }
      if self.settle() { self.synthesizer.stopSpeaking(at: .immediate) }
    }
  }

  /// Rejects a job that never started (listening stopped).
  func cancel() {
    lock.lock()
    let first = !settled
    settled = true
    file = nil
    lock.unlock()
    if first { promise.reject("E_CANCELLED", "Listening stopped.") }
  }

  private func receive(_ buffer: AVAudioBuffer) {
    guard let pcm = buffer as? AVAudioPCMBuffer else { return }
    if pcm.frameLength == 0 { settle(); return }
    lock.lock()
    guard !settled else { lock.unlock(); return }
    var failure: Error?
    do {
      if file == nil {
        file = try AVAudioFile(forWriting: url, settings: pcm.format.settings, commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
        sampleRate = pcm.format.sampleRate
      }
      try file?.write(from: pcm)
      frames += AVAudioFramePosition(pcm.frameLength)
    } catch {
      failure = error
      settled = true
      file = nil
    }
    let end = failure != nil ? takeEnd() : nil
    lock.unlock()
    if let failure {
      promise.reject("E_WRITE", "Couldn't prepare the audio: \(failure.localizedDescription)")
      end?()
    }
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    // Let any last buffers land in the file first.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.settle() }
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.settle() }
  }

  /// Resolves with the audio written so far (or rejects if there is none). True if this call settled it.
  @discardableResult
  private func settle() -> Bool {
    lock.lock()
    guard !settled else { lock.unlock(); return false }
    settled = true
    let wrote = file != nil && frames > 0
    file = nil   // closes the file
    let ms = sampleRate > 0 ? Int(Double(frames) / sampleRate * 1000) : 0
    let end = takeEnd()
    lock.unlock()
    if wrote { promise.resolve(["uri": url.absoluteString, "durationMs": ms]) }
    else { promise.reject("E_EMPTY", "The voice produced no audio for this text.") }
    end?()
    return true
  }

  /// Call with `lock` held.
  private func takeEnd() -> (() -> Void)? {
    let end = onEnd
    onEnd = nil
    return end
  }
}
