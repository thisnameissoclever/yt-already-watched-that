(function initContentScript(global) {
  const {
    DEFAULT_SETTINGS,
    getPageScope,
    readSettings,
    subscribeToSettingsChanges,
  } = global.YAWTSettings;

  const ROOT_SELECTOR = [
    "ytd-rich-item-renderer",
    "ytd-compact-video-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-rich-grid-media",
    "ytd-playlist-panel-video-renderer",
    "yt-lockup-view-model",
  ].join(", ");

  const WATCHED_SEGMENT_SELECTORS = [
    "yt-thumbnail-overlay-progress-bar-view-model .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment",
    "ytd-thumbnail-overlay-resume-playback-renderer #progress",
  ];
  const CONTENT_LINK_SELECTOR = 'a[href*="/watch?"]';
  const WATCH_PAGE_PLAYLIST_SELECTOR = "ytd-playlist-panel-renderer#playlist";
  const WATCH_PAGE_SUGGESTIONS_SELECTOR = "ytd-watch-next-secondary-results-renderer";
  const MANAGED_ATTRIBUTE = "data-yawt-managed";
  const HIDDEN_ATTRIBUTE = "data-yawt-hidden";
  const STYLE_ELEMENT_ID = "yawt-extension-style";
  const SUPPORTED_PAGE_SCOPES = new Set([
    "home",
    "subscriptions",
    "video",
    "playlist",
    "watchPlaylist",
    "searchResults",
    "channelVideos",
  ]);

  let activeSettings = { ...DEFAULT_SETTINGS };
  let scanTimerId = null;
  let lastSeenUrl = global.location.href;
  let currentPageScope = getPageScope();
  let currentHiddenCount = 0;
  let pageRevealActive = false;

  function ensureStyles() {
    if (document.getElementById(STYLE_ELEMENT_ID)) {
      return;
    }

    const styleElement = document.createElement("style");
    styleElement.id = STYLE_ELEMENT_ID;
    styleElement.textContent = `
      [${HIDDEN_ATTRIBUTE}="true"] {
        display: none !important;
      }
    `;
    document.documentElement.appendChild(styleElement);
  }

  function clearRootState(root) {
    root.removeAttribute(HIDDEN_ATTRIBUTE);
    root.removeAttribute(MANAGED_ATTRIBUTE);
  }

  function clearAllManagedState() {
    document.querySelectorAll(`[${MANAGED_ATTRIBUTE}="true"], [${HIDDEN_ATTRIBUTE}="true"]`).forEach((root) => {
      clearRootState(root);
    });
  }

  function getCandidateRoots() {
    return Array.from(document.querySelectorAll(ROOT_SELECTOR)).filter((root) => {
      if (root.parentElement?.closest(ROOT_SELECTOR)) {
        return false;
      }

      return Boolean(root.querySelector(CONTENT_LINK_SELECTOR));
    });
  }

  function parseWatchedPercent(segment) {
    if (!segment) {
      return null;
    }

    const inlineWidth = segment.style.width?.trim();
    if (!inlineWidth) {
      return null;
    }

    if (!inlineWidth.endsWith("%")) {
      return null;
    }

    const numericValue = Number.parseFloat(inlineWidth.slice(0, -1));
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  function getWatchedSegment(root) {
    for (const selector of WATCHED_SEGMENT_SELECTORS) {
      const segment = root.querySelector(selector);
      if (segment) {
        return segment;
      }
    }

    return null;
  }

  function isCurrentPlaylistItem(root) {
    if (!root.matches("ytd-playlist-panel-video-renderer")) {
      return false;
    }

    return (
      root.hasAttribute("selected") ||
      root.hasAttribute("current") ||
      root.getAttribute("aria-current") === "true"
    );
  }

  function shouldHideRoot(root, settings) {
    if (isCurrentPlaylistItem(root)) {
      return false;
    }

    const watchedSegment = getWatchedSegment(root);
    if (!watchedSegment) {
      return false;
    }

    if (settings.thresholdPercent === 0) {
      return true;
    }

    const watchedPercent = parseWatchedPercent(watchedSegment);
    if (watchedPercent === null) {
      return false;
    }

    return watchedPercent >= settings.thresholdPercent;
  }

  function isFilteringEnabledForRoot(root, settings, pageScope) {
    switch (pageScope) {
      case "home":
        return settings.enabledOnHome;
      case "subscriptions":
        return settings.enabledOnSubscriptions;
      case "playlist":
        return settings.enabledOnPlaylistPage;
      case "video":
        return root.closest(WATCH_PAGE_SUGGESTIONS_SELECTOR) ? settings.enabledOnVideoPage : false;
      case "watchPlaylist":
        if (root.closest(WATCH_PAGE_PLAYLIST_SELECTOR)) {
          return settings.enabledOnWatchPagePlaylist;
        }

        if (root.closest(WATCH_PAGE_SUGGESTIONS_SELECTOR)) {
          return settings.enabledOnVideoPage;
        }

        return false;
      case "searchResults":
        return settings.enabledOnSearchResults;
      case "channelVideos":
        return settings.enabledOnChannelVideos;
      default:
        return false;
    }
  }

  function applyVisibility(root, shouldHide) {
    root.setAttribute(MANAGED_ATTRIBUTE, "true");

    if (shouldHide) {
      root.setAttribute(HIDDEN_ATTRIBUTE, "true");
      return;
    }

    root.removeAttribute(HIDDEN_ATTRIBUTE);
  }

  function getPageStatus() {
    return {
      supported: SUPPORTED_PAGE_SCOPES.has(currentPageScope),
      hiddenCount: currentHiddenCount,
      revealActive: pageRevealActive,
      pageScope: currentPageScope,
    };
  }

  function scanPage() {
    scanTimerId = null;
    const pageScope = getPageScope();
    currentPageScope = pageScope;

    if (global.location.href !== lastSeenUrl) {
      lastSeenUrl = global.location.href;
      pageRevealActive = false;
      currentHiddenCount = 0;
      clearAllManagedState();
    }

    if (!activeSettings.enabledGlobally || !SUPPORTED_PAGE_SCOPES.has(pageScope)) {
      currentHiddenCount = 0;
      clearAllManagedState();
      return;
    }

    if (pageRevealActive) {
      currentHiddenCount = 0;
      clearAllManagedState();
      return;
    }

    ensureStyles();

    let hiddenCount = 0;

    getCandidateRoots().forEach((root) => {
      if (!isFilteringEnabledForRoot(root, activeSettings, pageScope)) {
        clearRootState(root);
        return;
      }

      const hideRoot = shouldHideRoot(root, activeSettings);
      applyVisibility(root, hideRoot);

      if (hideRoot) {
        hiddenCount += 1;
      }
    });

    currentHiddenCount = hiddenCount;
  }

  function scheduleScan() {
    if (scanTimerId !== null) {
      global.clearTimeout(scanTimerId);
    }

    scanTimerId = global.setTimeout(scanPage, 100);
  }

  function attachNavigationListeners() {
    const navigationEvents = [
      "yt-navigate-finish",
      "yt-page-data-updated",
      "popstate",
      "hashchange",
    ];

    navigationEvents.forEach((eventName) => {
      global.addEventListener(eventName, scheduleScan, { passive: true });
    });
  }

  function attachMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "childList") {
          continue;
        }

        if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
          scheduleScan();
          return;
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function attachMessageListener() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "yawt:getPageStatus") {
        sendResponse(getPageStatus());
        return;
      }

      if (message?.type === "yawt:revealCurrentPage") {
        pageRevealActive = true;
        currentHiddenCount = 0;
        clearAllManagedState();
        sendResponse(getPageStatus());
      }
    });
  }

  async function start() {
    activeSettings = await readSettings();
    ensureStyles();
    attachNavigationListeners();
    attachMutationObserver();
    attachMessageListener();
    subscribeToSettingsChanges(async () => {
      activeSettings = await readSettings();
      scheduleScan();
    });
    scheduleScan();
  }

  start().catch((error) => {
    console.error("Stop YouTube Reruns failed to start.", error);
  });
})(globalThis);
