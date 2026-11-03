package expo.modules.p2pspeechaudio

import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * JS bridge — see lib/listen/fileSpeech.ts. The phone's OWN text-to-speech
 * voice written to a temporary audio file (TextToSpeech.synthesizeToFile)
 * so the shared Listen player can play it through expo-audio, whose media
 * session and foreground service keep it playing with the screen off and
 * show the lock-screen / notification controls. Files live in
 * cache/p2p-speech and are deleted after playing (`remove`); nothing is kept.
 *
 * Next / previous on the Android lock screen: expo-audio's media session
 * removes those buttons, so `trackCommandsSupported` is false here (see
 * docs/scripture-listening-library.md).
 */
class P2PSpeechAudioModule : Module() {
  private var tts: TextToSpeech? = null
  private var ready = false
  private val waiting = mutableListOf<() -> Unit>()
  private val pending = ConcurrentHashMap<String, Pair<File, Promise>>()

  private fun folder(): File {
    val dir = File(appContext.reactContext!!.cacheDir, "p2p-speech")
    if (!dir.exists()) dir.mkdirs()
    return dir
  }

  private fun withTts(block: (TextToSpeech) -> Unit, fail: (String) -> Unit) {
    val ctx = appContext.reactContext ?: return fail("The app isn't ready.")
    tts?.let { if (ready) return block(it) }
    synchronized(waiting) { waiting.add { tts?.let(block) ?: fail("This phone has no text-to-speech voice.") } }
    if (tts == null) {
      tts = TextToSpeech(ctx) { status ->
        ready = status == TextToSpeech.SUCCESS
        if (!ready) { tts = null }
        val run = synchronized(waiting) { waiting.toList().also { waiting.clear() } }
        run.forEach { it() }
      }.apply {
        setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String) {}
          override fun onDone(utteranceId: String) {
            val (file, promise) = pending.remove(utteranceId) ?: return
            if (!file.exists() || file.length() == 0L) { promise.reject("E_EMPTY", "The voice produced no audio for this text.", null); return }
            promise.resolve(mapOf("uri" to Uri.fromFile(file).toString(), "durationMs" to durationOf(file)))
          }
          @Deprecated("Deprecated in Java")
          override fun onError(utteranceId: String) {
            val (file, promise) = pending.remove(utteranceId) ?: return
            file.delete()
            promise.reject("E_SPEECH", "The voice couldn't read this text.", null)
          }
        })
      }
    }
  }

  private fun durationOf(file: File): Int = try {
    val r = MediaMetadataRetriever()
    r.setDataSource(file.absolutePath)
    val d = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toIntOrNull() ?: 0
    r.release(); d
  } catch (e: Exception) { 0 }

  override fun definition() = ModuleDefinition {
    Name("P2PSpeechAudio")
    Events("onRemoteCommand")

    AsyncFunction("synthesize") { text: String, language: String, voice: String?, rate: Double, promise: Promise ->
      withTts({ engine ->
        val chosen = voice?.let { name -> engine.voices?.firstOrNull { it.name == name } }
        if (chosen != null) engine.voice = chosen
        else if (language.isNotEmpty()) engine.language = Locale.forLanguageTag(language)
        engine.setSpeechRate(rate.toFloat())
        val id = UUID.randomUUID().toString()
        val file = File(folder(), "$id.wav")
        pending[id] = Pair(file, promise)
        val result = engine.synthesizeToFile(text, Bundle(), file, id)
        if (result != TextToSpeech.SUCCESS) { pending.remove(id); promise.reject("E_SPEECH", "The voice couldn't read this text.", null) }
      }, { message -> promise.reject("E_NO_TTS", message, null) })
    }

    Function("remove") { uri: String ->
      val path = Uri.parse(uri).path ?: return@Function
      val f = File(path)
      if (f.absolutePath.startsWith(folder().absolutePath)) f.delete()
    }

    Function("clearAll") { folder().listFiles()?.forEach { it.delete() } }

    // expo-audio's media session doesn't offer next / previous on Android.
    Function("setTrackCommands") { _: Boolean -> }
    Function("trackCommandsSupported") { false }

    OnDestroy {
      tts?.shutdown(); tts = null; ready = false
    }
  }
}
