const assert = require("node:assert/strict");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { chromium } = require("playwright");

const source = path.resolve(process.env.YAWT_EXTENSION_DIR || path.join(__dirname, ".."));
const origin = "https://www.youtube.com";
const progress = {
  legacy: ["ytd-thumbnail-overlay-resume-playback-renderer", 'id="progress"'],
  lockup: [
    "yt-thumbnail-overlay-progress-bar-view-model",
    'class="ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment"',
  ],
  resume: [
    "ytw-thumbnail-overlay-resume-playback-renderer",
    'class="ytwThumbnailOverlayResumePlaybackRendererThumbnailOverlayResumePlaybackProgress"',
  ],
};
let browser;
let youtube;
let options;
let extensionUrl;
let fixture;
let metadataRequests = [];
const pageErrors = [];

function card(tag, id, format = "lockup", percent = 90, attributes = "") {
  const [overlay, segment] = progress[format];
  const bar = percent === null ? "" : (
    '<' + overlay + '><div ' + segment + ' style="width: ' + percent + '%"></div></' + overlay + '>'
  );
  return '<' + tag + ' id="' + id + '" ' + attributes + '>' +
    '<a href="/watch?v=' + id + '">' + id + '</a>' + bar + '</' + tag + '>';
}

function short(id) {
  return '<yt-shorts-lockup-view-model id="' + id + '">' +
    '<h3><a href="/shorts/' + id + '">Short</a></h3>' +
    '<div class="shortsLockupViewModelHostMetadataSubhead" title="Original title">' +
    '<span>123 views</span></div></yt-shorts-lockup-view-model>';
}

async function openYouTube(url, html) {
  fixture = html;
  await youtube.goto(origin + url, { waitUntil: "domcontentloaded" });
  await youtube.locator("#yawt-extension-style").waitFor({ state: "attached" });
}

async function expectHidden(id, hidden) {
  const selector = "#" + id + (hidden ? '[data-yawt-hidden="true"]' : ":not([data-yawt-hidden])");
  await youtube.locator(selector).waitFor({ state: "attached" });
  assert.equal(await youtube.locator("#" + id).isVisible(), !hidden, id);
}

async function setSettings(values) {
  await options.evaluate((values) => chrome.storage.sync.set(values), values);
}

before(async () => {
  browser = await chromium.launchPersistentContext("", {
    channel: "chromium",
    executablePath: process.env.YAWT_CHROMIUM_PATH,
    headless: true,
    timeout: 10000,
    args: [
      "--disable-extensions-except=" + source,
      "--load-extension=" + source,
      "--renderer-process-limit=2",
      "--disable-gpu",
      "--js-flags=--max-old-space-size=128",
    ],
  });
  browser.setDefaultTimeout(2500);
  browser.on("page", (page) => page.on("pageerror", (error) => pageErrors.push(error.message)));
  const extensions = browser.pages()[0];
  await extensions.goto("chrome://extensions/");
  const item = extensions.locator("extensions-item").filter({ hasText: "Stop YouTube Reruns" });
  extensionUrl = "chrome-extension://" + await item.getAttribute("id");
  options = await browser.newPage();
  await options.goto(extensionUrl + "/options.html");
  youtube = await browser.newPage();
  await browser.route(origin + "/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.isNavigationRequest()) {
      await route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><style>body{margin:0} body *{display:block}</style>' + fixture,
      });
    } else if (url.pathname === "/youtubei/v1/player") {
      metadataRequests.push("player");
      await route.fulfill({ json: { videoDetails: { author: "Fixture Channel" } } });
    } else if (url.pathname.startsWith("/shorts/")) {
      metadataRequests.push(url.pathname);
      if (url.pathname === "/shorts/short_page_unavailable") {
        await route.abort("failed");
      } else {
        await route.fulfill({
          contentType: "text/html",
          body: '<script>var ytInitialPlayerResponse = {"publishDate": "2020-01-02", ' +
            '"ownerChannelName": "Page Channel"};</script>',
        });
      }
    } else {
      await route.abort();
    }
  });
});

after(async () => {
  await browser?.close();
  assert.deepEqual(pageErrors, []);
});

test("Home honors the threshold, filters nested lockups once, and excludes unwatched videos", async () => {
  await setSettings({ showShortsPublishDates: false, thresholdPercent: 70 });
  await openYouTube("/", '<ytd-rich-item-renderer id="outer">' +
    card("yt-lockup-view-model", "exact", "lockup", 70) + '</ytd-rich-item-renderer>' +
    card("ytd-rich-item-renderer", "partial", "lockup", 60) +
    card("ytd-rich-item-renderer", "unwatched", "lockup", null) +
    card("ytd-rich-item-renderer", "finished", "lockup", 100));
  await expectHidden("outer", true);
  await expectHidden("finished", true);
  await expectHidden("partial", false);
  await expectHidden("unwatched", false);
  assert.equal(await youtube.locator('[data-yawt-hidden]').count(), 2);
  await setSettings({ enabledOnHome: false });
  await expectHidden("outer", false);
  await setSettings({ enabledOnHome: true });
  await expectHidden("outer", true);
  await setSettings({ thresholdPercent: 100 });
  await expectHidden("outer", false);
  await expectHidden("finished", true);
  await setSettings({ thresholdPercent: 0 });
  await expectHidden("partial", true);
  await expectHidden("unwatched", false);
  await setSettings({ enabledGlobally: false });
  await expectHidden("partial", false);
  await setSettings({ enabledGlobally: true, thresholdPercent: 70 });
});

test("Search handles the newer resume overlay when filtering is enabled", async () => {
  await setSettings({ enabledOnSearchResults: false });
  await openYouTube("/results?search_query=fixture", card("ytd-video-renderer", "result", "resume"));
  await expectHidden("result", false);
  await setSettings({ enabledOnSearchResults: true });
  await expectHidden("result", true);
  await setSettings({ enabledOnSearchResults: false });
  await expectHidden("result", false);
});

test("playlist pages filter legacy playlist video rows", async () => {
  await openYouTube("/playlist?list=fixture", card("ytd-playlist-video-renderer", "row", "legacy"));
  await expectHidden("row", true);
  await setSettings({ enabledOnPlaylistPage: false });
  await expectHidden("row", false);
  await setSettings({ enabledOnPlaylistPage: true });
});

test("Subscriptions updates existing bars and clears hidden state from recycled cards", async () => {
  await openYouTube("/feed/subscriptions", card("ytd-grid-video-renderer", "subscription", "legacy", 10));
  await youtube.locator('#subscription[data-yawt-managed="true"]').waitFor();
  await expectHidden("subscription", false);
  await youtube.locator("#progress").evaluate((bar) => { bar.style.width = "90%"; });
  await expectHidden("subscription", true);
  await youtube.locator("#subscription a").evaluate((link) => { link.href = "/shorts/recycled"; });
  await expectHidden("subscription", false);
  await youtube.locator("#subscription a").evaluate((link) => { link.href = "/watch?v=recycled"; });
  await expectHidden("subscription", true);
  await setSettings({ enabledOnSubscriptions: false });
  await expectHidden("subscription", false);
  await setSettings({ enabledOnSubscriptions: true });
});

test("channel Videos supports handle and legacy URL forms", async () => {
  for (const url of ["/@fixture/videos", "/channel/fixture/videos", "/user/fixture/videos", "/c/fixture/videos"]) {
    await openYouTube(url, card("ytd-grid-video-renderer", "upload"));
    await expectHidden("upload", true);
  }
  await setSettings({ enabledOnChannelVideos: false });
  await expectHidden("upload", false);
  await setSettings({ enabledOnChannelVideos: true });
});

test("channel Home filters the Popular videos shelf and reports it in the popup", async () => {
  await setSettings({ thresholdPercent: 20, enabledOnHome: false });
  const shelf = '<ytd-shelf-renderer><h2>Popular videos</h2>' +
    '<yt-horizontal-list-renderer><div id="items">' +
    card("yt-lockup-view-model", "watched", "lockup", 100) +
    card("yt-lockup-view-model", "at_threshold", "lockup", 20) +
    card("yt-lockup-view-model", "below_threshold", "lockup", 19) +
    card("yt-lockup-view-model", "unwatched", "lockup", null) +
    '</div></yt-horizontal-list-renderer></ytd-shelf-renderer>';
  await openYouTube("/channel/UCkdgAA0rfK7lG5dv4o__Paw", shelf);
  const popup = await browser.newPage();
  try {
    await popup.goto(extensionUrl + "/popup.html");
    await youtube.bringToFront();
    await popup.reload();
    const status = popup.locator("#pageStatus");
    await status.filter({
      hasText: /2 watched videos hidden|This page is not currently filterable/,
    }).waitFor();
    assert.equal(await status.textContent(), "2 watched videos hidden on this page.");
    await expectHidden("watched", true);
    await expectHidden("at_threshold", true);
    await expectHidden("below_threshold", false);
    await expectHidden("unwatched", false);

    await popup.locator("#revealHidden").click();
    await expectHidden("watched", false);
    await expectHidden("at_threshold", false);
    await youtube.evaluate(() => {
      history.pushState(null, "", "/@fixture/videos");
      dispatchEvent(new Event("yt-navigate-finish"));
    });
    await expectHidden("watched", true);

    for (const url of ["/@fixture", "/@fixture/featured", "/channel/fixture/featured/",
      "/user/fixture", "/c/fixture/"]) {
      await openYouTube(url, shelf);
      await expectHidden("watched", true);
    }

    await setSettings({ enabledOnChannelVideos: false });
    await expectHidden("watched", false);
    await setSettings({ enabledOnChannelVideos: true });
    await expectHidden("watched", true);
    await youtube.evaluate(() => {
      history.pushState(null, "", "/@fixture/posts");
      dispatchEvent(new Event("yt-navigate-finish"));
    });
    await expectHidden("watched", false);
    await popup.reload();
    await popup.getByText("This page is not currently filterable.", { exact: true }).waitFor();
  } finally {
    await popup.close();
    await setSettings({ thresholdPercent: 70, enabledOnHome: true, enabledOnChannelVideos: true });
  }
});

test("watch-page recommendations and playlist toggles are independent", async () => {
  const watch = '<ytd-watch-next-secondary-results-renderer>' +
    card("yt-lockup-view-model", "recommendation") + '</ytd-watch-next-secondary-results-renderer>';
  await openYouTube("/watch?v=selected", watch);
  await expectHidden("recommendation", true);
  await openYouTube("/watch?v=selected&list=fixture", watch +
    '<ytd-playlist-panel-renderer id="playlist">' +
    card("ytd-playlist-panel-video-renderer", "selected", "legacy", 100, "selected") +
    card("ytd-playlist-panel-video-renderer", "upnext", "legacy") + '</ytd-playlist-panel-renderer>');
  await expectHidden("recommendation", true);
  await expectHidden("upnext", true);
  await expectHidden("selected", false);
  await youtube.evaluate(() => {
    document.querySelector("#selected").removeAttribute("selected");
    document.querySelector("#upnext").setAttribute("aria-current", "true");
  });
  await expectHidden("selected", true);
  await expectHidden("upnext", false);
  await youtube.evaluate(() => {
    document.querySelector("#selected").setAttribute("selected", "");
    document.querySelector("#upnext").removeAttribute("aria-current");
  });
  await setSettings({ enabledOnVideoPage: false });
  await expectHidden("recommendation", false);
  await expectHidden("upnext", true);
  await setSettings({ enabledOnWatchPagePlaylist: false, enabledOnVideoPage: true });
  await expectHidden("recommendation", true);
  await expectHidden("upnext", false);
  await setSettings({ enabledOnWatchPagePlaylist: true });
});

test("the extension popup counts and reveals hidden videos until YouTube navigates", async () => {
  await openYouTube("/", card("ytd-rich-item-renderer", "watched"));
  await expectHidden("watched", true);
  const popup = await browser.newPage();
  // A real toolbar popup leaves the YouTube tab active. Opening its HTML in a tab does not.
  await popup.goto(extensionUrl + "/popup.html");
  await youtube.bringToFront();
  await popup.reload();
  try {
    await popup.getByText("1 watched video hidden on this page.", { exact: true }).waitFor();
    await popup.locator("#thresholdPercent").fill("100");
    await expectHidden("watched", false);
    await popup.getByText("No watched videos hidden on this page.", { exact: true }).waitFor();
    await popup.locator("#thresholdPercent").fill("70");
    await expectHidden("watched", true);
    await popup.locator("#enabledGlobally").uncheck();
    await expectHidden("watched", false);
    await popup.locator("#enabledGlobally").check();
    await expectHidden("watched", true);
    await popup.locator("#revealHidden").click();
    await expectHidden("watched", false);
    await youtube.evaluate(() => {
      history.pushState(null, "", "/feed/subscriptions");
      dispatchEvent(new Event("yt-navigate-finish"));
    });
    await expectHidden("watched", true);
    await options.close();
    const optionsOpened = browser.waitForEvent("page");
    await popup.locator("#openOptions").click();
    options = await optionsOpened;
    await options.waitForURL(extensionUrl + "/options.html");
  } finally {
    await popup.close();
  }
});

test("Shorts combines player and page metadata and restores YouTube's text and tooltip", async () => {
  metadataRequests = [];
  await setSettings({ showShortsPublishDates: true });
  await openYouTube("/", '<script>window.fixture={"INNERTUBE_API_KEY":"fixture",' +
    '"INNERTUBE_CLIENT_VERSION":"fixture"};</script>' + short("short_fixture"));
  const subhead = youtube.locator("#short_fixture .shortsLockupViewModelHostMetadataSubhead");
  await youtube.getByText(/123 views.*years ago/).waitFor();
  await youtube.getByText("Fixture Channel", { exact: true }).waitFor();
  assert.deepEqual(metadataRequests, ["player", "/shorts/short_fixture"]);
  await options.reload();
  await options.locator("#showShortsPublishDates").uncheck();
  await youtube.getByText("123 views", { exact: true }).waitFor();
  assert.equal(await subhead.getAttribute("title"), "Original title");
  assert.equal(await youtube.getByText("Fixture Channel", { exact: true }).count(), 0);
});

test("Shorts keeps available player metadata when the page request fails", async () => {
  metadataRequests = [];
  await setSettings({ showShortsPublishDates: true });
  await openYouTube("/", '<script>window.fixture={"INNERTUBE_API_KEY":"fixture",' +
    '"INNERTUBE_CLIENT_VERSION":"fixture"};</script>' + short("short_page_unavailable"));
  await youtube.getByText("Fixture Channel", { exact: true }).waitFor();
  assert.deepEqual(metadataRequests, ["player", "/shorts/short_page_unavailable"]);
});

test("Shorts keeps native metadata when YouTube reuses a card", async () => {
  await openYouTube("/", short("reused_short"));
  const subhead = youtube.locator("#reused_short .shortsLockupViewModelHostMetadataSubhead");
  await youtube.getByText(/123 views.*years ago/).waitFor();
  await youtube.locator("#reused_short").evaluate((root) => {
    root.querySelector("a").href = "/shorts/replacement_short";
    const subhead = root.querySelector(".shortsLockupViewModelHostMetadataSubhead");
    subhead.title = "Replacement title";
    subhead.querySelector("span").innerHTML = "<em>456 views</em>";
  });
  await youtube.getByText(/456 views.*years ago/).waitFor();
  await setSettings({ showShortsPublishDates: false });
  await subhead.and(youtube.locator('[title="Replacement title"]')).waitFor();
  assert.equal(await subhead.textContent(), "456 views");
  assert.equal(await subhead.getAttribute("title"), "Replacement title");
  assert.equal(await subhead.locator("em").count(), 1);
});

test("older saved playlist settings survive an upgrade", async () => {
  await options.evaluate(async () => {
    await chrome.storage.sync.remove("enabledOnWatchPagePlaylist");
    await chrome.storage.sync.set({ enabledOnWatchPlaylist: false, thresholdPercent: 50 });
  });
  await options.reload();
  await options.getByText("50%", { exact: true }).waitFor();
  assert.equal(await options.locator("#enabledOnWatchPagePlaylist").isChecked(), false);
});
