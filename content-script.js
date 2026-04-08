(function initContentScript(global) {
  const {
    DEFAULT_SETTINGS,
    isEnabledOnCurrentPage,
    readSettings,
    subscribeToSettingsChanges,
  } = global.YAWTSettings;

  const ROOT_SELECTOR = [
    "ytd-rich-item-renderer",
    "ytd-compact-video-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-rich-grid-media",
    "yt-lockup-view-model",
  ].join(", ");

  const WATCHED_SEGMENT_SELECTOR =
    "yt-thumbnail-overlay-progress-bar-view-model .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment";
  const MANAGED_ATTRIBUTE = "data-yawt-managed";
  const HIDDEN_ATTRIBUTE = "data-yawt-hidden";
  const STYLE_ELEMENT_ID = "yawt-extension-style";

  let activeSettings = { ...DEFAULT_SETTINGS };
  let scanTimerId = null;
  let lastSeenUrl = global.location.href;

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

      return Boolean(root.querySelector('a[href*="/watch?"]'));
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

  function shouldHideRoot(root, settings) {
    const watchedSegment = root.querySelector(WATCHED_SEGMENT_SELECTOR);
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

  function applyVisibility(root, shouldHide) {
    root.setAttribute(MANAGED_ATTRIBUTE, "true");

    if (shouldHide) {
      root.setAttribute(HIDDEN_ATTRIBUTE, "true");
      return;
    }

    root.removeAttribute(HIDDEN_ATTRIBUTE);
  }

  function scanPage() {
    scanTimerId = null;

    if (global.location.href !== lastSeenUrl) {
      lastSeenUrl = global.location.href;
      clearAllManagedState();
    }

    if (!isEnabledOnCurrentPage(activeSettings)) {
      clearAllManagedState();
      return;
    }

    ensureStyles();

    getCandidateRoots().forEach((root) => {
      applyVisibility(root, shouldHideRoot(root, activeSettings));
    });
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

  async function start() {
    activeSettings = await readSettings();
    ensureStyles();
    attachNavigationListeners();
    attachMutationObserver();
    subscribeToSettingsChanges(async () => {
      activeSettings = await readSettings();
      scheduleScan();
    });
    scheduleScan();
  }

  start().catch((error) => {
    console.error("YT Already Watched That failed to start.", error);
  });
})(globalThis);
