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
    "ytd-playlist-video-renderer",
    "ytd-playlist-panel-video-renderer",
    "yt-lockup-view-model",
  ].join(", ");

  const WATCHED_SEGMENT_SELECTORS = [
    "yt-thumbnail-overlay-progress-bar-view-model .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment",
    "ytw-thumbnail-overlay-resume-playback-renderer .ytwThumbnailOverlayResumePlaybackRendererThumbnailOverlayResumePlaybackProgress",
    "ytd-thumbnail-overlay-resume-playback-renderer #progress",
  ];
  const WATCHED_SEGMENT_SELECTOR = WATCHED_SEGMENT_SELECTORS.join(", ");
  const CONTENT_LINK_SELECTOR = 'a[href*="/watch?"]';
  const SHORTS_LINK_SELECTOR = 'a[href*="/shorts/"]';
  const SHORTS_ROOT_SELECTOR = [
    "ytd-rich-item-renderer",
    "ytd-rich-grid-media",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-reel-item-renderer",
    "yt-lockup-view-model",
    "ytm-shorts-lockup-view-model",
    "yt-shorts-lockup-view-model",
  ].join(", ");
  const WATCH_PAGE_PLAYLIST_SELECTOR = "ytd-playlist-panel-renderer#playlist";
  const WATCH_PAGE_SUGGESTIONS_SELECTOR = "ytd-watch-next-secondary-results-renderer";
  const MANAGED_ATTRIBUTE = "data-yawt-managed";
  const HIDDEN_ATTRIBUTE = "data-yawt-hidden";
  const SHORTS_METADATA_ATTRIBUTE = "data-yawt-shorts-metadata";
  const SHORTS_VIDEO_ID_ATTRIBUTE = "data-yawt-shorts-video-id";
  const SHORTS_CHANNEL_NAME_CLASS = "yawt-shorts-channel-name";
  const SHORTS_EXTRA_METADATA_CLASS = "yawt-shorts-extra-metadata";
  const SHORTS_DURATION_CLASS = "yawt-shorts-duration";
  const SHORTS_DURATION_TEXT_CLASS = "yawt-shorts-duration-text";
  const SHORTS_SHELF_LINK_CLASS = "yawt-shorts-shelf-link";
  const SHORTS_SHELF_TITLE_ATTRIBUTE = "data-yawt-native-shorts-shelf-title";
  const SHORTS_METADATA_ELEMENTS = [
    SHORTS_CHANNEL_NAME_CLASS,
    SHORTS_EXTRA_METADATA_CLASS,
    SHORTS_DURATION_CLASS,
    SHORTS_DURATION_TEXT_CLASS,
  ].map((className) => "." + className).join(", ");
  const CHANNEL_HOME_PATH = /^\/(@[^/]+|(?:channel|user|c)\/[^/]+)(?:\/featured)?\/?$/;
  const SHORTS_AGE_ATTRIBUTE = "data-yawt-shorts-age";
  const SHORTS_METADATA_FETCH_CONCURRENCY = 2;
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
  let activeShortsMetadataFetchCount = 0;
  let cachedInnertubeClientConfig = null;
  const shortsMetadataCache = new Map();
  const shortsSubheadDecorations = new WeakMap();
  const pendingShortsMetadataVideoIds = new Set();
  const shortsMetadataQueue = [];

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

      .${SHORTS_CHANNEL_NAME_CLASS},
      .${SHORTS_EXTRA_METADATA_CLASS} {
        color: var(--yt-spec-text-secondary, #aaa);
        display: block;
        font-family: Roboto, Arial, sans-serif;
        font-size: 1.2rem;
        font-weight: 400;
        line-height: 1.6rem;
        margin-top: 2px;
      }

      a.${SHORTS_CHANNEL_NAME_CLASS} {
        width: fit-content;
        max-width: 100%;
      }

      a.${SHORTS_CHANNEL_NAME_CLASS},
      .${SHORTS_SHELF_LINK_CLASS} {
        color: var(--yt-spec-call-to-action, #065fd4);
        text-decoration: underline;
        text-underline-offset: 2px;
        overflow-wrap: anywhere;
      }

      html[dark] a.${SHORTS_CHANNEL_NAME_CLASS},
      html[dark] .${SHORTS_SHELF_LINK_CLASS} {
        color: var(--yt-spec-call-to-action, #8ab4f8);
      }

      [${SHORTS_SHELF_TITLE_ATTRIBUTE}] {
        display: none !important;
      }

      .${SHORTS_DURATION_CLASS} {
        position: absolute;
        inset: auto 7px 7px auto;
        z-index: 1;
        padding: 3px 5px;
        border-radius: 4px;
        background: #101218;
        color: #fff;
        font: 600 12px/1.2 Roboto, Arial, sans-serif;
        font-variant-numeric: tabular-nums;
        pointer-events: none;
      }

      .${SHORTS_DURATION_TEXT_CLASS} {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
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

  function clearAllShortsMetadataState() {
    clearShortsMetadataElements(document);
    document.querySelectorAll(`.${SHORTS_SHELF_LINK_CLASS}`).forEach((link) => link.remove());
    document.querySelectorAll(`[${SHORTS_SHELF_TITLE_ATTRIBUTE}]`).forEach((title) => {
      title.removeAttribute(SHORTS_SHELF_TITLE_ATTRIBUTE);
    });

    document.querySelectorAll(`[${SHORTS_AGE_ATTRIBUTE}]`).forEach(removeShortsSubheadAge);

    document.querySelectorAll(`[${SHORTS_METADATA_ATTRIBUTE}], [${SHORTS_VIDEO_ID_ATTRIBUTE}]`).forEach((root) => {
      root.removeAttribute(SHORTS_METADATA_ATTRIBUTE);
      root.removeAttribute(SHORTS_VIDEO_ID_ATTRIBUTE);
    });
  }

  function removeShortsSubheadAge(subhead) {
    const decoration = shortsSubheadDecorations.get(subhead);
    if (!decoration) {
      return;
    }

    decoration.suffix.remove();
    if (subhead.getAttribute("title") === decoration.appliedTitle) {
      if (decoration.originalTitle === null) {
        subhead.removeAttribute("title");
      } else {
        subhead.title = decoration.originalTitle;
      }
    }
    subhead.removeAttribute(SHORTS_AGE_ATTRIBUTE);
    shortsSubheadDecorations.delete(subhead);
  }

  function clearShortsMetadataElements(root) {
    root.querySelectorAll(SHORTS_METADATA_ELEMENTS).forEach((element) => element.remove());
  }

  function getCandidateRoots() {
    return Array.from(document.querySelectorAll(ROOT_SELECTOR)).filter((root) => {
      if (root.parentElement?.closest(ROOT_SELECTOR) || !root.querySelector(CONTENT_LINK_SELECTOR)) {
        clearRootState(root);
        return false;
      }

      return true;
    });
  }

  function getShortsCandidateRoots() {
    return Array.from(document.querySelectorAll(SHORTS_ROOT_SELECTOR)).filter((root) => {
      if (root.parentElement?.closest(SHORTS_ROOT_SELECTOR)) {
        return false;
      }

      if (!root.querySelector(SHORTS_LINK_SELECTOR)) {
        return false;
      }

      return isElementVisibleInViewport(root);
    });
  }

  function isElementVisibleInViewport(element) {
    if (!element.isConnected || element.hasAttribute(HIDDEN_ATTRIBUTE)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    if (rect.bottom <= 0 || rect.right <= 0) {
      return false;
    }

    if (rect.top >= global.innerHeight || rect.left >= global.innerWidth) {
      return false;
    }

    const style = global.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function getShortsVideoId(root) {
    const link = root.querySelector(SHORTS_LINK_SELECTOR);
    if (!link?.href) {
      return null;
    }

    try {
      const shortsUrl = new URL(link.href, global.location.origin);
      const match = shortsUrl.pathname.match(/^\/shorts\/([^/?#]+)/);
      return match?.[1] ?? null;
    } catch (_error) {
      return null;
    }
  }

  function syncShortsMetadata(settings, pageScope) {
    if (!settings.showShortsPublishDates) {
      clearAllShortsMetadataState();
      return;
    }

    ensureStyles();
    syncChannelHomeShortsShelf();

    document.querySelectorAll(`[${SHORTS_VIDEO_ID_ATTRIBUTE}]`).forEach((root) => {
      if (root.getAttribute(SHORTS_VIDEO_ID_ATTRIBUTE) !== getShortsVideoId(root)) {
        removeShortsMetadata(root);
      }
    });

    getShortsCandidateRoots().forEach((root) => {
      const videoId = getShortsVideoId(root);
      if (!videoId) {
        removeShortsMetadata(root);
        return;
      }

      if (root.getAttribute(SHORTS_VIDEO_ID_ATTRIBUTE) !== videoId) {
        removeShortsMetadata(root);
      }

      root.setAttribute(SHORTS_VIDEO_ID_ATTRIBUTE, videoId);
      const cachedMetadata = shortsMetadataCache.get(videoId);

      if (shortsMetadataCache.has(videoId)) {
        renderShortsMetadata(root, cachedMetadata, pageScope);
        return;
      }

      enqueueShortsMetadataFetch(videoId);
    });
  }

  function removeShortsMetadata(root) {
    root.removeAttribute(SHORTS_METADATA_ATTRIBUTE);
    root.removeAttribute(SHORTS_VIDEO_ID_ATTRIBUTE);
    clearShortsMetadataElements(root);
    root.querySelectorAll(`[${SHORTS_AGE_ATTRIBUTE}]`).forEach(removeShortsSubheadAge);
  }

  function renderShortsMetadata(root, metadata, pageScope) {
    if (!metadata) {
      removeShortsMetadata(root);
      return;
    }

    const publishedAgoText = formatShortsPublishedAgo(metadata.publishDate);
    const channelName = shouldRenderShortsChannelName(pageScope) ? metadata.channelName : null;

    root.setAttribute(SHORTS_METADATA_ATTRIBUTE, "true");
    renderShortsChannelName(root, channelName, metadata.channelUrl);
    renderShortsDuration(root, metadata.durationSeconds);
    renderShortsPublishedAgo(root, publishedAgoText);
  }

  function renderShortsChannelName(root, channelName, channelUrl) {
    let element = root.querySelector(`.${SHORTS_CHANNEL_NAME_CLASS}`);
    if (!channelName) {
      element?.remove();
      return;
    }

    const tag = channelUrl ? "a" : "span";
    if (element?.localName !== tag) {
      element?.remove();
      element = document.createElement(tag);
      element.className = SHORTS_CHANNEL_NAME_CLASS;
    }

    if (channelUrl) {
      setShortsLink(element, channelName, channelUrl);
    } else if (element.textContent !== channelName) {
      element.textContent = channelName;
    }

    if (element.isConnected) {
      return;
    }

    const subhead = getShortsMetadataSubhead(root);
    const title = root.querySelector("h3");
    const containingLink = (subhead ?? title)?.closest("a");
    if (containingLink && root.contains(containingLink)) {
      containingLink.insertAdjacentElement("afterend", element);
    } else if (subhead) {
      subhead.insertAdjacentElement("beforebegin", element);
    } else if (title) {
      title.insertAdjacentElement("afterend", element);
    } else {
      root.appendChild(element);
    }
  }

  function setShortsLink(link, channelName, channelUrl) {
    const label = `${channelName}’s Shorts`;
    if (link.textContent !== label) {
      link.textContent = label;
    }
    if (link.href !== channelUrl) {
      link.href = channelUrl;
    }
  }

  function syncChannelHomeShortsShelf() {
    const channelHome = global.location.pathname.match(CHANNEL_HOME_PATH);
    if (!channelHome) {
      return;
    }

    const channelUrl = `${global.location.origin}/${channelHome[1]}/shorts`;
    document.querySelectorAll('ytd-browse[page-subtype="channels"]:not([hidden])').forEach((browse) => {
      const channelName = browse.querySelector("h1.dynamicTextViewModelH1, ytd-c4-tabbed-header-renderer #channel-name")
        ?.textContent.trim();
      if (!channelName) {
        return;
      }

      browse.querySelectorAll("ytd-reel-shelf-renderer").forEach((shelf) => {
        const title = shelf.querySelector("h2 #title");
        let link = shelf.querySelector(`.${SHORTS_SHELF_LINK_CLASS}`);
        if (!title || title.querySelector("a") || title.closest("a") || !shelf.querySelector(SHORTS_LINK_SELECTOR)) {
          link?.remove();
          title?.removeAttribute(SHORTS_SHELF_TITLE_ATTRIBUTE);
          return;
        }

        if (link?.previousElementSibling !== title) {
          link?.remove();
          link = document.createElement("a");
          link.className = SHORTS_SHELF_LINK_CLASS;
          const { fontSize, fontWeight, lineHeight } = global.getComputedStyle(title);
          Object.assign(link.style, { fontSize, fontWeight, lineHeight });
          title.insertAdjacentElement("afterend", link);
        }
        setShortsLink(link, channelName, channelUrl);
        title.setAttribute(SHORTS_SHELF_TITLE_ATTRIBUTE, "");
      });
    });
  }

  function renderShortsDuration(root, durationSeconds) {
    const thumbnail = root.querySelector("yt-thumbnail-view-model, ytd-thumbnail");
    let badge = root.querySelector(`.${SHORTS_DURATION_CLASS}`);
    let description = root.querySelector(`.${SHORTS_DURATION_TEXT_CLASS}`);
    if (!thumbnail || !durationSeconds) {
      badge?.remove();
      description?.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement("span");
      badge.className = SHORTS_DURATION_CLASS;
      badge.setAttribute("aria-hidden", "true");
    }
    if (badge.parentElement !== thumbnail) {
      thumbnail.appendChild(badge);
    }
    if (!description) {
      description = document.createElement("span");
      description.className = SHORTS_DURATION_TEXT_CLASS;
      root.appendChild(description);
    }

    const duration = formatShortsDuration(durationSeconds);
    if (badge.textContent !== duration) {
      badge.textContent = duration;
    }
    const descriptionText = `Duration ${duration}`;
    if (description.textContent !== descriptionText) {
      description.textContent = descriptionText;
    }
  }

  function formatShortsDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function renderShortsPublishedAgo(root, publishedAgoText) {
    const subhead = getShortsMetadataSubhead(root);
    const existingExtraMetadata = root.querySelector(`.${SHORTS_EXTRA_METADATA_CLASS}`);

    if (subhead) {
      existingExtraMetadata?.remove();
      renderShortsSubheadAge(subhead, publishedAgoText);
      return;
    }

    if (!publishedAgoText) {
      existingExtraMetadata?.remove();
      return;
    }

    renderShortsExtraMetadata(root, publishedAgoText);
  }

  function renderShortsExtraMetadata(root, publishedAgoText) {
    let element = root.querySelector(`.${SHORTS_EXTRA_METADATA_CLASS}`);
    if (!element) {
      element = document.createElement("div");
      element.className = SHORTS_EXTRA_METADATA_CLASS;
    }

    if (element.textContent !== publishedAgoText) {
      element.textContent = publishedAgoText;
      element.title = publishedAgoText;
    }

    if (element.isConnected) {
      return;
    }

    const channelNameElement = root.querySelector(`.${SHORTS_CHANNEL_NAME_CLASS}`);
    if (channelNameElement) {
      channelNameElement.insertAdjacentElement("afterend", element);
      return;
    }

    const title = root.querySelector("h3");
    if (title?.parentElement) {
      title.insertAdjacentElement("afterend", element);
      return;
    }

    root.appendChild(element);
  }

  function getShortsMetadataSubhead(root) {
    return root.querySelector(
      ".shortsLockupViewModelHostOutsideMetadataSubhead, .shortsLockupViewModelHostMetadataSubhead"
    );
  }

  function getShortsSubheadTextElement(subhead) {
    return subhead.querySelector(".ytAttributedStringHost, span[role='text'], span") ?? subhead;
  }

  function renderShortsSubheadAge(subhead, publishedAgoText) {
    const textElement = getShortsSubheadTextElement(subhead);
    let decoration = shortsSubheadDecorations.get(subhead);
    if (decoration && decoration.suffix.parentNode !== textElement) {
      removeShortsSubheadAge(subhead);
      decoration = undefined;
    }

    const nativeText = Array.from(textElement.childNodes)
      .filter((node) => node !== decoration?.suffix)
      .map((node) => node.textContent)
      .join("")
      .trim();
    if (!publishedAgoText || hasRelativePublishAge(nativeText)) {
      removeShortsSubheadAge(subhead);
      return;
    }

    const currentTitle = subhead.getAttribute("title");
    if (!decoration) {
      decoration = {
        suffix: document.createTextNode(""),
        originalTitle: currentTitle,
        appliedTitle: null,
      };
      shortsSubheadDecorations.set(subhead, decoration);
      subhead.setAttribute(SHORTS_AGE_ATTRIBUTE, "");
    } else if (currentTitle !== decoration.appliedTitle) {
      decoration.originalTitle = currentTitle;
    }

    const suffixText = nativeText ? ` • ${publishedAgoText}` : publishedAgoText;
    if (decoration.suffix.data !== suffixText) {
      decoration.suffix.data = suffixText;
    }
    if (decoration.suffix !== textElement.lastChild) {
      textElement.appendChild(decoration.suffix);
    }
    decoration.appliedTitle = nativeText + suffixText;
    if (currentTitle !== decoration.appliedTitle) {
      subhead.title = decoration.appliedTitle;
    }
  }

  function hasRelativePublishAge(text) {
    return /\b(?:second|minute|hour|day|week|month|year)s? ago\b|just now/i.test(text);
  }

  function shouldRenderShortsChannelName(pageScope) {
    return pageScope === "home" || pageScope === "subscriptions" || pageScope === "searchResults";
  }

  function enqueueShortsMetadataFetch(videoId) {
    if (shortsMetadataCache.has(videoId) || pendingShortsMetadataVideoIds.has(videoId)) {
      return;
    }

    pendingShortsMetadataVideoIds.add(videoId);
    shortsMetadataQueue.push(videoId);
    processShortsMetadataQueue();
  }

  function processShortsMetadataQueue() {
    while (
      activeShortsMetadataFetchCount < SHORTS_METADATA_FETCH_CONCURRENCY &&
      shortsMetadataQueue.length > 0
    ) {
      const videoId = shortsMetadataQueue.shift();
      activeShortsMetadataFetchCount += 1;

      fetchShortsMetadata(videoId)
        .then((metadata) => {
          shortsMetadataCache.set(videoId, metadata);
        })
        .catch((error) => {
          shortsMetadataCache.set(videoId, null);
          console.warn("Stop YouTube Reruns could not load Shorts metadata.", error);
        })
        .finally(() => {
          activeShortsMetadataFetchCount -= 1;
          pendingShortsMetadataVideoIds.delete(videoId);
          scheduleScan();
          processShortsMetadataQueue();
        });
    }
  }

  async function fetchShortsMetadata(videoId) {
    const config = getInnertubeClientConfig();
    const playerMetadata = config
      ? await fetchShortsMetadataFromPlayer(videoId, config).catch(() => null)
      : null;
    if (playerMetadata?.publishDate && playerMetadata.channelName &&
        playerMetadata.channelUrl && playerMetadata.durationSeconds) {
      return playerMetadata;
    }

    let pageMetadata;
    try {
      pageMetadata = await fetchShortsMetadataFromPage(videoId);
    } catch (error) {
      if (playerMetadata) {
        return playerMetadata;
      }
      throw error;
    }

    return {
      publishDate: playerMetadata?.publishDate ?? pageMetadata?.publishDate,
      channelName: playerMetadata?.channelName ?? pageMetadata?.channelName,
      channelUrl: playerMetadata?.channelUrl ?? pageMetadata?.channelUrl,
      durationSeconds: playerMetadata?.durationSeconds ?? pageMetadata?.durationSeconds,
    };
  }

  function getInnertubeClientConfig() {
    if (cachedInnertubeClientConfig) {
      return cachedInnertubeClientConfig;
    }

    const scriptsText = Array.from(document.scripts)
      .map((script) => script.textContent || "")
      .join("\n");
    const apiKey = extractQuotedConfigValue(scriptsText, "INNERTUBE_API_KEY");
    const clientVersion = extractQuotedConfigValue(scriptsText, "INNERTUBE_CLIENT_VERSION");

    if (!apiKey || !clientVersion) {
      return null;
    }

    cachedInnertubeClientConfig = {
      apiKey,
      clientVersion,
    };
    return cachedInnertubeClientConfig;
  }

  function extractQuotedConfigValue(text, key) {
    const marker = `"${key}":"`;
    const startIndex = text.indexOf(marker);
    if (startIndex < 0) {
      return null;
    }

    const valueStartIndex = startIndex + marker.length;
    const valueEndIndex = text.indexOf('"', valueStartIndex);
    return valueEndIndex > valueStartIndex ? text.slice(valueStartIndex, valueEndIndex) : null;
  }

  async function fetchShortsMetadataFromPlayer(videoId, config) {
    const response = await fetch(`/youtubei/v1/player?key=${encodeURIComponent(config.apiKey)}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: config.clientVersion,
          },
        },
        videoId,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const metadata = readShortsPlayerMetadata(await response.json(), videoId);
    return metadata && Object.values(metadata).some(Boolean) ? metadata : null;
  }

  function readShortsPlayerMetadata(response, videoId) {
    const details = response?.videoDetails;
    if (details?.videoId && details.videoId !== videoId) {
      return null;
    }

    const microformat = response?.microformat?.playerMicroformatRenderer;
    const publishDate = nonBlankString(microformat?.publishDate) ?? nonBlankString(microformat?.uploadDate);
    const channelName = nonBlankString(microformat?.ownerChannelName) ?? nonBlankString(details?.author);
    const channelUrl = getCreatorShortsUrl(microformat?.ownerProfileUrl, details?.channelId ?? microformat?.externalChannelId);
    const length = details?.lengthSeconds ?? microformat?.lengthSeconds;
    const seconds = typeof length === "number" || /^\d+$/.test(length) ? Number(length) : null;
    const durationSeconds = Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
    return { publishDate, channelName, channelUrl, durationSeconds };
  }

  function nonBlankString(value) {
    return typeof value === "string" ? value.trim() || null : null;
  }

  function getCreatorShortsUrl(profileUrl, channelId) {
    if (profileUrl) {
      try {
        const url = new URL(profileUrl, global.location.origin);
        const channelPath = url.pathname.match(/^\/(@[^/]+|channel\/UC[\w-]{22})\/?$/);
        if (url.hostname === "www.youtube.com" && /^https?:$/.test(url.protocol) && channelPath) {
          return `${global.location.origin}/${channelPath[1]}/shorts`;
        }
      } catch (_error) {
        // An invalid profile URL can still have a valid channel ID.
      }
    }

    return /^UC[\w-]{22}$/.test(channelId)
      ? `${global.location.origin}/channel/${channelId}/shorts`
      : null;
  }

  async function fetchShortsMetadataFromPage(videoId) {
    const response = await fetch(`/shorts/${encodeURIComponent(videoId)}`, {
      credentials: "same-origin",
    });

    if (!response.ok) {
      return null;
    }

    const pageHtml = await response.text();
    const metadata = readShortsPlayerMetadata(extractShortsPagePlayerResponse(pageHtml), videoId);
    if (!metadata) {
      return null;
    }

    const publishDate = metadata.publishDate ??
      extractJsonStringValue(pageHtml, "publishDate") ?? extractJsonStringValue(pageHtml, "uploadDate");
    const channelName = metadata.channelName ?? extractJsonStringValue(pageHtml, "ownerChannelName");
    return { ...metadata, channelName, publishDate };
  }

  function extractShortsPagePlayerResponse(pageHtml) {
    const assignment = /\bytInitialPlayerResponse\s*=\s*(?=\{)/.exec(pageHtml);
    if (!assignment) {
      return null;
    }

    const start = assignment.index + assignment[0].length;
    const end = pageHtml.indexOf("</script>", start);
    const script = pageHtml.slice(start, end === -1 ? undefined : end);
    let depth = 0;
    // Match each quoted string as one token so braces in video text are ignored.
    for (const token of script.matchAll(/"(?:[^"\\]|\\.)*"|[{}]/g)) {
      if (token[0] === "{") {
        depth += 1;
      } else if (token[0] === "}" && --depth === 0) {
        try {
          return JSON.parse(script.slice(0, token.index + 1));
        } catch (_error) {
          return null;
        }
      }
    }
    return null;
  }

  function extractJsonStringValue(text, key) {
    const pattern = new RegExp(String.raw`"${key}"\s*:\s*("(?:[^"\\]|\\.)*")`, "g");
    for (const match of text.matchAll(pattern)) {
      const value = nonBlankString(decodeJsonStringValue(match[1].slice(1, -1)));
      if (value) {
        return value;
      }
    }

    const markers = [`"${key}":"`, `\\"${key}\\":\\"`];

    for (const marker of markers) {
      const endMarker = marker.startsWith("\\") ? '\\"' : '"';
      let startIndex = text.indexOf(marker);
      while (startIndex !== -1) {
        const valueStartIndex = startIndex + marker.length;
        const valueEndIndex = text.indexOf(endMarker, valueStartIndex);
        if (valueEndIndex === -1) {
          break;
        }
        const value = nonBlankString(decodeJsonStringValue(text.slice(valueStartIndex, valueEndIndex)));
        if (value) {
          return value;
        }
        startIndex = text.indexOf(marker, valueEndIndex + endMarker.length);
      }
    }

    return null;
  }

  function decodeJsonStringValue(value) {
    try {
      return JSON.parse(`"${value}"`);
    } catch (_error) {
      return value;
    }
  }

  function formatShortsPublishedAgo(publishDate) {
    if (!publishDate) {
      return null;
    }

    const date = new Date(publishDate);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const elapsedMs = Math.max(0, Date.now() - date.getTime());
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const units = [
      ["year", 365 * 24 * 60 * 60],
      ["month", 30 * 24 * 60 * 60],
      ["week", 7 * 24 * 60 * 60],
      ["day", 24 * 60 * 60],
      ["hour", 60 * 60],
      ["minute", 60],
    ];

    for (const [unit, secondsPerUnit] of units) {
      if (elapsedSeconds >= secondsPerUnit) {
        const value = Math.floor(elapsedSeconds / secondsPerUnit);
        return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
      }
    }

    return "1 minute ago";
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
      clearAllShortsMetadataState();
    }

    syncShortsMetadata(activeSettings, pageScope);

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
    if (scanTimerId === null) {
      scanTimerId = global.setTimeout(scanPage, 100);
    }
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

    global.addEventListener("scroll", scheduleScan, { passive: true });
    global.addEventListener("resize", scheduleScan, { passive: true });
    document.addEventListener("click", scheduleScan, { passive: true });
  }

  function attachMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const { type, target, attributeName } = mutation;
        if (type === "childList" ||
            (type === "characterData" && target.parentElement?.closest(`[${SHORTS_AGE_ATTRIBUTE}]`)) ||
            (type === "attributes" && (
              (attributeName === "style" && target.matches(WATCHED_SEGMENT_SELECTOR)) ||
              (attributeName === "href" && target.closest(SHORTS_ROOT_SELECTOR + ", " + ROOT_SELECTOR)) ||
              target.matches("ytd-playlist-panel-video-renderer")
            ))) {
          scheduleScan();
          return;
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "href", "selected", "current", "aria-current"],
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
