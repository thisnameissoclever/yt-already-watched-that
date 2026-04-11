(function initSettings(global) {
  const LEGACY_STORAGE_KEYS = ["enabledOnWatchPlaylist"];
  const CHANNEL_VIDEOS_PATH_PATTERN = /^\/(?:@[^/]+|channel\/[^/]+|user\/[^/]+|c\/[^/]+)\/videos\/?$/;
  const STORAGE_KEY_ORDER = [
    "enabledGlobally",
    "thresholdPercent",
    "enabledOnHome",
    "enabledOnSubscriptions",
    "enabledOnVideoPage",
    "enabledOnPlaylistPage",
    "enabledOnWatchPagePlaylist",
    "enabledOnSearchResults",
    "enabledOnChannelVideos",
  ];

  const DEFAULT_SETTINGS = Object.freeze({
    enabledGlobally: true,
    thresholdPercent: 70,
    enabledOnHome: true,
    enabledOnSubscriptions: true,
    enabledOnVideoPage: true,
    enabledOnPlaylistPage: true,
    enabledOnWatchPagePlaylist: true,
    enabledOnSearchResults: false,
    enabledOnChannelVideos: true,
  });

  function clampThreshold(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return DEFAULT_SETTINGS.thresholdPercent;
    }

    const snappedValue = Math.round(numericValue / 10) * 10;
    return Math.min(100, Math.max(0, snappedValue));
  }

  function normalizeSettings(partialSettings = {}) {
    return {
      enabledGlobally: partialSettings.enabledGlobally ?? DEFAULT_SETTINGS.enabledGlobally,
      thresholdPercent: clampThreshold(partialSettings.thresholdPercent),
      enabledOnHome: partialSettings.enabledOnHome ?? DEFAULT_SETTINGS.enabledOnHome,
      enabledOnSubscriptions:
        partialSettings.enabledOnSubscriptions ?? DEFAULT_SETTINGS.enabledOnSubscriptions,
      enabledOnVideoPage: partialSettings.enabledOnVideoPage ?? DEFAULT_SETTINGS.enabledOnVideoPage,
      enabledOnPlaylistPage:
        partialSettings.enabledOnPlaylistPage ?? DEFAULT_SETTINGS.enabledOnPlaylistPage,
      enabledOnWatchPagePlaylist:
        partialSettings.enabledOnWatchPagePlaylist ??
        partialSettings.enabledOnWatchPlaylist ??
        DEFAULT_SETTINGS.enabledOnWatchPagePlaylist,
      enabledOnSearchResults:
        partialSettings.enabledOnSearchResults ?? DEFAULT_SETTINGS.enabledOnSearchResults,
      enabledOnChannelVideos:
        partialSettings.enabledOnChannelVideos ?? DEFAULT_SETTINGS.enabledOnChannelVideos,
    };
  }

  function getPageScope(url = global.location) {
    const currentUrl = typeof url === "string" ? new URL(url) : new URL(url.href);
    const { pathname, searchParams } = currentUrl;

    if (pathname === "/results") {
      return "searchResults";
    }

    if (pathname === "/") {
      return "home";
    }

    if (pathname === "/feed/subscriptions") {
      return "subscriptions";
    }

    if (pathname === "/playlist") {
      return "playlist";
    }

    if (pathname === "/watch" && searchParams.has("list")) {
      return "watchPlaylist";
    }

    if (pathname === "/watch") {
      return "video";
    }

    if (CHANNEL_VIDEOS_PATH_PATTERN.test(pathname)) {
      return "channelVideos";
    }

    return "unsupported";
  }

  function isEnabledOnCurrentPage(settings, url = global.location) {
    if (!settings.enabledGlobally) {
      return false;
    }

    switch (getPageScope(url)) {
      case "home":
        return settings.enabledOnHome;
      case "subscriptions":
        return settings.enabledOnSubscriptions;
      case "video":
        return settings.enabledOnVideoPage;
      case "playlist":
        return settings.enabledOnPlaylistPage;
      case "watchPlaylist":
        return settings.enabledOnVideoPage || settings.enabledOnWatchPagePlaylist;
      case "searchResults":
        return settings.enabledOnSearchResults;
      case "channelVideos":
        return settings.enabledOnChannelVideos;
      default:
        return false;
    }
  }

  async function readSettings() {
    const storedValues = await chrome.storage.sync.get([...STORAGE_KEY_ORDER, ...LEGACY_STORAGE_KEYS]);
    return normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...storedValues,
    });
  }

  async function writeSettings(partialSettings) {
    const currentSettings = await readSettings();
    const nextSettings = normalizeSettings({
      ...currentSettings,
      ...partialSettings,
    });

    await chrome.storage.sync.set(nextSettings);
    return nextSettings;
  }

  function subscribeToSettingsChanges(listener) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") {
        return;
      }

      const changedValues = {};
      let hasRelevantChange = false;

      for (const key of [...STORAGE_KEY_ORDER, ...LEGACY_STORAGE_KEYS]) {
        if (!changes[key]) {
          continue;
        }

        changedValues[key] = changes[key].newValue;
        hasRelevantChange = true;
      }

      if (hasRelevantChange) {
        listener(normalizeSettings(changedValues), changes);
      }
    });
  }

  global.YAWTSettings = {
    DEFAULT_SETTINGS,
    STORAGE_KEY_ORDER,
    clampThreshold,
    normalizeSettings,
    getPageScope,
    isEnabledOnCurrentPage,
    readSettings,
    writeSettings,
    subscribeToSettingsChanges,
  };
})(globalThis);
