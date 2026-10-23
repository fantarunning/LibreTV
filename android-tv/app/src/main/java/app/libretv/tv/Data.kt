package app.libretv.tv

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONArray.strings(): List<String> = (0 until length()).map { optString(it) }
fun obj(vararg pairs: Pair<String, Any?>): JSONObject = JSONObject().apply {
    pairs.forEach { (k, v) -> put(k, v ?: JSONObject.NULL) }
}
fun normalizeTitle(value: String): String = value.lowercase(java.util.Locale.ROOT).replace(Regex("[\\s\\p{P}\\p{S}]+"), "")

data class Source(val key: String, val name: String, val url: String, val detail: String? = null, val adult: Boolean = false) {
    fun json() = obj("key" to key, "name" to name, "url" to url, "detail" to detail, "isAdult" to adult)
    companion object { fun from(j: JSONObject) = Source(j.optString("key"), j.optString("name"), j.optString("url"), j.optString("detail").takeIf { it.isNotBlank() && it != "null" }, j.optBoolean("isAdult")) }
}
data class Title(val id: String, val title: String, val cover: String, val rating: String = "", val source: Source? = null,
    val directUrl: String? = null, val isLive: Boolean = false, val width: Int = 0, val height: Int = 0, val codec: String = "") {
    companion object { fun from(j: JSONObject) = Title(j.optString("id", j.optString("vodId")), j.optString("title", j.optString("name")), j.optString("cover", j.optString("pic")), j.optString("rating"),
        directUrl=j.optString("directUrl").takeIf { it.startsWith("https://") || it.startsWith("http://") }, isLive=j.optBoolean("isLive"), width=j.optInt("width"),height=j.optInt("height"),codec=j.optString("codec")) }
}
data class Detail(val title: Title, val episodes: List<String>, val description: String = "")
data class Watch(val detail: Detail, val index: Int, val positionMs: Long = 0L)
class ApiException(val status: Int, message: String) : Exception(message)

fun historySource(record: JSONObject, sources: List<Source>): Source {
    val oldKey = record.optString("sourceKey")
    val url = record.optString("sourceUrl")
    val known = sources.find { it.key == oldKey && (url.isBlank() || it.url == url) } ?: sources.find { it.url == url }
    return known?.copy(key = oldKey) ?: Source(oldKey, record.optString("sourceName", "历史来源"), url)
}

/** AES-GCM key is non-exportable; Android backup is disabled in the manifest. */
class Credentials(context: Context) {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)
    var server: String
        get() = prefs.getString("server", BuildConfig.DEFAULT_SERVER).orEmpty()
        set(value) { prefs.edit().putString("server", value.trim().trimEnd('/')).commit() }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("libretv.session", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("libretv.session", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun token(): String? = runCatching {
        val raw = Base64.decode(prefs.getString("token", null) ?: return null, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12)))
        String(cipher.doFinal(raw.copyOfRange(12, raw.size)), Charsets.UTF_8)
    }.getOrNull()
    fun save(token: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = Base64.encodeToString(cipher.iv + cipher.doFinal(token.toByteArray()), Base64.NO_WRAP)
        check(prefs.edit().putString("token", encrypted).commit())
    }
    fun session(): JSONObject? = runCatching { JSONObject(prefs.getString("account", null) ?: return null) }.getOrNull()
    fun saveSession(value: JSONObject) { prefs.edit().putString("account", value.toString()).commit() }
    fun clear() { prefs.edit().remove("token").remove("account").commit() }
}

/** One file per server + account, committed before an offline write is considered queued. */
class CloudStore(context: Context, identity: String) {
    private val mutex = Mutex()
    private val digest = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray()).joinToString("") { "%02x".format(it) }
    private val file = AtomicFile(File(context.filesDir, "cloud-$digest.json"))
    private var root = runCatching { JSONObject(String(file.readFully())) }.getOrElse { obj("cursor" to 0, "records" to JSONObject(), "pending" to JSONArray()) }
    private fun records(): JSONObject = root.optJSONObject("records") ?: JSONObject().also { root.put("records", it) }
    private fun pending(): JSONArray = root.optJSONArray("pending") ?: JSONArray().also { root.put("pending", it) }
    private fun id(kind: String, key: String) = "$kind\n$key"
    private fun persist() {
        val stream = file.startWrite()
        try { stream.write(root.toString().toByteArray()); file.finishWrite(stream) } catch (e: Exception) { file.failWrite(stream); throw e }
    }
    suspend fun cursor(): Long = mutex.withLock { root.optLong("cursor") }
    suspend fun pendingCount(): Int = mutex.withLock { pending().length() }
    suspend fun entries(kind: String): List<Pair<String, JSONObject>> = mutex.withLock {
        val merged = JSONObject(records().toString())
        pending().objects().forEach { merged.put(id(it.getString("kind"), it.getString("key")), it) }
        merged.keys().asSequence().mapNotNull { k -> merged.optJSONObject(k)?.let { r ->
            if (r.optString("kind") == kind) r.optJSONObject("value")?.let { r.optString("key") to it } else null
        } }.toList()
    }
    suspend fun value(kind: String, key: String): JSONObject? = entries(kind).firstOrNull { it.first == key }?.second
    suspend fun enqueue(kind: String, key: String, value: JSONObject?) = withContext(Dispatchers.IO) { mutex.withLock {
        // Coalesce unsent progress per episode, keeping the queue bounded during long offline playback.
        val list = pending().objects().filterNot { it.optString("kind") == kind && it.optString("key") == key }
        val version = records().optJSONObject(id(kind, key))?.optLong("version") ?: 0L
        root.put("pending", JSONArray(list + obj("eventId" to UUID.randomUUID().toString(), "kind" to kind, "key" to key,
            "value" to value, "baseVersion" to version)))
        persist()
    } }
    suspend fun batch(): JSONArray = mutex.withLock { JSONArray(pending().objects().take(100)) }
    suspend fun applyPush(response: JSONObject) = withContext(Dispatchers.IO) { mutex.withLock {
        val accepted = response.optJSONArray("accepted")?.strings()?.toSet().orEmpty()
        val conflicts = response.optJSONArray("conflicts")?.objects().orEmpty().associateBy { id(it.optString("kind"), it.optString("key")) }
        val retained = pending().objects().filterNot { it.optString("eventId") in accepted }.mapNotNull { mutation ->
            val conflict = conflicts[id(mutation.optString("kind"), mutation.optString("key"))]
            if (conflict == null) mutation else {
                val local = mutation.optJSONObject("value")
                val remote = conflict.optJSONObject("value")
                val localTime = local?.optLong("updatedAt", local.optLong("timestamp")) ?: 0L
                val remoteTime = remote?.optLong("updatedAt", remote.optLong("timestamp")) ?: conflict.optLong("updatedAt")
                // Deletions and more recent server edits win; newer offline edits retry with the server version.
                if (local != null && remote != null && localTime > remoteTime) mutation.put("baseVersion", conflict.optLong("version")).put("eventId", UUID.randomUUID().toString()) else null
            }
        }
        root.put("pending", JSONArray(retained))
        (response.optJSONArray("records")?.objects().orEmpty() + conflicts.values).forEach { r -> records().put(id(r.optString("kind"), r.optString("key")), r) }
        persist()
    } }
    suspend fun applyPull(response: JSONObject) = withContext(Dispatchers.IO) { mutex.withLock {
        response.optJSONArray("records")?.objects().orEmpty().forEach { r -> records().put(id(r.optString("kind"), r.optString("key")), r) }
        root.put("cursor", response.optLong("cursor")); persist()
    } }
}

class TvRepository(val context: Context) {
    val credentials = Credentials(context)
    val client = OkHttpClient.Builder().connectTimeout(12, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).callTimeout(40, TimeUnit.SECONDS).build()
    var cloud: CloudStore? = null
    var account: JSONObject? = null
    private val syncLock = Mutex()
    var sources: List<Source> = emptyList()
    suspend fun request(path: String, body: JSONObject? = null, authenticated: Boolean = true, expectedAccount: String? = null): JSONObject = withContext(Dispatchers.IO) {
        val base = credentials.server
        require(base.startsWith("http://") || base.startsWith("https://")) { "请填写完整服务器地址" }
        val req = Request.Builder().url(base + path).header("Accept", "application/json")
        expectedAccount?.let { req.header("x-libretv-account", it) }
        if (authenticated) credentials.token()?.let { req.header("Authorization", "Bearer $it") }
        if (body != null) req.post(body.toString().toRequestBody("application/json".toMediaType()))
        client.newCall(req.build()).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            val data = runCatching { JSONObject(raw) }.getOrElse { obj("error" to "服务器没有返回 JSON (${response.code})") }
            if (!response.isSuccessful) throw ApiException(response.code, data.optString("error", "请求失败 (${response.code})"))
            data
        }
    }
    suspend fun connect(): JSONObject {
        val session = try { request("/api/account/me") } catch (error: Exception) {
            if (error is ApiException && error.status == 401) throw error
            credentials.session()?.takeIf { (it.optJSONObject("device")?.optLong("expiresAt", 0L) ?: 0L) > System.currentTimeMillis() } ?: throw error
        }
        credentials.saveSession(session)
        val identity = session.getJSONObject("user").getString("id")
        cloud = CloudStore(context, credentials.server + ":" + identity)
        account = session
        runCatching { sync() }
        runCatching { refreshSources() }
        if (sources.isEmpty()) {
            val cached = context.getSharedPreferences("source-cache", Context.MODE_PRIVATE).getString(credentials.server + ":" + identity, "[]")
            sources = runCatching { JSONArray(cached).objects().map(Source::from) }.getOrDefault(emptyList())
        }
        return session
    }
    suspend fun refreshSources() {
        val status = request("/api/status")
        val env = status.optJSONArray("defaultSources")?.objects().orEmpty().map(Source::from)
        val prefs = cloud?.value("preferences", "sources")
        val custom = prefs?.optJSONArray("customAPIs")?.objects().orEmpty().map(Source::from)
        val selected = prefs?.optJSONArray("selectedKeys")?.strings()?.toSet()
        sources = (env + custom).distinctBy { it.url }.filter { !it.adult && (selected == null || it.key in selected) }.take(50)
        account?.optJSONObject("user")?.optString("id")?.let { identity ->
            context.getSharedPreferences("source-cache", Context.MODE_PRIVATE).edit().putString(credentials.server + ":" + identity, JSONArray(sources.map(Source::json)).toString()).apply()
        }
    }
    suspend fun sync() {
        syncLock.withLock {
            val state = cloud ?: return
            val identity = account?.optJSONObject("user")?.optString("id") ?: return
            val mutations = state.batch()
            if (mutations.length() > 0) state.applyPush(request("/api/sync", obj("mutations" to mutations), expectedAccount = identity))
            var hasMore: Boolean
            var pages = 0
            do {
                val pull = request("/api/sync?cursor=${state.cursor()}", expectedAccount = identity)
                state.applyPull(pull); hasMore = pull.optBoolean("hasMore")
                pages++
            } while (hasMore && pages < 100)
        }
    }
    suspend fun recommend(type: String, tag: String, start: Int): List<Title> {
        val q = "${credentials.server}/api/douban".toHttpUrl().newBuilder().addQueryParameter("type", type).addQueryParameter("tag", tag)
            .addQueryParameter("pageStart", "$start").addQueryParameter("pageSize", "20").build()
        return request(q.toString().removePrefix(credentials.server)).optJSONArray("items")?.objects().orEmpty().map(Title::from)
    }
    suspend fun search(title: String): List<Title> {
        require(sources.isNotEmpty()) { "请先在手机的设置中添加点播源并同步到账号" }
        val data = request("/api/search", obj("wd" to title.take(100), "sources" to JSONArray(sources.map(Source::json)), "filterAdult" to true))
        return data.optJSONArray("list")?.objects().orEmpty().mapNotNull { j ->
            val source = sources.find { it.key == j.optString("sourceKey") } ?: return@mapNotNull null
            Title.from(j).copy(source = source)
        }.distinctBy { "${it.source?.key}:${it.id}" }
    }
    suspend fun detail(title: Title): Detail {
        val source = requireNotNull(title.source) { "请先选择播放来源" }
        val url = "${credentials.server}/api/detail".toHttpUrl().newBuilder().addQueryParameter("id", title.id).addQueryParameter("source", source.json().toString()).build()
        val data = request(url.toString().removePrefix(credentials.server))
        val info = data.optJSONObject("videoInfo")
        return Detail(title.copy(title = info?.optString("title")?.takeIf { it.isNotBlank() } ?: title.title),
            data.optJSONArray("episodes")?.strings().orEmpty(), info?.optString("desc").orEmpty().replace(Regex("<[^>]*>"), ""))
    }
    suspend fun remember(watch: Watch, positionMs: Long, durationMs: Long) {
        if(watch.detail.title.isLive) return
        val source = watch.detail.title.source ?: return
        val title = watch.detail.title
        val now = System.currentTimeMillis()
        val historyKey = "${source.key}_${title.id}"
        cloud?.enqueue("history", historyKey, obj("id" to historyKey, "sourceKey" to source.key, "sourceUrl" to source.url,
            "sourceName" to source.name, "vodId" to title.id, "title" to title.title, "pic" to title.cover,
            "episodeIndex" to watch.index, "totalEpisodes" to watch.detail.episodes.size, "playbackPosition" to positionMs / 1000.0,
            "duration" to durationMs.coerceAtLeast(0) / 1000.0, "timestamp" to now,
            "directUrl" to title.directUrl,"isLive" to title.isLive,"width" to title.width,"height" to title.height,"codec" to title.codec))
        val progressKey = "${historyKey}_${watch.index}"
        cloud?.enqueue("progress", progressKey, obj("key" to progressKey, "position" to positionMs / 1000.0,
            "duration" to durationMs.coerceAtLeast(0) / 1000.0, "updatedAt" to now))
    }
    suspend fun resumePosition(detail: Detail, index: Int): Long {
        val source = detail.title.source ?: return 0
        val entry = cloud?.value("progress", "${source.key}_${detail.title.id}_$index") ?: return 0
        val position=entry.optDouble("position",0.0)
        val duration=entry.optDouble("duration",0.0)
        return if(duration>0 && position>=duration-2) 0 else (position*1000).toLong().coerceAtLeast(0)
    }
    suspend fun history(): List<JSONObject> = cloud?.entries("history")?.map { it.second }?.sortedByDescending { it.optLong("timestamp") }.orEmpty()
    fun historyTitle(j: JSONObject): Title {
        val source = historySource(j, sources)
        return Title.from(j).copy(id=j.optString("vodId"),source=source)
    }
    fun signOut() { credentials.clear(); cloud = null; account = null; sources = emptyList() }
}
