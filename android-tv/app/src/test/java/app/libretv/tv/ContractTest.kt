package app.libretv.tv

import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray

class ContractTest {
    @Test fun skipTitleKeyMatchesBrowserUnicodeRules() {
        assertEquals("摔跤吧爸爸", normalizeTitle("摔跤吧！ 爸爸"))
        assertEquals("abc2", normalizeTitle("A★B—C 2"))
        assertEquals("庆余年第二季", normalizeTitle("庆余年（第二季）"))
    }
    @Test fun sourceWireRoundTripRetainsDetailAddressAndAdultFlag() {
        val source=Source("phone-1","Source","https://example.com/api.php/provide/vod","https://example.com",true)
        assertEquals(source, Source.from(source.json()))
    }
    @Test fun browserHistoryUsesVodIdAndPicWithoutRecommendationId() {
        val raw=obj("vodId" to "42","title" to "影片","pic" to "https://example.com/a.jpg")
        val title=Title.from(raw)
        assertEquals("42",title.id); assertEquals("影片",title.title); assertEquals("https://example.com/a.jpg",title.cover)
    }
    @Test fun reorderedEnvironmentSourcesKeepHistoricalProgressKeyAndUrl() {
        val history=obj("sourceKey" to "env_0","sourceUrl" to "https://old.example/api")
        val pool=listOf(Source("env_0","Other","https://other.example/api"),Source("env_abc123","Original","https://old.example/api"))
        val source=historySource(history,pool)
        assertEquals("env_0",source.key)
        assertEquals("https://old.example/api",source.url)
        assertEquals("Original",source.name)
    }
    @Test fun livePlaylistSkipsInvalidUrlsAndKeepsLivePlaybackMetadata() {
        val data = obj("channels" to JSONArray(listOf(
            obj("id" to "index-1", "name" to "高清频道", "url" to "https://example.com/live.m3u8", "group" to "卫视", "logo" to "https://example.com/logo.png"),
            obj("name" to "重复频道", "url" to "https://example.com/live.m3u8"),
            obj("name" to "无效频道", "url" to "file:///local/video.mp4"),
            obj("name" to "", "url" to "https://example.com/empty.m3u8")
        )))
        val channels = parseLiveChannels(data, "默认直播")
        assertEquals(1, channels.size)
        val channel = channels.single()
        assertEquals("卫视", channel.group)
        assertEquals("高清频道", channel.title.title)
        assertEquals("https://example.com/live.m3u8", channel.title.directUrl)
        assertEquals("默认直播", channel.title.source?.name)
        assertTrue(channel.title.isLive)
        assertEquals(0, channel.title.width)
    }
    @Test fun liveChannelIdentitySurvivesPlaylistReorderingAndUsesFallbackGroup() {
        val first = obj("id" to "1", "name" to "频道", "url" to "http://example.com/live.m3u8")
        val changed = obj("id" to "42", "name" to "频道新名称", "url" to "http://example.com/live.m3u8", "group" to " ")
        val before = parseLiveChannels(obj("channels" to JSONArray(listOf(first))), "旧名称").single()
        val after = parseLiveChannels(obj("channels" to JSONArray(listOf(changed))), "新名称").single()
        assertEquals(before.title.id, after.title.id)
        assertEquals(before.title.source?.key, after.title.source?.key)
        assertEquals("其他频道", after.group)
    }
}
