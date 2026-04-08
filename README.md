# Stop YouTube Reruns

A Chrome extension that hides videos you've already watched from YouTube suggestions, Home, Subscriptions, and playlists.

## What it does

- Detects YouTube's watched-progress thumbnail bar and hides matching videos.
- Supports Home, Subscriptions, video pages, playlist pages, and watch pages with an open playlist.
- Lets you choose a watched threshold from `0%` to `100%` in `10%` steps.

## Current settings

- `Hide watched videos after`: slider from `0%` to `100%`
  - Default: `70%`
  - `0%` hides any video that shows a watched-progress bar
  - `100%` hides only fully watched videos
- Page toggles:
  - Video page
  - Subscriptions page
  - Home page
  - Playlist page
  - Watch page with playlist open

## Project files

- `manifest.json`: Chrome extension manifest
- `settings.js`: shared storage and page-scope helpers
- `content-script.js`: YouTube DOM detection and hiding logic
- `popup.html`, `popup.css`, `popup.js`: quick settings shown from the toolbar icon
- `options.html`, `options.css`, `options.js`: full settings page

## Load in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `C:\Users\myema\OneDrive\Work\Vibes\yt-already-watched-that`

## How it works

The extension looks for YouTube's watched-progress marker inside each supported video card:

- `yt-thumbnail-overlay-progress-bar-view-model`
- `.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment`

If the watched segment width meets or exceeds your configured threshold, the extension hides the video card from the page layout.
