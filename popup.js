(function initPopup(global) {
  const { readSettings, writeSettings } = global.YAWTSettings;

  const thresholdInput = document.getElementById("thresholdPercent");
  const thresholdValue = document.getElementById("thresholdValue");
  const openOptionsButton = document.getElementById("openOptions");

  function renderThreshold(value) {
    thresholdInput.value = String(value);
    thresholdValue.textContent = `${value}%`;
  }

  async function handleThresholdInput(event) {
    const thresholdPercent = Number(event.target.value);
    renderThreshold(thresholdPercent);
    await writeSettings({ thresholdPercent });
  }

  async function init() {
    const settings = await readSettings();
    renderThreshold(settings.thresholdPercent);

    thresholdInput.addEventListener("input", handleThresholdInput);
    openOptionsButton.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
  }

  init().catch((error) => {
    console.error("Failed to initialize popup.", error);
  });
})(globalThis);
