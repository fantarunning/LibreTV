# LibreTV Android TV

Native Android TV client for the existing LibreTV service. Compose for TV provides remote focus and the Media3 player performs native video decoding. This is an independent Gradle project; the web package dependencies are unchanged.

## Install

- Release artifact: `../public/downloads/libretv-tv.apk` (also copied to `output/libretv-tv-release.apk`).
- Frozen release SHA-256: `7F978B3C8F53CFF2EEEBA7C8CFD24368176DB9D7A8D6D2BBBB25C4EFFBF78ECE` (10,188,484 bytes).
- Package `app.libretv.tv`, version `1.0.0` / versionCode `1`, Android 8.0 / API 26 or newer.
- Default server `https://comic.fenda.cc`; the pairing screen can change the address.
- Install through the television's local APK installer, or `adb install -r libretv-tv.apk` when ADB is enabled.
- A debug APK uses a different certificate. Remove that test package before installing the release APK; removing an app clears its local data.

Open LibreTV, choose Generate pairing code, then scan with the phone or enter the eight-character code on the authenticated phone's `/account/tv` page. The TV groups the code into two blocks of four; the server accepts it with or without spaces. The server grants a 365-day device session. Revocation or expiry requires pairing again. Android Keystore encrypts the token with AES-GCM; app backup is disabled. Production uses HTTPS by default. A manually configured HTTP server does not encrypt traffic.

## Features

- Dark, image-led television discovery page, side navigation, horizontal movie/series/high-rating rows, history and saved titles.
- A dedicated 4K section loads the server's `/sources/4k.json` catalogue, displaying its verified resolution. Live entries start at the live edge, bypass disk cache and do not restore positions, save episode progress or auto-advance. VOD entries keep normal history. Missing/empty catalogues show an explicit reload action; the client never fabricates entries.
- Genuine offset pagination, ID deduplication, short/empty/repeated-page termination, loading locks and retry controls. D-pad focus and list positions are restored when returning to a section or detail screen.
- Aggregated search, source selection, episode details and episode selection through the existing server APIs.
- Native Media3 playback, remote media keys, seek, speed, original/stretch/zoom modes, selectable in-stream subtitles and audio tracks, next-episode countdown, pause before recording skip markers, source switch at the existing episode/position, explicit playback retry and sleep timer.
- `preferences/playback.adFilter` directs HLS manifest requests through `/api/playback/manifest?url=...&filterAds=1`. Child manifests use that route; media segments remain direct source requests. Filtering follows the server's conservative heuristic and does not identify every advertisement.
- Account-scoped history/progress/skip/favorite sync, persistent coalesced offline mutation queue, server-version conflict handling and per-account atomic local storage. Progress units are seconds in the shared wire format and milliseconds inside Media3.
- Video cache: 256 MiB LRU on app cache storage; poster cache: 48 MiB disk / 24 MiB memory. Forward buffer 15–45 seconds with a 64 MiB target. Next-episode prewarm attempts at most two segments, each capped at 1 MiB.
- Foreground device-command polling (`play`, `pause`, `resume`, `seek`), with a persistent per-device cursor. The server must authorize the phone and target television to the same account.

The cache is opportunistic and can be evicted by Android. Full offline episode downloads and picture-in-picture are not implemented. General M3U/IPTV subscription browsing is provided by the web application; native live playback is available through the curated 4K catalogue. HDR, DRM, decoder formats and available tracks depend on the source and device. Media3 uses platform renderer selection with decoder fallback, and the control bar shows actual selected video width/height, codec and decoder component name; a catalogue's label alone is not proof that a 4K variant is currently decoded.

## API contracts

The authoritative shared document is `../IMPLEMENTATION.md` and `../src/lib/cloud-types.ts`.

| Endpoint | Use |
| --- | --- |
| `POST /api/tv/pair`, `GET /api/tv/pair?deviceCode=...` | Generate/poll pairing; receive device token only through this channel |
| `GET /api/account/me` | Session/account identity and expiry |
| `GET /api/status` | Environment source pool |
| `GET /api/douban?type=...&tag=...&pageStart=N&pageSize=20` | Paged discovery |
| `POST /api/search` | `{wd,sources,filterAdult:true}` |
| `GET /api/detail?id=...&source=<JSON>` | Episodes and metadata |
| `GET /api/sync?cursor=N`, `POST /api/sync` | Incremental documents and mutations |
| `GET /api/tv/commands?after=N` | `{commands:[{id,action,payload}],cursor}` |

Sync GET/POST captures the paired account ID in `x-libretv-account`, protecting against logout/account-switch request races. History and progress keys match the browser; skip keys use the same Unicode punctuation/symbol normalization. Movie favorites use a separate `vod:` prefix. Playback preferences and phone-selected custom sources share the existing `preferences` documents. Server/environment sources are not copied into the custom-source payload.

The native media stack removes Authorization from external requests and adds the device Bearer only when scheme, host and port match the configured LibreTV server. Source/CDN requests receive UA/Referer only. Cache keys for source media segments use their original URLs across direct and manifest-proxy paths.

## Build

On this Windows workstation:

```powershell
.\Build.ps1 -Variant Release
.\Build.ps1 -Variant Debug -ServerUrl http://10.0.2.2:19888
```

`Build.ps1` uses the installed Android Studio JDK 21, SDK 36, Gradle 8.14 wrapper and project-scoped JVM temporary directory. Paths can be overridden with `-JavaDirectory` / `-SdkDirectory`. The temporary directory flag avoids the Windows packaged-app Unix-domain socket error. It builds, runs the contract unit tests, verifies the APK signature and prints its SHA-256.

Release signing material is outside the repository, in `%LOCALAPPDATA%\LibreTV\signing`; its password is protected with the Windows user's DPAPI. Preserve this key to publish installable updates. Neither key nor password is embedded in source control. The APK contains only the public certificate. `Build.ps1` rejects an HTTP default server for a release build.

## Verification evidence, 2026-10-23

- Release compilation/packaging and unit tests passed. API contract tests cover Unicode title normalization, source round-trip fields, browser history ID/cover mapping and historical source URL/key stability after source-pool reordering.
- The frozen public APK passed APK Signature Scheme v2 verification (RSA 3072) and ZIP alignment with 16 KiB page checks. It was installed and launched on the API 34 emulator after removing the debug package; package inspection showed `versionName=1.0.0`, `versionCode=1`, no `DEBUGGABLE` flag, and its default server was the production HTTPS address (`release-installed.png`).
- The Android TV API 34 x86 emulator ran the native app at 1920×1080; screenshots are under `output/evidence/`. A 130% system font-size capture shows the nineteenth poster focused with a complete focus border; font scale was restored to 1.0.
- A deterministic local Node server exercised pairing, account identity, source pool, paginated discovery, search/detail, device commands and sync. The D-pad reached the nineteenth poster and the fixture log recorded `pageStart=20`, rather than a local array-only expansion.
- Media3 decoded Google's official `android-screens-10s.mp4` fixture. `dumpsys media_session` reported `PLAYING`, position 1.021 s, buffered position 10.024 s and no player error. History/progress reached the fixture sync endpoint with `x-libretv-account: fixture-user`.
- After the real curated catalogue became available, the same native emulator opened the official Hebei TV HLS stream from the 4K section. The actual player format reported 3840×2160, `avc1.640033`, `c2.goldfish.h264.decoder`, 98% buffer and `PLAYING` with no player error (`output/evidence/4k-real-live.png`). The catalogue was served by the local protocol harness; the media stream itself was the real broadcaster URL. This proves this sample's 4K decode on the emulator, not TCL hardware performance or all catalogue sources.
- The native debug client then connected to the real Tokyo staging service and its MySQL database through the existing local tunnel. It created a pairing challenge, displayed the server's eight-character code, received approval from the authenticated browser and obtained a TV session with a verified 365-day TTL. The browser wrote a 3.000 s sample progress record; native playback read that record and played the actual sample, and a browser sync pull read back native progress/history at 10.025 s. Only the new acceptance TV device was revoked afterward, and the two acceptance documents were tombstoned; existing devices and records were retained. Sanitized evidence is `output/evidence/staging-native-acceptance.json`, `staging-home.png` and `staging-current.png`. Cookies and Bearer tokens are not included in that evidence.
- The rc2 staging recheck used a second native eight-character pairing challenge (`pair-final.png`) and the real 19-item catalogue. The authenticated manifest endpoint returned HTTP 200 and valid HLS with absolute direct segment URLs. A phone-side `directUrl` command opened the real 4K VOD “攻壳机动队4K” without a CMS detail lookup. Actual decoded format was 3840×2074, `avc1.640033`, `c2.goldfish.h264.decoder`, with visible moving content (`staging-rc2-4k.png`). The browser read back native history/progress at 25.077 s of 4987.48 s from MySQL. That second temporary TV was revoked and its two documents tombstoned; existing browser sessions were retained (`staging-rc2-acceptance.json`). Source buffering occurred, so this confirms decoding and the integration path, not sustained 4K throughput or TCL hardware performance.
- Sample playback PSS was 111,763 KiB (~109 MiB); RSS was 227,068 KiB. The headless software-GPU emulator reported 24.44% janky frames in a mixed interaction capture. This is diagnostic emulator evidence, not a physical-television frame-rate result.

`tools/mock-server.mjs` is a test-only protocol fixture, not a source provider or production account service. To reproduce, place the official sample in ignored `tools/fixtures/sample.mp4`, start the Node script on port 19888, and use the debug build against `http://10.0.2.2:19888`. The sample URL is `https://storage.googleapis.com/androiddevelopers/samples_assets/exoplayer-test-media-1/mp4/android-screens-10s.mp4`. Mock records/posters are explicitly synthetic; sample media proves decoding, not production-source availability.

The TCL T7K was not connected. Its installation, overscan/remote key mapping, 4K/HDR/hardware-decoder behavior, sustained frame timing and real production playback remain physical-device checks. The user authorized website/APK delivery before those checks. The real account flow above was verified against Tokyo staging; the earlier protocol harness alone would not establish it.
