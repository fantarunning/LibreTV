package app.libretv.tv

import android.content.Context
import android.net.Uri
import android.view.KeyEvent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.graphics.Color
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheWriter
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.tv.material3.Button
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONArray
import java.io.File
import java.util.concurrent.TimeUnit

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
object VideoCache {
    @Volatile private var instance: SimpleCache? = null
    fun get(context: Context): SimpleCache = instance ?: synchronized(this) {
        instance ?: SimpleCache(File(context.cacheDir, "video"), LeastRecentlyUsedCacheEvictor(256L * 1024 * 1024), StandaloneDatabaseProvider(context)).also { instance = it }
    }
    fun networkFactory(repo: TvRepository, source: Source): DefaultDataSource.Factory {
        val server = repo.credentials.server.toHttpUrl()
        // Bind this player to the session that created it; a later re-pair must not send its new token to an old server.
        val sessionToken = repo.credentials.token()
        val http = repo.client.newBuilder().readTimeout(15, TimeUnit.SECONDS).addInterceptor { chain ->
            val req = chain.request()
            val sameOrigin = req.url.host == server.host && req.url.port == server.port && req.url.scheme == server.scheme
            val builder = req.newBuilder().removeHeader("Authorization")
                .header("User-Agent", "LibreTV-TV/${BuildConfig.VERSION_NAME}")
            if (sameOrigin) sessionToken?.let { builder.header("Authorization", "Bearer $it") }
            else builder.header("Referer", source.url.toHttpUrl().let { "${it.scheme}://${it.host}/" })
            chain.proceed(builder.build())
        }.build()
        return DefaultDataSource.Factory(repo.context, OkHttpDataSource.Factory(http))
    }
    fun factory(repo: TvRepository, source: Source): CacheDataSource.Factory {
        val server = repo.credentials.server.toHttpUrl()
        return CacheDataSource.Factory().setCache(get(repo.context))
            .setUpstreamDataSourceFactory(networkFactory(repo,source))
            .setCacheKeyFactory { spec ->
                val address = runCatching { spec.uri.toString().toHttpUrl() }.getOrNull()
                // Media segments keep their original URL across direct/proxied manifest entry points.
                if(address?.host == server.host && address.encodedPath == "/api/playback/manifest")
                    "manifest:${address.queryParameter("url")}:ads=${address.queryParameter("filterAds")}" else spec.key ?: spec.uri.toString()
            }
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
    }
    suspend fun prewarm(url: String, repo: TvRepository, source: Source) = withContext(Dispatchers.IO) {
        // Warm at most two small segments; never cache a whole next episode or unbounded live stream.
        val request = Request.Builder().url(url).header("User-Agent", "LibreTV-TV/${BuildConfig.VERSION_NAME}").build()
        repo.client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return@withContext
            val bodySource = response.body?.source() ?: return@withContext
            bodySource.request(256 * 1024L)
            val text = bodySource.buffer.clone().readUtf8(minOf(bodySource.buffer.size, 256 * 1024L))
            if (!text.startsWith("#EXTM3U") || text.contains("#EXT-X-STREAM-INF")) return@withContext
            text.lineSequence().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith('#') }.take(2).forEach { path ->
                val absolute = url.toHttpUrl().resolve(path)?.toString() ?: return@forEach
                val writer = CacheWriter(factory(repo, source).createDataSource(), DataSpec.Builder().setUri(absolute).setLength(1024 * 1024).build(), null, null)
                runCatching { writer.cache() }
            }
        }
    }
}

private fun time(ms: Long): String {
    val seconds = ms.coerceAtLeast(0) / 1000
    return if (seconds >= 3600) "%d:%02d:%02d".format(seconds / 3600, seconds / 60 % 60, seconds % 60) else "%02d:%02d".format(seconds / 60, seconds % 60)
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
fun PlaybackScreen(model: TvModel) {
    val watch = model.watch ?: return
    val source = watch.detail.title.source ?: return
    val context = model.repo.context
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    val player = remember(source.url) {
        val factory: androidx.media3.datasource.DataSource.Factory = if(watch.detail.title.isLive) VideoCache.networkFactory(model.repo,source) else VideoCache.factory(model.repo, source)
        ExoPlayer.Builder(context, DefaultRenderersFactory(context).setEnableDecoderFallback(true)).setMediaSourceFactory(DefaultMediaSourceFactory(context).setDataSourceFactory(factory))
            .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(15000, 45000, 1500, 3000)
                .setTargetBufferBytes(64 * 1024 * 1024).setBackBuffer(15000, true).build()).build()
    }
    var position by remember { mutableLongStateOf(watch.positionMs) }
    var duration by remember { mutableLongStateOf(0) }
    var buffered by remember { mutableIntStateOf(0) }
    var controls by remember { mutableStateOf(true) }
    var menu by remember { mutableStateOf<String?>(null) }
    var playing by remember { mutableStateOf(true) }
    var decoderName by remember { mutableStateOf("") }
    var speed by remember { mutableFloatStateOf(1f) }
    var ratio by remember { mutableIntStateOf(AspectRatioFrameLayout.RESIZE_MODE_FIT) }
    var failure by remember { mutableStateOf<String?>(null) }
    var triedProxy by remember { mutableStateOf(false) }
    var countdown by remember { mutableIntStateOf(-1) }
    var autoNext by remember { mutableStateOf(true) }
    var autoSkip by remember { mutableStateOf(true) }
    var adFilter by remember { mutableStateOf(true) }
    var skipSegments by remember { mutableStateOf<JSONArray>(JSONArray()) }
    var pendingSkip by remember { mutableStateOf<Long?>(null) }
    var sleepAt by remember { mutableLongStateOf(0) }
    var lastInteraction by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val controlsFocus = remember { FocusRequester() }
    val menuFocus = remember { FocusRequester() }
    val rootFocus = remember { FocusRequester() }
    var viewRef by remember { mutableStateOf<PlayerView?>(null) }
    val playbackRef by rememberUpdatedState(watch)
    val skipKey = "t:${normalizeTitle(watch.detail.title.title)}"
    fun currentMedia(forceProxy: Boolean = false): MediaItem {
        val current = playbackRef
        val target = current.detail.episodes[current.index]
        val hls = target.contains(".m3u8", ignoreCase = true)
        val escaped = java.net.URLEncoder.encode(target,"UTF-8")
        val uri = when {
            hls && adFilter && !current.detail.title.isLive -> "${model.repo.credentials.server}/api/playback/manifest?url=$escaped&filterAds=1"
            forceProxy && current.detail.title.isLive -> "${model.repo.credentials.server}/api/live/stream?url=$escaped"
            forceProxy -> "${model.repo.credentials.server}/api/proxy?url=$escaped"
            else -> target
        }
        return MediaItem.Builder().setUri(uri).apply { if(hls) setMimeType(androidx.media3.common.MimeTypes.APPLICATION_M3U8) }.build()
    }
    val save: () -> Unit = {
        val current = playbackRef
        val p = player.currentPosition
        val d = player.duration.coerceAtLeast(0)
        // viewModelScope survives removal of this playback composable.
        model.viewModelScope.launch { model.repo.remember(current, p, d); model.sync() }
    }
    LaunchedEffect(watch.detail.title.id, watch.index, source.url) {
        failure = null; countdown = -1; triedProxy = false
        val preferences = model.repo.cloud?.value("preferences", "playback")
        autoNext = !watch.detail.title.isLive && (preferences?.optBoolean("autoplayNext", true) ?: true)
        autoSkip = !watch.detail.title.isLive && (preferences?.optBoolean("autoSkipSegments", true) ?: true)
        adFilter = preferences?.optBoolean("adFilter", true) ?: true
        player.setMediaItem(currentMedia())
        player.seekTo(watch.positionMs); player.prepare()
        player.playWhenReady = lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        val marks = model.repo.cloud?.value("skip", skipKey)
        skipSegments = if (marks?.optBoolean("enabled", true) != false) marks?.optJSONArray("segments") ?: JSONArray() else JSONArray()
    }
    DisposableEffect(player) {
        val session = MediaSession.Builder(context, player).build()
        val analytics = object : AnalyticsListener {
            override fun onVideoDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderNameValue: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
                decoderName = decoderNameValue
            }
        }
        player.addAnalyticsListener(analytics)
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(value: Boolean) { playing = value }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) { save(); countdown = if (autoNext && playbackRef.index < playbackRef.detail.episodes.lastIndex) 10 else -1; controls = true }
            }
            override fun onPlayerError(error: PlaybackException) {
                if (!triedProxy) {
                    triedProxy = true
                    val at = player.currentPosition
                    player.setMediaItem(currentMedia(forceProxy = true)); player.seekTo(at); player.prepare()
                    player.playWhenReady = lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
                } else { failure = "此来源播放失败 (${error.errorCodeName})，可重试或换源"; controls = true }
            }
        }
        player.addListener(listener)
        onDispose { save(); session.release(); player.removeAnalyticsListener(analytics); player.removeListener(listener); player.release(); viewRef = null }
    }
    DisposableEffect(player, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event -> if(event == Lifecycle.Event.ON_STOP) { countdown = -1; save(); player.pause() } }
        lifecycleOwner.lifecycle.addObserver(observer)
        model.remoteAction = { command ->
            val payload = command.optJSONObject("payload")
            when(command.optString("action")) {
                "pause" -> player.pause()
                "resume" -> player.play()
                "seek" -> player.seekTo(((payload?.optDouble("position",0.0) ?: 0.0)*1000).toLong().coerceIn(0,player.duration.coerceAtLeast(0)))
            }
        }
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer); model.remoteAction = null }
    }
    LaunchedEffect(player, watch) {
        var ticks = 0
        while (true) {
            delay(1000)
            position = player.currentPosition.coerceAtLeast(0); duration = player.duration.coerceAtLeast(0); buffered = player.bufferedPercentage
            ticks++
            if (ticks % 10 == 0 && !watch.detail.title.isLive) model.repo.remember(watch, position, duration)
            if (controls && menu == null && playing && System.currentTimeMillis() - lastInteraction > 7000) { controls = false; runCatching { rootFocus.requestFocus() } }
            if (sleepAt > 0 && System.currentTimeMillis() >= sleepAt) { player.pause(); sleepAt = 0; controls = true; model.message = "睡眠定时已暂停播放" }
            if (autoSkip && playing) for (mark in skipSegments.objects()) {
                val start = mark.optDouble("start") * 1000
                val end = if (mark.optDouble("end") < 0) duration.toDouble() else mark.optDouble("end") * 1000
                if (end > start + 3000 && duration > 0 && position >= start && position < end - 1000 && start < duration) {
                    if (mark.optString("type") == "ending") { if (autoNext && watch.index < watch.detail.episodes.lastIndex) { player.pause(); countdown = 10; controls = true } }
                    else { player.seekTo(end.toLong()); model.message = "已跳过已标记片段" }
                    break
                }
            }
        }
    }
    LaunchedEffect(countdown) { if (countdown > 0) { delay(1000); countdown-- } else if(countdown == 0) { countdown = -1; model.next() } }
    LaunchedEffect(watch) {
        delay(12000)
        if (!watch.detail.title.isLive && watch.index < watch.detail.episodes.lastIndex && player.bufferedPercentage > 60) runCatching {
            VideoCache.prewarm(watch.detail.episodes[watch.index + 1], model.repo, source)
        }
    }
    LaunchedEffect(controls) { if(controls) runCatching { controlsFocus.requestFocus() } }
    LaunchedEffect(menu, model.sourceChoices) {
        if(menu != null || model.sourceChoices != null) runCatching { menuFocus.requestFocus() }
        else if(controls) runCatching { controlsFocus.requestFocus() }
    }
    BackHandler {
        when {
            menu != null -> menu = null
            model.sourceChoices != null -> model.sourceChoices = null
            controls -> { controls = false; runCatching { rootFocus.requestFocus() } }
            else -> { save(); model.watch = null; model.sync() }
        }
    }
    Box(Modifier.fillMaxSize().background(Color.Black).onPreviewKeyEvent { event ->
        if(event.nativeKeyEvent.action != KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false
        lastInteraction = System.currentTimeMillis()
        when(event.nativeKeyEvent.keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> { if(player.isPlaying) player.pause() else player.play(); true }
            KeyEvent.KEYCODE_MEDIA_PAUSE -> { player.pause(); true }
            KeyEvent.KEYCODE_MEDIA_PLAY -> { player.play(); true }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> if(!controls) { controls = true; true } else false
            KeyEvent.KEYCODE_DPAD_LEFT -> if(!controls) { player.seekTo((player.currentPosition - 10000).coerceAtLeast(0)); true } else false
            KeyEvent.KEYCODE_DPAD_RIGHT -> if(!controls) { player.seekTo((player.currentPosition + 10000).coerceAtMost(duration)); true } else false
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> if(!controls) { controls = true; true } else false
            else -> false
        }
    }) {
        AndroidView(factory = {
            PlayerView(it).apply { this.player = player; useController = false; isFocusable = false; setKeepContentOnPlayerReset(true); viewRef = this }
        }, update = { it.player = player; it.resizeMode = ratio }, modifier = Modifier.fillMaxSize())
        // Root retains D-pad input while the control bar is hidden.
        Box(Modifier.size(1.dp).focusRequester(rootFocus).focusProperties { canFocus = !controls }.focusable())
        if (controls) {
            Text("${watch.detail.title.title}  ·  ${if(watch.detail.title.isLive) "直播" else "第 ${watch.index + 1} 集"}", Modifier.align(Alignment.TopStart).padding(28.dp).background(Color.Black.copy(.65f)).padding(12.dp), style = MaterialTheme.typography.titleLarge)
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color.Black.copy(.88f)).padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("${if(watch.detail.title.isLive) "直播中" else "${time(position)} / ${time(duration)}"}  ·  缓冲 $buffered%${if(sleepAt>0) "  ·  定时 ${(sleepAt-System.currentTimeMillis())/60000+1} 分钟" else ""}")
                player.videoFormat?.let { format ->
                    Text("${format.width} × ${format.height}  ·  ${format.codecs ?: format.sampleMimeType.orEmpty()}  ·  $decoderName",
                        style = MaterialTheme.typography.bodySmall, color = Color(0xFFBCBCC7))
                }
                failure?.let { Text(it, color = Color(0xFFFFB6BB)) }
                if(countdown > 0) Row(horizontalArrangement = Arrangement.spacedBy(18.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${countdown} 秒后播放下一集")
                    Button(onClick = { countdown = -1 }) { Text("取消自动连播") }
                    Button(onClick = { countdown = -1; model.next() }) { Text("立即播放") }
                }
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Button(onClick = { if(player.isPlaying) player.pause() else player.play(); lastInteraction = System.currentTimeMillis() }, modifier = Modifier.focusRequester(controlsFocus)) { Text(if(playing) "暂停" else "播放") }
                    if(failure != null) Button(onClick = {
                        failure = null; triedProxy = false
                        player.setMediaItem(currentMedia())
                        player.seekTo(position); player.prepare(); player.play()
                    }) { Text("重试播放") }
                    Button(onClick = { player.seekTo((position - 10000).coerceAtLeast(0)) }) { Text("−10 秒") }
                    Button(onClick = { player.seekTo((position + 10000).coerceAtMost(duration)) }) { Text("+10 秒") }
                    if(!watch.detail.title.isLive) Button(onClick = { menu = "剧集" }) { Text("选集") }
                    if(watch.detail.title.directUrl == null) Button(onClick = { model.switchSource(position) }) { Text("换源") }
                    Button(onClick = { speed = if(speed >= 2f) .75f else speed+.25f; player.setPlaybackSpeed(speed) }) { Text("${speed}×") }
                    Button(onClick = { menu = "音轨字幕" }) { Text("音轨 / 字幕") }
                    Button(onClick = { ratio = when(ratio) { AspectRatioFrameLayout.RESIZE_MODE_FIT -> AspectRatioFrameLayout.RESIZE_MODE_FILL; AspectRatioFrameLayout.RESIZE_MODE_FILL -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM; else -> AspectRatioFrameLayout.RESIZE_MODE_FIT } }) { Text(when(ratio) { AspectRatioFrameLayout.RESIZE_MODE_FILL -> "拉伸"; AspectRatioFrameLayout.RESIZE_MODE_ZOOM -> "填满"; else -> "原始比例" }) }
                    if(!watch.detail.title.isLive) Button(onClick = { menu = "片段标记"; player.pause() }) { Text("跳过标记") }
                    Button(onClick = { menu = "睡眠定时" }) { Text("定时") }
                    Button(onClick = { save(); model.watch = null }) { Text("返回详情") }
                }
            }
        }
        if (menu != null || model.sourceChoices != null) {
            Column(Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(360.dp).background(Color(0xFF202027)).padding(26.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(menu ?: "切换播放来源", style = MaterialTheme.typography.headlineSmall)
                Button(onClick = { menu = null; model.sourceChoices = null }, modifier = Modifier.focusRequester(menuFocus)) { Text("关闭") }
                LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    when {
                        model.sourceChoices != null -> {
                            items(model.sourceChoices.orEmpty()) { choice -> Button(onClick = { model.selectSource(choice,player.currentPosition) }) { Text("${choice.source?.name} · ${choice.title}", maxLines = 2) } }
                            if(model.sourceChoices?.isEmpty() == true) item { Text("没有同名候选来源，可回到搜索尝试其他片名") }
                        }
                        menu == "剧集" -> items(watch.detail.episodes.indices.toList()) { i -> Button(onClick = { save(); model.play(watch.detail,i); menu = null }) { Text("第 ${i+1} 集${if(i==watch.index) " · 当前" else ""}") } }
                        menu == "睡眠定时" -> items(listOf(0,15,30,60,90,120)) { mins -> Button(onClick = { sleepAt = if(mins==0) 0 else System.currentTimeMillis()+mins*60000L; menu = null }) { Text(if(mins==0) "关闭定时" else "$mins 分钟后暂停") } }
                        menu == "音轨字幕" -> {
                            item { Button(onClick = { player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT,true).build() }) { Text("关闭字幕") } }
                            var available = 0
                            player.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO || it.type == C.TRACK_TYPE_TEXT }.forEach { group ->
                                for(i in 0 until group.length) {
                                    if(!group.isTrackSupported(i)) continue
                                    available++
                                    val index=i; val format=group.getTrackFormat(i)
                                    item(key = "$available:${group.type}:$i") { Button(onClick = {
                                        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().setTrackTypeDisabled(group.type,false)
                                            .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup,index)).build()
                                    }) { Text("${if(group.type==C.TRACK_TYPE_TEXT) "字幕" else "音轨"} · ${format.label ?: format.language ?: "默认 ${index+1}"}") } }
                                }
                            }
                            if(available==0) item { Text("该片源未提供可选字幕或音轨") }
                        }
                        menu == "片段标记" -> {
                            item { Text("暂停画面后记录边界。同名影片各集与其他设备共享。", color = Color(0xFFBCBCC7)) }
                            item { Button(onClick = {
                                val segments = JSONArray(skipSegments.objects().filterNot { it.optString("type")=="opening" } + obj("type" to "opening","start" to 0,"end" to player.currentPosition/1000.0))
                                scope.launch { model.repo.cloud?.enqueue("skip", skipKey, obj("segments" to segments,"enabled" to true,"updatedAt" to System.currentTimeMillis())); skipSegments=segments; model.sync() }
                            }, enabled = position >= 3000) { Text("当前位置为片头结束") } }
                            item { Button(onClick = {
                                val segments = JSONArray(skipSegments.objects().filterNot { it.optString("type")=="ending" } + obj("type" to "ending","start" to player.currentPosition/1000.0,"end" to -1))
                                scope.launch { model.repo.cloud?.enqueue("skip", skipKey, obj("segments" to segments,"enabled" to true,"updatedAt" to System.currentTimeMillis())); skipSegments=segments; model.sync() }
                            }) { Text("当前位置为片尾开始") } }
                            item { Button(onClick = { pendingSkip=player.currentPosition }) { Text("标记中段起点") } }
                            item { Button(onClick = {
                                val start = pendingSkip ?: return@Button
                                val segments = JSONArray(skipSegments.objects() + obj("type" to "middle","start" to start/1000.0,"end" to player.currentPosition/1000.0))
                                scope.launch { model.repo.cloud?.enqueue("skip",skipKey,obj("segments" to segments,"enabled" to true,"updatedAt" to System.currentTimeMillis())); skipSegments=segments; pendingSkip=null; model.sync() }
                            }, enabled = pendingSkip != null && position > (pendingSkip ?: 0) + 3000) { Text("标记中段终点") } }
                            item { Button(onClick = {
                                scope.launch { model.repo.cloud?.enqueue("skip",skipKey,null); skipSegments=JSONArray(); model.sync() }
                            }) { Text("清除本剧全部标记") } }
                            item { Button(onClick = { player.seekTo((position-5000).coerceAtLeast(0)) }) { Text("后退 5 秒") } }
                            item { Button(onClick = { player.seekTo(position+5000) }) { Text("前进 5 秒") } }
                        }
                    }
                }
            }
        }
    }
}
