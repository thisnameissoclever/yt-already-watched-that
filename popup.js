(function initPopup(global) {
  const { readSettings, writeSettings } = global.YAWTSettings;
  const DEFAULT_PAGE_STATUS = Object.freeze({
    supported: false,
    hiddenCount: 0,
    revealActive: false,
    pageScope: "unsupported",
  });

  const enabledGloballyInput = document.getElementById("enabledGlobally");
  const thresholdInput = document.getElementById("thresholdPercent");
  const thresholdValue = document.getElementById("thresholdValue");
  const pageStatus = document.getElementById("pageStatus");
  const openOptionsButton = document.getElementById("openOptions");
  const revealHiddenButton = document.getElementById("revealHidden");

  function renderThreshold(value) {
    thresholdInput.value = String(value);
    thresholdValue.textContent = `${value}%`;
  }

  function renderPageStatus(status) {
    if (!status.supported) {
      pageStatus.textContent = "This page is not currently filterable.";
      revealHiddenButton.disabled = true;
      revealHiddenButton.textContent = "Show hidden videos for this page";
      return;
    }

    if (status.revealActive) {
      pageStatus.textContent = "No watched videos hidden on this page.";
      revealHiddenButton.disabled = true;
      revealHiddenButton.textContent = "Hidden videos shown until refresh";
      return;
    }

    if (status.hiddenCount > 0) {
      const label = status.hiddenCount === 1 ? "1 watched video hidden on this page." : `${status.hiddenCount} watched videos hidden on this page.`;
      pageStatus.textContent = label;
      revealHiddenButton.disabled = false;
      revealHiddenButton.textContent = "Show hidden videos for this page";
      return;
    }

    pageStatus.textContent = "No watched videos hidden on this page.";
    revealHiddenButton.disabled = true;
    revealHiddenButton.textContent = "Show hidden videos for this page";
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    return tab ?? null;
  }

  async function readPageStatus() {
    const tab = await getActiveTab();

    if (!tab?.id) {
      return DEFAULT_PAGE_STATUS;
    }

    try {
      return await chrome.tabs.sendMessage(tab.id, { type: "yawt:getPageStatus" });
    } catch (_error) {
      return DEFAULT_PAGE_STATUS;
    }
  }

  async function refreshPageStatus() {
    renderPageStatus(await readPageStatus());
  }

  async function handleThresholdInput(event) {
    const thresholdPercent = Number(event.target.value);
    renderThreshold(thresholdPercent);
    await writeSettings({ thresholdPercent });
    global.setTimeout(refreshPageStatus, 150);
  }

  async function init() {
    const settings = await readSettings();
    enabledGloballyInput.checked = settings.enabledGlobally;
    renderThreshold(settings.thresholdPercent);
    await refreshPageStatus();

    enabledGloballyInput.addEventListener("change", async (event) => {
      await writeSettings({ enabledGlobally: event.target.checked });
      global.setTimeout(refreshPageStatus, 150);
    });
    thresholdInput.addEventListener("input", handleThresholdInput);
    openOptionsButton.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
    revealHiddenButton.addEventListener("click", async () => {
      const tab = await getActiveTab();

      if (!tab?.id) {
        renderPageStatus(DEFAULT_PAGE_STATUS);
        return;
      }

      try {
        const status = await chrome.tabs.sendMessage(tab.id, { type: "yawt:revealCurrentPage" });
        renderPageStatus(status ?? DEFAULT_PAGE_STATUS);
      } catch (_error) {
        renderPageStatus(DEFAULT_PAGE_STATUS);
      }
    });
  }

  init().catch((error) => {
    console.error("Failed to initialize popup.", error);
  });
})(globalThis);
