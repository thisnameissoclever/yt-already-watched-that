# Stop YouTube Reruns

A Chrome extension that hides videos you've already watched from YouTube suggestions, feeds, channel Home and Videos tabs, search results, and playlists.

## What it does

- Detects YouTube's watched-progress thumbnail bar and hides matching videos.
- Supports Home, Subscriptions, video-page suggestions, playlist pages, the playlist widget on video pages, channel Home and Videos tabs, and optional search results.
- Shows publish ages and thumbnail duration badges on visible Shorts cards when YouTube provides that information.
- Links creator names to their Shorts tabs in search, Home, and Subscriptions. On a channel's Home tab, the Shorts shelf heading links to the channel's Shorts tab.
- Adds a popup status readout showing how many watched videos are hidden on the current page.
- Lets you temporarily reveal hidden videos on the current page until that tab refreshes or navigates.
- Lets you choose a watched threshold from `0%` to `100%` in `10%` steps.

## Current settings

- `Filtering enabled`: global on or off toggle
  - Default: `on`
- `Show Shorts metadata`: adds regular-video-style metadata to visible Shorts cards
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
  - Channel Home and Videos
    - Default: `on`
  - Subscriptions feed
  - Home feed
  - Playlist page

On a video page with a playlist open, `Video page suggestions` controls the suggestions rail and `Playlist on video page` controls only the playlist widget above it.
The currently playing video is always left visible inside the playlist widget.

The channel setting covers video shelves such as Popular videos on a channel's Home tab and the uploads on its Videos tab.

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
4. Select the folder containing `manifest.json`.

## How it works

The extension looks for YouTube's watched-progress marker inside each supported video card:

- `yt-thumbnail-overlay-progress-bar-view-model`
- `.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment`
- `ytw-thumbnail-overlay-resume-playback-renderer`
- `ytd-thumbnail-overlay-resume-playback-renderer #progress`

If the watched segment width meets or exceeds your configured threshold, the extension hides the video card from the page layout. It checks again when YouTube updates the progress bar or reuses the card.

The extension reads Shorts metadata from YouTube's player response and Short pages. It caches the results in memory while the browser tab is open. A Short can show a publish age like `2 days ago` and a duration badge like `0:42`. If YouTube supplies a creator name without a channel address, the name appears as plain text. The dedicated Shorts tab identifies the creator in the page heading.

## Browser tests

With Playwright and its Chromium browser available locally, run `node --test --test-concurrency=1 tests/extension.test.cjs`. Set `YAWT_EXTENSION_DIR` to test an extracted release package. Set `YAWT_CHROMIUM_PATH` if using a Chromium executable outside Playwright's default installation.
