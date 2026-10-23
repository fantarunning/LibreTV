# LibreTV implementation and acceptance

## Scope

- MySQL account/device sessions; web 30 days, paired Android TV 365 days; revocation.
- Incremental history/progress/skip/favorite/preference sync, durable offline queue and account isolation.
- Genuine paginated recommendations with deduplication, responsive layouts and restored navigation.
- Maintained source pool, bounded aggregation, health and real media checks.
- Find and add genuine 4K playback sources. Verify encoded width/height, including accurately labeled cropped 3840-wide cinema frames, not source names; keep regression test clips separate from film sources.
- Native Netflix-style Android TV APK: pairing, discovery/search/history, D-pad navigation, Media3 playback and shared progress.
- Player controls, speed, episodes/auto-next, skip markers, source switching/recovery, sleep timer, tracks/subtitles where available, bounded cache/offline and paired-device remote control.
- Tokyo release with database backup/migrations, staged application, rollback and business-flow checks.

## Shared contracts

`src/lib/cloud-types.ts` defines sync documents. GET `/api/sync?cursor=N` returns records, next cursor and hasMore; POST `{mutations: CloudMutation[]}` returns accepted event IDs, current records and conflicts. Values set to null are persistent tombstones. Versions are server allocated and account scoped.

GET `/api/account/me` returns `AccountSession`. POST `/api/auth` accepts password and optional deviceName and creates a 30-day web session. Authenticated browser requests use HttpOnly cookies; native requests use `Authorization: Bearer <device token>`.

POST `/api/tv/pair` with `{deviceName}` returns `{deviceCode,userCode,expiresAt,verificationUrl}`. GET `/api/tv/pair?deviceCode=...` returns `{status:'pending'|'authorized'|'expired',token?,expiresAt?}`. POST `/api/tv/pair/approve` with `{userCode}` requires browser authorization and issues a 365-day TV device session. Only the pairing channel receives the native token.

TV remote `play` payloads can additionally contain `directUrl`, `width`, `height`, `codec` and `isLive` for verified direct media. HTTP(S) URLs and bounded dimensions/metadata are validated; the native TV bypasses CMS detail lookup for these entries. Pairing codes have eight characters.

## Evidence

Implementation and authorized website/APK delivery are complete. Builds, browser tests, API/database tests, emulator tests, TCL device checks and production checks are recorded separately. None substitutes for another. See `docs/verification-2026-10-23.md` for final production results and deferred physical-device checks.

- Initial production build passed; the first staged release runs independently on Tokyo port 18082.
- Final automated suite: 540 tests across 49 files passed; production build, lint and TypeScript checks passed.
- Real MySQL/API checks on Tokyo staging passed 11 flows: 30-day web / 365-day TV pairing, cross-device progress, idempotency, CAS conflicts, cursor paging, deletion tombstones, remote commands, CSRF, old-cookie rejection and revocation.
- Browser fixture checks: genuine 0 -> 24 recommendation requests, pairing UI, mobile/tablet account layouts, no 390px overflow.
- Actual Tokyo staging playback decoded in Chromium at 1920x756. Independent browser context restored at 42.018 seconds after pausing at 42 seconds. This staging tunnel test used an Origin forwarding gateway. Subsequent public HTTPS tests ran without interception and decoded 3840x2074, with a separate tablet context restoring at 31.005 seconds.
- At 320px, the actual watch page had no document overflow.
- The real Tokyo recommendation API returned 24 distinct entries at offset 0 and another 24 at offset 24; the second page contained new IDs.
- The native client paired against real Tokyo MySQL, read browser progress and wrote progress/history back. A second test sent a 4K VOD direct-play command through the phone API; Media3 displayed the actual film at 3840x2074 and returned 25.077 seconds of progress to MySQL. Manifest proxy responses were valid HLS with direct media-segment URLs.
- The frozen 4K catalogue contains 17 movie/language versions covering 14 films, plus two live channels. All 29 cross-source movie candidates that passed local dimension checks also passed Tokyo manifest/real-segment dimension checks; duplicates were removed from the published catalogue.
- Frozen signed Android TV APK: 1.0.0 (1), 10,188,484 bytes, SHA256 `7f978b3c8f53cff2eeeba7c8cfd24368176db9d7a8d6d2bbbb25c4effbf78ece`. V2 signature and 16KiB zip alignment passed.
- The user explicitly deferred physical TCL connection and requested website deployment plus the APK; emulator evidence must not be described as TCL performance evidence.
