package app.libretv.tv

import android.app.Application
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.tv.material3.*
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        coil.Coil.setImageLoader(coil.ImageLoader.Builder(this)
            .memoryCache { coil.memory.MemoryCache.Builder(this).maxSizeBytes(24 * 1024 * 1024).build() }
            .diskCache { coil.disk.DiskCache.Builder().directory(java.io.File(cacheDir,"posters")).maxSizeBytes(48L * 1024 * 1024).build() }.build())
        if (BuildConfig.DEBUG) intent.getStringExtra("server")?.let { Credentials(this).server = it }
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFFE50914), onPrimary = Color.White,
                background = Color(0xFF101014), surface = Color(0xFF202026))) {
                CompositionLocalProvider(LocalContentColor provides Color.White) { TvApplication() }
            }
        }
    }
}

class Feed(val type: String, val tag: String) {
    val items = mutableStateListOf<Title>()
    var offset by mutableIntStateOf(0)
    var loading by mutableStateOf(false)
    var ended by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
}

class TvModel(app: Application) : AndroidViewModel(app) {
    val repo = TvRepository(app)
    var loading by mutableStateOf(true)
    var paired by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var message by mutableStateOf<String?>(null)
    var pair by mutableStateOf<JSONObject?>(null)
    var activeTab by mutableStateOf("发现")
    var detail by mutableStateOf<Detail?>(null)
    var watch by mutableStateOf<Watch?>(null)
    var search by mutableStateOf("")
    var results by mutableStateOf<List<Title>>(emptyList())
    var history by mutableStateOf<List<JSONObject>>(emptyList())
    var favorites by mutableStateOf<List<Title>>(emptyList())
    var focusKey = ""
    val tabFocus = mutableMapOf<String,String>()
    var hovered by mutableStateOf<Title?>(null)
    var sourceChoices by mutableStateOf<List<Title>?>(null)
    var fourK by mutableStateOf<List<Title>>(emptyList())
    var fourKLoading by mutableStateOf(false)
    var fourKError by mutableStateOf<String?>(null)
    var liveChannels by mutableStateOf<List<LiveChannel>>(emptyList())
    var liveLoading by mutableStateOf(false)
    var liveError by mutableStateOf<String?>(null)
    var liveFailedSources by mutableIntStateOf(0)
    var liveGroup by mutableStateOf("全部")
    var sleepMinutes by mutableIntStateOf(0)
    var remoteAction: ((JSONObject) -> Unit)? = null
    private var remoteCursor = 0L
    private var remoteIdentity = ""
    val movie = Feed("movie", "热门")
    val tv = Feed("tv", "热门")
    val classic = Feed("movie", "豆瓣高分")
    private var pairJob: kotlinx.coroutines.Job? = null
    init {
        viewModelScope.launch {
            if (repo.credentials.token() != null) runCatching { repo.connect(); paired = true; refreshCollections(); load(movie); load(tv); load(classic) }
                .onFailure { error = it.message; if (it is ApiException && it.status == 401) repo.signOut() }
            loading = false
        }
    }
    fun pairing(server: String) {
        pairJob?.cancel()
        pairJob = viewModelScope.launch {
            error = null; loading = true
            try {
                require(server.startsWith("https://") || server.startsWith("http://")) { "地址需要以 https:// 或 http:// 开头" }
                if (repo.credentials.server != server.trimEnd('/')) repo.signOut()
                repo.credentials.server = server
                val data = repo.request("/api/tv/pair", obj("deviceName" to "${Build.MANUFACTURER} ${Build.MODEL}"), false)
                pair = data; loading = false
                val expiry = data.optLong("expiresAt", System.currentTimeMillis() + 600000)
                while (System.currentTimeMillis() < expiry) {
                    delay(3000)
                    val status = repo.request("/api/tv/pair?deviceCode=${java.net.URLEncoder.encode(data.getString("deviceCode"), "UTF-8")}", authenticated = false)
                    if (status.optString("status") == "expired") break
                    if (status.optString("status") == "authorized") {
                        repo.credentials.save(status.getString("token")); repo.connect()
                        pair = null; paired = true; refreshCollections(); load(movie); load(tv); load(classic)
                        return@launch
                    }
                }
                pair = null; error = "配对码已过期，请重新生成"
            } catch (e: Exception) { if (e is kotlinx.coroutines.CancellationException) throw e; error = e.message }
            finally { loading = false }
        }
    }
    fun load(feed: Feed) {
        if (feed.loading || feed.ended) return
        feed.loading = true; feed.error = null
        viewModelScope.launch {
            try {
                val incoming = repo.recommend(feed.type, feed.tag, feed.offset)
                val known = feed.items.map { it.id }.toSet()
                val added = incoming.filter { it.id !in known }.distinctBy { it.id }
                feed.offset += incoming.size
                feed.items.addAll(added)
                feed.ended = incoming.size < 20 || added.isEmpty()
                if (hovered == null) hovered = feed.items.firstOrNull()
            } catch (e: Exception) { feed.error = e.message }
            finally { feed.loading = false }
        }
    }
    fun find(title: String = search) {
        if (title.isBlank()) return
        search = title; activeTab = "搜索"; loading = true; error = null
        viewModelScope.launch {
            runCatching { repo.search(title) }.onSuccess { found ->
                found.firstOrNull()?.let { first -> focusKey = "search:${first.source?.key}:${first.id}"; tabFocus["搜索"] = focusKey }
                results = found
            }.onFailure { error = it.message }
            loading = false
        }
    }
    fun open(title: Title, fromHistory: JSONObject? = null) {
        if(title.directUrl != null) {
            val value = Detail(title,listOf(title.directUrl),"${title.width} × ${title.height} · ${title.codec} · ${title.source?.name.orEmpty()}")
            detail = if(title.isLive) null else value
            if(title.isLive || fromHistory != null) play(value,0)
            return
        }
        if (title.source == null) { find(title.title); return }
        loading = true; error = null
        viewModelScope.launch {
            runCatching { repo.detail(title) }.onSuccess { value ->
                detail = value
                if (fromHistory != null) {
                    val index = fromHistory.optInt("episodeIndex").coerceIn(0, (value.episodes.size - 1).coerceAtLeast(0))
                    play(value, index)
                }
            }.onFailure { error = it.message }
            loading = false
        }
    }
    fun play(value: Detail, index: Int, positionMs: Long? = null) {
        if (value.episodes.isEmpty()) { error = "该来源暂时没有可播放剧集，请尝试换源"; return }
        viewModelScope.launch {
            val safeIndex = index.coerceIn(0, value.episodes.lastIndex)
            watch = Watch(value, safeIndex, if(value.title.isLive) 0 else positionMs ?: repo.resumePosition(value, safeIndex))
        }
    }
    fun load4K() {
        if(fourKLoading) return
        fourKLoading=true;fourKError=null
        viewModelScope.launch {
            runCatching { repo.request("/sources/4k.json") }.onSuccess { data ->
                fourK=data.optJSONArray("items")?.objects().orEmpty().mapNotNull { item ->
                    val url=item.optString("url")
                    if(!url.startsWith("https://")&&!url.startsWith("http://")) return@mapNotNull null
                    val id=item.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
                    Title(id,item.optString("title"),item.optString("cover"),source=Source("4k_$id",item.optString("provider","4K专区"),url),
                        directUrl=url,isLive=item.optString("kind")=="live",width=item.optInt("width"),height=item.optInt("height"),codec=item.optString("codec"))
                }.distinctBy { it.id }
            }.onFailure { fourKError=it.message }
            fourKLoading=false
        }
    }
    fun loadLive(force: Boolean = false) {
        if (liveLoading) return
        liveLoading = true; liveError = null
        viewModelScope.launch {
            try {
                val catalogue = repo.liveChannels(force)
                liveFailedSources = catalogue.failedSources
                if (catalogue.channels.isEmpty() && catalogue.failedSources > 0) {
                    liveError = "直播订阅暂时无法读取，请重试"
                } else {
                    liveChannels = catalogue.channels
                    if (liveGroup != "全部" && liveChannels.none { it.group == liveGroup }) liveGroup = "全部"
                }
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                liveError = error.message ?: "直播频道加载失败"
            } finally { liveLoading = false }
        }
    }
    fun next() {
        val w = watch ?: return
        if (w.index < w.detail.episodes.lastIndex) play(w.detail, w.index + 1, 0)
    }
    fun sync() = viewModelScope.launch {
        runCatching { repo.sync(); refreshCollections(); repo.refreshSources() }
            .onFailure {
                if (it is ApiException && it.status == 401) { repo.signOut(); paired = false; watch = null; detail = null; history = emptyList(); favorites = emptyList(); error = "设备授权已失效，请重新配对" }
                else message = "离线记录已保留，联网后自动同步"
            }
    }
    suspend fun pollCommands() {
        val identity = repo.credentials.server + ":" + repo.account?.optJSONObject("device")?.optString("id")
        val prefs = repo.context.getSharedPreferences("remote", android.content.Context.MODE_PRIVATE)
        if(identity != remoteIdentity) { remoteIdentity = identity; remoteCursor = prefs.getLong(identity,0) }
        try {
            val response = repo.request("/api/tv/commands?after=$remoteCursor")
            for(command in response.optJSONArray("commands")?.objects().orEmpty()) {
                val payload = command.optJSONObject("payload") ?: JSONObject()
                if(command.optString("action") == "play") {
                    val source = payload.optJSONObject("source")?.let(Source::from) ?: continue
                    runCatching {
                        val title = Title(payload.getString("vodId"), payload.optString("title","手机投送"), "", source = source,
                            directUrl = payload.optString("directUrl").takeIf { it.startsWith("https://") || it.startsWith("http://") },
                            isLive=payload.optBoolean("isLive",false),width=payload.optInt("width"),height=payload.optInt("height"),codec=payload.optString("codec"))
                        val value = if(title.directUrl != null) Detail(title,listOf(title.directUrl)) else repo.detail(title)
                        detail = if(title.isLive) null else value; play(value,payload.optInt("episodeIndex"), (payload.optDouble("position",0.0)*1000).toLong())
                    }.onFailure { message = "手机投送失败：${it.message}" }
                } else remoteAction?.invoke(command)
            }
            remoteCursor = response.optLong("cursor", remoteCursor)
            prefs.edit().putLong(identity,remoteCursor).apply()
        } catch(error: Exception) {
            if(error is kotlinx.coroutines.CancellationException) throw error
            // Older servers have no command route. Back off without disrupting playback.
            if(error is ApiException && error.status == 404) delay(60000)
        }
    }
    suspend fun refreshCollections() {
        history = repo.history()
        favorites = repo.cloud?.entries("favorite")?.filter { it.first.startsWith("vod:") }?.map { (_, j) ->
            Title.from(j).copy(source = j.optJSONObject("source")?.let(Source::from))
        }.orEmpty()
    }
    fun favorite(title: Title) = viewModelScope.launch {
        val key = "vod:${title.source?.key}_${title.id}"
        val existing = repo.cloud?.value("favorite", key)
        repo.cloud?.enqueue("favorite", key, if (existing != null) null else obj("id" to title.id, "title" to title.title,
            "cover" to title.cover, "source" to title.source?.json(), "directUrl" to title.directUrl,"isLive" to title.isLive,
            "width" to title.width,"height" to title.height,"codec" to title.codec,"updatedAt" to System.currentTimeMillis()))
        refreshCollections(); sync(); message = if (existing == null) "已加入我的片单" else "已移出我的片单"
    }
    fun switchSource(position: Long) {
        val w = watch ?: return
        loading = true
        viewModelScope.launch {
            runCatching { repo.search(w.detail.title.title) }.onSuccess { list ->
                sourceChoices = list.filter { normalizeTitle(it.title) == normalizeTitle(w.detail.title.title) || it.title.startsWith(w.detail.title.title) }
            }.onFailure { error = it.message }
            loading = false
        }
    }
    fun selectSource(title: Title, positionMs: Long) {
        val previous = watch ?: return
        sourceChoices = null; loading = true
        viewModelScope.launch {
            runCatching { repo.detail(title) }.onSuccess { play(it, previous.index, positionMs) }.onFailure { error = it.message }
            loading = false
        }
    }
    fun signOut() {
        pairJob?.cancel(); repo.signOut(); paired = false; detail = null; watch = null; history = emptyList(); favorites = emptyList()
        liveChannels = emptyList(); liveError = null; liveGroup = "全部"; liveFailedSources = 0
        listOf(movie,tv,classic).forEach { it.items.clear(); it.offset = 0; it.ended = false }
    }
}

@Composable
fun TvApplication(model: TvModel = viewModel()) {
    val lifecycle = LocalLifecycleOwner.current
    LaunchedEffect(model.paired, lifecycle) {
        if (model.paired) lifecycle.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) { model.sync().join(); delay(30000) }
        }
    }
    LaunchedEffect(model.paired, lifecycle) {
        if(model.paired) lifecycle.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while(true) { model.pollCommands(); delay(3000) }
        }
    }
    val saved = rememberSaveableStateHolder()
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        when {
            !model.paired -> PairScreen(model)
            model.watch != null -> key(model.watch?.detail?.title?.source?.url, model.watch?.detail?.title?.id) { PlaybackScreen(model) }
            model.detail != null -> DetailScreen(model)
            else -> saved.SaveableStateProvider("browse") { BrowseScreen(model) }
        }
        if (model.loading) Box(Modifier.align(Alignment.TopEnd).padding(24.dp).background(Color.Black.copy(.8f), RoundedCornerShape(6.dp)).padding(12.dp)) { Text("正在加载…") }
        model.error?.let { error ->
            Column(Modifier.align(Alignment.BottomCenter).padding(28.dp).widthIn(max = 650.dp).background(Color(0xFF481D25), RoundedCornerShape(8.dp)).padding(16.dp)) {
                Text(error, color = Color.White)
                Spacer(Modifier.height(8.dp)); Button(onClick = { model.error = null }) { Text("知道了") }
            }
        }
        model.message?.let { message ->
            LaunchedEffect(message) { delay(4500); model.message = null }
            Text(message, Modifier.align(Alignment.BottomCenter).padding(24.dp).background(Color(0xFF26262C), RoundedCornerShape(8.dp)).padding(14.dp))
        }
    }
}

@Composable
private fun PairScreen(model: TvModel) {
    var server by remember { mutableStateOf(model.repo.credentials.server) }
    val firstFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { firstFocus.requestFocus() } }
    Row(Modifier.fillMaxSize().padding(horizontal = 64.dp, vertical = 42.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 48.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Text("LibreTV", style = MaterialTheme.typography.displayMedium, color = Color(0xFFE50914), fontWeight = FontWeight.Bold)
            Text("把精彩留在大屏", style = MaterialTheme.typography.headlineLarge)
            Text("用手机完成配对，观看记录随你继续。电视授权 365 天，可随时从手机撤销。", style = MaterialTheme.typography.bodyLarge, color = Color(0xFFBCBCC7))
            TvInput(server, { server = it }, "服务器地址，例如 https://tv.example.com", ImeAction.Done) { model.pairing(server) }
            Button(onClick = { model.pairing(server) }, enabled = !model.loading, modifier = Modifier.focusRequester(firstFocus)) { Text(if (model.pair == null) "生成配对码" else "重新生成") }
        }
        Column(Modifier.width(300.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            val pairing = model.pair
            if (pairing != null) {
                val url = pairing.optString("verificationUrl")
                val bitmap = remember(url) { qrCode(url) }
                if (bitmap != null) Image(bitmap.asImageBitmap(), "手机扫描配对二维码", Modifier.size(176.dp).background(Color.White).padding(8.dp))
                Text(pairing.optString("userCode").chunked(4).joinToString(" "), style = MaterialTheme.typography.headlineLarge,
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace, fontWeight = FontWeight.SemiBold, letterSpacing = 4.sp, maxLines = 1)
                Text("手机扫码，或打开配对页输入 8 位码", style = MaterialTheme.typography.bodyMedium)
                Text(url, style = MaterialTheme.typography.bodySmall, color = Color(0xFFBCBCC7), maxLines = 3)
                Text("等待手机确认…", color = Color(0xFFE1BDC0))
            } else {
                Text("手机 → 电视", style = MaterialTheme.typography.headlineMedium)
                Text("请先填写你已部署的 LibreTV 地址。手机和电视使用同一个账号。", color = Color(0xFFBCBCC7))
            }
        }
    }
}

private fun qrCode(value: String): Bitmap? = runCatching {
    if (value.isBlank()) return null
    val matrix = MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, 320, 320)
    Bitmap.createBitmap(320, 320, Bitmap.Config.RGB_565).apply {
        for (y in 0 until height) for (x in 0 until width) setPixel(x,y,if(matrix[x,y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
    }
}.getOrNull()

@Composable
fun TvInput(value: String, change: (String) -> Unit, label: String, action: ImeAction = ImeAction.Search, submit: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    BasicTextField(value, change, Modifier.fillMaxWidth().heightIn(min = 48.dp).onFocusChanged { focused = it.isFocused }
        .border(if (focused) 2.dp else 1.dp, if (focused) Color.White else Color(0xFF565661), RoundedCornerShape(6.dp)).padding(14.dp),
        textStyle = TextStyle(color = Color.White, fontSize = 18.sp), singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = action), keyboardActions = KeyboardActions(onAny = { submit() }),
        decorationBox = { inner -> Box { if(value.isBlank()) Text(label, color = Color(0xFFA6A6B2), style = MaterialTheme.typography.bodyMedium); inner() } })
}

@Composable
private fun BrowseScreen(model: TvModel) {
    BackHandler(model.activeTab != "发现") { model.activeTab = "发现" }
    val tabState = rememberSaveableStateHolder()
    val initialFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { if(model.tabFocus[model.activeTab] == null) runCatching { initialFocus.requestFocus() } }
    Row(Modifier.fillMaxSize()) {
        Column(Modifier.width(120.dp).fillMaxHeight().background(Color(0xFF16161B)).verticalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 26.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("LibreTV", color = Color(0xFFE50914), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(bottom = 24.dp))
            listOf("发现","4K专区","直播","搜索","继续看","我的片单","设置").forEach { tab ->
                Button(onClick = { model.activeTab = tab; model.sync(); if(tab=="4K专区") model.load4K(); if(tab=="直播") model.loadLive() }, modifier = Modifier.fillMaxWidth().then(if(tab=="发现") Modifier.focusRequester(initialFocus) else Modifier),
                    colors = ButtonDefaults.colors(containerColor = if (tab == model.activeTab) Color(0xFF393940) else Color.Transparent)) { Text(tab) }
            }
        }
        Box(Modifier.weight(1f).fillMaxHeight()) { tabState.SaveableStateProvider(model.activeTab) { when(model.activeTab) {
            "发现" -> Discovery(model, Modifier.fillMaxSize())
            "搜索" -> Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Text("搜索影片", style = MaterialTheme.typography.headlineLarge)
                TvInput(model.search, { model.search = it }, "输入片名，按确认键搜索") { model.find() }
                Button(onClick = { model.find() }) { Text("搜索") }
                Text("${model.results.size} 条结果 · ${model.repo.sources.size} 个点播源", color = Color(0xFFBCBCC7))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(model.results.chunked(5)) { row -> Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        row.forEach { title -> Poster(title, model, "search:${title.source?.key}:${title.id}") { model.open(title) } }
                    } }
                    if (!model.loading && model.results.isEmpty()) item { Text("输入影片名开始搜索。无结果时可尝试其他关键词，或在手机更新点播源。", color = Color(0xFFBCBCC7)) }
                }
            }
            "继续看" -> CollectionScreen("继续观看", model.history.map(model.repo::historyTitle), model) { title -> model.open(title, model.history.find { it.optString("vodId") == title.id && it.optString("sourceKey") == title.source?.key }) }
            "我的片单" -> CollectionScreen("我的片单", model.favorites, model) { model.open(it) }
            "4K专区" -> Column(Modifier.fillMaxSize()) {
                if(model.fourKError != null || (!model.fourKLoading && model.fourK.isEmpty())) Column(Modifier.padding(32.dp),verticalArrangement=Arrangement.spacedBy(18.dp)) {
                    Text("4K专区",style=MaterialTheme.typography.headlineLarge)
                    Text(model.fourKError ?: "暂时没有已核实的4K资源，请稍后重试",color=Color(0xFFBCBCC7))
                    Button(onClick={ model.load4K() }) { Text("重新加载") }
                } else if(model.fourKLoading && model.fourK.isEmpty()) Text("正在获取4K资源…",Modifier.padding(32.dp))
                else CollectionScreen("4K专区 · 已核实分辨率",model.fourK,model) { model.open(it) }
            }
            "设置" -> SettingsScreen(model)
            "直播" -> LiveScreen(model)
        } } }
    }
}

@Composable
private fun LiveScreen(model: TvModel) {
    val groups = listOf("全部") + model.liveChannels.map { it.group }.distinct()
    val channels = model.liveChannels.filter { model.liveGroup == "全部" || it.group == model.liveGroup }
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text("直播", style = MaterialTheme.typography.headlineLarge)
                Text("${model.liveChannels.size} 个频道 · 按确认播放，返回选择频道", color = Color(0xFFBCBCC7))
            }
            Button(onClick = { model.loadLive(true) }, enabled = !model.liveLoading) { Text(if(model.liveLoading) "刷新中…" else "刷新频道") }
        }
        model.liveError?.let { Text(it, color = Color(0xFFFFB9B9)) }
        if (model.liveFailedSources > 0 && model.liveError == null) Text("${model.liveFailedSources} 个订阅暂时不可用，可刷新重试", color = Color(0xFFBCBCC7))
        when {
            model.liveLoading && model.liveChannels.isEmpty() -> Text("正在获取直播频道…", color = Color(0xFFBCBCC7))
            model.liveChannels.isEmpty() -> Text(if(model.liveError != null) "选择“刷新频道”重新加载" else "暂时没有直播频道，请稍后刷新", color = Color(0xFFBCBCC7))
            else -> {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(vertical = 8.dp)) {
                    items(groups, key = { it }) { group ->
                        Button(onClick = { model.liveGroup = group }, colors = ButtonDefaults.colors(containerColor = if(model.liveGroup == group) Color(0xFF393940) else Color(0xFF202026))) { Text(group) }
                    }
                }
                key(model.liveGroup) {
                    LazyColumn(state = rememberLazyListState(), verticalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(vertical = 8.dp), modifier = Modifier.weight(1f)) {
                        items(channels.chunked(3), key = { it.first().title.id }) { row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                row.forEach { channel -> LiveChannelButton(channel, model, Modifier.weight(1f)) }
                                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LiveChannelButton(channel: LiveChannel, model: TvModel, modifier: Modifier) {
    val focus = remember { FocusRequester() }
    val focusKey = "live:${channel.title.id}"
    LaunchedEffect(Unit) { if (model.tabFocus["直播"] == focusKey) runCatching { focus.requestFocus() } }
    Button(onClick = { model.open(channel.title) }, modifier = modifier.heightIn(min = 84.dp).focusRequester(focus).onFocusChanged {
        if(it.isFocused) { model.focusKey = focusKey; model.tabFocus["直播"] = focusKey }
    }) {
        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(channel.title.title, style = MaterialTheme.typography.titleMedium, maxLines = 2)
            Text(channel.group, style = MaterialTheme.typography.bodySmall, color = Color(0xFFBCBCC7), maxLines = 1)
        }
    }
}

@Composable
private fun Discovery(model: TvModel, modifier: Modifier) {
    LazyColumn(modifier.fillMaxHeight(), state = rememberLazyListState(), contentPadding = PaddingValues(bottom = 32.dp)) {
        item { Hero(model.hovered, model) }
        if (model.history.isNotEmpty()) item {
            Column(Modifier.padding(top = 16.dp)) {
                Text("继续观看", Modifier.padding(horizontal = 32.dp), style = MaterialTheme.typography.titleLarge)
                LazyRow(contentPadding = PaddingValues(32.dp, 18.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    items(model.history.take(20), key = { it.optString("id") }) { record ->
                        val title = model.repo.historyTitle(record)
                        Poster(title, model, "resume:${title.id}") { model.open(title, record) }
                    }
                }
            }
        }
        item { FeedRow("热门电影", model.movie, model) }
        item { FeedRow("热播剧集", model.tv, model) }
        item { FeedRow("高分佳作", model.classic, model) }
    }
}

@Composable
private fun Hero(title: Title?, model: TvModel) {
    Box(Modifier.fillMaxWidth().height(240.dp)) {
        if (title != null) AsyncImage(model = artwork(model.repo,title.cover), contentDescription = null, contentScale = ContentScale.Crop,
            modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight().fillMaxWidth(.65f))
        Box(Modifier.matchParentSize().background(Brush.horizontalGradient(listOf(Color(0xFF101014), Color(0xF0101014), Color.Transparent))))
        Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xFF101014)))))
        Column(Modifier.align(Alignment.BottomStart).padding(32.dp).widthIn(max = 500.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(title?.title ?: "今晚，继续精彩", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, maxLines = 2)
            Text(if (title?.rating?.isNotBlank() == true) "豆瓣 ${title.rating}  ·  按确认查找播放源" else "属于你的大屏影院", color = Color(0xFFCFCFD7), style = MaterialTheme.typography.bodyLarge)
            Button(onClick = { title?.let { model.find(it.title) } }, enabled = title != null) { Text("查找并播放") }
        }
    }
}

@Composable
private fun FeedRow(label: String, feed: Feed, model: TvModel) {
    val state = rememberLazyListState()
    LaunchedEffect(state, feed.items.size) {
        snapshotFlow { state.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }.collect { index ->
            if (feed.items.isNotEmpty() && index >= feed.items.size - 5 && feed.error == null) model.load(feed)
        }
    }
    Column(Modifier.padding(top = 16.dp)) {
        Text(label, Modifier.padding(horizontal = 32.dp), style = MaterialTheme.typography.titleLarge)
        LazyRow(state = state, contentPadding = PaddingValues(32.dp, 18.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.focusGroup()) {
            items(feed.items, key = { it.id }) { title -> Poster(title, model, "${feed.type}:${feed.tag}:${title.id}") { model.find(title.title) } }
            item {
                Box(Modifier.height(208.dp).width(170.dp), contentAlignment = Alignment.Center) {
                    when {
                        feed.loading -> Text("正在加载下一页…", color = Color(0xFFBCBCC7))
                        feed.error != null -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { Text("加载失败", color = Color(0xFFBCBCC7)); Button(onClick = { model.load(feed) }) { Text("重试") } }
                        !feed.ended -> Button(onClick = { model.load(feed) }) { Text("加载更多") }
                        else -> Text("已看到最后", color = Color(0xFFBCBCC7))
                    }
                }
            }
        }
    }
}

@Composable
private fun Poster(title: Title, model: TvModel, key: String, click: () -> Unit) {
    val requester = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (model.tabFocus[model.activeTab] == key || model.focusKey == key) runCatching { requester.requestFocus() } }
    Column(Modifier.width(130.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Card(onClick = click, modifier = Modifier.width(130.dp).height(180.dp).focusRequester(requester).onFocusChanged {
            if (it.isFocused) { model.focusKey = key; model.tabFocus[model.activeTab] = key; model.hovered = title }
        }) {
            AsyncImage(model = artwork(model.repo,title.cover), contentDescription = title.title,
                modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
        Text(title.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
        if (title.source != null) Text(if(title.directUrl != null) "${title.width} × ${title.height}${if(title.isLive) " · 直播" else ""}" else title.source.name,
            style = MaterialTheme.typography.bodySmall, color = Color(0xFFAFAFBC), maxLines = 1)
    }
}

@Composable
private fun CollectionScreen(label: String, titles: List<Title>, model: TvModel, click: (Title) -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
        Text(label, style = MaterialTheme.typography.headlineLarge)
        if (titles.isEmpty()) Text("还没有内容。登录同一账号后，手机和电视的记录会在这里汇合。", color = Color(0xFFBCBCC7))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(20.dp)) {
            items(titles.chunked(5)) { row -> Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) { row.forEach { title -> Poster(title, model, "$label:${title.source?.key}:${title.id}") { click(title) } } } }
        }
    }
}

@Composable
private fun DetailScreen(model: TvModel) {
    val detail = model.detail ?: return
    val firstFocus = remember { FocusRequester() }
    LaunchedEffect(detail.title.id) { runCatching { firstFocus.requestFocus() } }
    BackHandler { model.detail = null }
    Row(Modifier.fillMaxSize().padding(42.dp), horizontalArrangement = Arrangement.spacedBy(34.dp)) {
        AsyncImage(model = artwork(model.repo,detail.title.cover), contentDescription = detail.title.title, contentScale = ContentScale.Crop, modifier = Modifier.width(210.dp).height(310.dp))
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            item { Text(detail.title.title, style = MaterialTheme.typography.displaySmall) }
            item { Text(detail.description.ifBlank { "选择剧集开始播放" }, color = Color(0xFFBCBCC7), maxLines = 4) }
            item { Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Button(onClick = { model.play(detail, 0, 0L) }, enabled = detail.episodes.isNotEmpty(), modifier = Modifier.focusRequester(firstFocus)) { Text("从第一集播放") }
                Button(onClick = { model.favorite(detail.title) }) { Text("加入 / 移出片单") }
                Button(onClick = { model.detail = null }) { Text("返回") }
            } }
            item { Text("${detail.title.source?.name}  ·  ${detail.episodes.size} 集", color = Color(0xFFBCBCC7)) }
            items(detail.episodes.indices.toList().chunked(6)) { row -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { index -> Button(onClick = { model.play(detail,index) }, modifier = Modifier.width(90.dp)) { Text("第 ${index+1} 集") } }
            } }
        }
    }
}

private fun artwork(repo: TvRepository, url: String): ImageRequest = ImageRequest.Builder(repo.context)
    .data(if(url.isBlank()) "" else "${repo.credentials.server}/api/proxy?url=${java.net.URLEncoder.encode(url,"UTF-8")}")
    .apply { repo.credentials.token()?.let { addHeader("Authorization", "Bearer $it") } }
    .size(480, 720).crossfade(false).build()

@Composable
private fun SettingsScreen(model: TvModel) {
    var count by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { count = model.repo.cloud?.pendingCount() ?: 0 }
    Column(Modifier.fillMaxSize().padding(38.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Text("设置", style = MaterialTheme.typography.headlineLarge)
        Text("${model.repo.account?.optJSONObject("user")?.optString("name").orEmpty()}  ·  ${Build.MANUFACTURER} ${Build.MODEL}")
        Text(model.repo.credentials.server, color = Color(0xFFBCBCC7))
        Text("${model.repo.sources.size} 个点播源 · $count 条记录等待同步", color = Color(0xFFBCBCC7))
        Text("缓存上限 256 MB，内存缓冲 15–45 秒。HDR、字幕与音轨由片源和电视硬件决定。", color = Color(0xFFBCBCC7))
        Button(onClick = { model.sync(); model.message = "开始同步" }) { Text("立即同步") }
        Button(onClick = { model.signOut() }) { Text("退出并重新配对") }
        Text("LibreTV TV ${BuildConfig.VERSION_NAME} · Android ${Build.VERSION.RELEASE}", style = MaterialTheme.typography.bodySmall)
    }
}
