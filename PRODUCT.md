# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

The owner uses a phone, tablet and a TCL T7K 75-inch Android television at home.

## Product Purpose

Extend LibreTV with a shared viewing history, durable account sessions, maintained playback sources, continuous recommendations and a remote-controlled television experience.

## Operating Context

The existing Tokyo server hosts LibreTV and a shared MySQL instance. Reuse that instance with an independent database and restricted account. The user explicitly authorized implementation followed by deployment.

## Capabilities and Constraints

- Phone and tablet use the responsive web app/PWA and fixed 30-day sessions.
- Television uses a native Android TV app with fixed 365-day device authorization and phone pairing.
- Shared viewing history and episode progress have offline local persistence and conflict handling.
- Recommendations load continuously while unique content remains available.
- Television playback uses Media3; the browser retains ArtPlayer and hls.js.
- The shared server is resource constrained; build locally and bound runtime concurrency and caches.
- Format, HDR, subtitles and multiple audio tracks depend on source and device support.

## Brand Commitments

Retain the LibreTV identity. The user explicitly requested Netflix-style television composition and smooth remote navigation.

## Evidence on Hand

Existing Next.js source, deployed LibreTV service and MySQL host were inspected. Actual TCL firmware, installation and frame-time measurements remain device validation work.

## Product Principles

- A viewing session can continue on another device.
- Remote focus, return position and clear playback controls are first-class behavior.
- Persist account state locally without storing the password.
- Keep source metadata reachability separate from successful video playback.
