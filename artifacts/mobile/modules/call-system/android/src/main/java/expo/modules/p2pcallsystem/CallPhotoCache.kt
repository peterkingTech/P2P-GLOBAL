package expo.modules.p2pcallsystem

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.LruCache
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Caller profile photos for the native ringing UI, which can run while the
 * app (and so React Native's image cache) isn't. Downloaded once to the app's
 * cache dir when the call push arrives, decoded no larger than the screen,
 * kept in a small memory cache. Never blocks ringing: callers show a fallback
 * until the photo is ready.
 */
object CallPhotoCache {
  private const val TAG = "P2PCallSystem"
  private const val MAX_BYTES = 10 * 1024 * 1024
  private const val MAX_SIDE = 1600

  private val memory = object : LruCache<String, Bitmap>(16 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
  }
  private val io = Executors.newFixedThreadPool(2)
  private val main = Handler(Looper.getMainLooper())

  private fun file(context: Context, url: String): File {
    val digest = MessageDigest.getInstance("SHA-1").digest(url.toByteArray())
    val name = digest.joinToString("") { "%02x".format(it) }
    return File(File(context.cacheDir, "call_photos").apply { mkdirs() }, name)
  }

  /** Already downloaded (memory or disk) — safe on any thread, no network. */
  fun cached(context: Context, url: String): Bitmap? {
    if (url.isEmpty()) return null
    memory.get(url)?.let { return it }
    val f = file(context, url)
    if (!f.exists()) return null
    return decode(f)?.also { memory.put(url, it) }
  }

  /** Cached photo, downloading it first if needed; [onReady] runs on the main thread. */
  fun load(context: Context, url: String, onReady: (Bitmap?) -> Unit) {
    if (url.isEmpty()) { onReady(null); return }
    memory.get(url)?.let { onReady(it); return }
    val app = context.applicationContext
    io.execute {
      val bitmap = try {
        cached(app, url) ?: download(app, url)
      } catch (e: Exception) {
        Log.w(TAG, "caller photo unavailable", e)
        null
      }
      main.post { onReady(bitmap) }
    }
  }

  private fun download(context: Context, url: String): Bitmap? {
    val conn = URL(url).openConnection() as HttpURLConnection
    conn.connectTimeout = 8_000
    conn.readTimeout = 8_000
    try {
      if (conn.responseCode !in 200..299) return null
      val bytes = conn.inputStream.use { input ->
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while (true) {
          val n = input.read(buffer)
          if (n < 0) break
          out.write(buffer, 0, n)
          if (out.size() > MAX_BYTES) return null
        }
        out.toByteArray()
      }
      val f = file(context, url)
      val tmp = File(f.parentFile, f.name + ".part")
      tmp.writeBytes(bytes)
      if (!tmp.renameTo(f)) tmp.delete()
      return decode(f)?.also { memory.put(url, it) }
    } finally {
      conn.disconnect()
    }
  }

  // Decoded at most screen-sized: a phone camera photo at full resolution
  // would be tens of MB in memory for no visible gain.
  private fun decode(f: File): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(f.path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
    return BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample })
  }
}
