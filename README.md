# Stop YouTube Reruns

A Chrome extension that hides videos you've already watched from YouTube suggestions, feeds, channel video tabs, search results, and playlists.

## What it does

- Detects YouTube's watched-progress thumbnail bar and hides matching videos.
- Supports Home, Subscriptions, video-page suggestions, playlist pages, the playlist widget on video pages, channel videos tabs, and optional search results.
- Adds a popup status readout showing how many watched videos are hidden on the current page.
- Lets you temporarily reveal hidden videos on the current page until that tab refreshes or navigates.
- Lets you choose a watched threshold from `0%` to `100%` in `10%` steps.

## Current settings

- `Filtering enabled`: global on or off toggle
  - Default: `on`
- `Hide watched videos after`: slider from `0%` to `100%`
  - Default: `70%`
  - `0%` hides any video that shows a watched-progress bar
  - `100%` hides only fully watched videos
- Page toggles:
  - Video page suggestions
  - Playlist on video page
  - Search results
    - Default: `off`
  - Channel videos tab
    - Default: `on`
  - Subscriptions feed
  - Home feed
  - Playlist page

On a video page with a playlist open, `Video page suggestions` controls the suggestions rail and `Playlist on video page` controls only the playlist widget above it.
The currently playing video is always left visible inside the playlist widget.

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
- `ytd-thumbnail-overlay-resume-playback-renderer #progress`

If the watched segment width meets or exceeds your configured threshold, the extension hides the video card from the page layout.
