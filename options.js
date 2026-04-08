(function initOptions(global) {
  const { readSettings, writeSettings } = global.YAWTSettings;

  const thresholdInput = document.getElementById("thresholdPercent");
  const thresholdValue = document.getElementById("thresholdValue");

  const toggleIds = [
    "enabledOnVideoPage",
    "enabledOnSubscriptions",
    "enabledOnHome",
    "enabledOnPlaylistPage",
    "enabledOnWatchPlaylist",
  ];

  function render(settings) {
    thresholdInput.value = String(settings.thresholdPercent);
    thresholdValue.textContent = `${settings.thresholdPercent}%`;

    for (const toggleId of toggleIds) {
      const element = document.getElementById(toggleId);
      element.checked = Boolean(settings[toggleId]);
    }
  }

  async function init() {
    render(await readSettings());

    thresholdInput.addEventListener("input", async (event) => {
      const thresholdPercent = Number(event.target.value);
      thresholdValue.textContent = `${thresholdPercent}%`;
      await writeSettings({ thresholdPercent });
    });

    for (const toggleId of toggleIds) {
      const element = document.getElementById(toggleId);
      element.addEventListener("change", async (event) => {
        await writeSettings({ [toggleId]: event.target.checked });
      });
    }
  }

  init().catch((error) => {
    console.error("Failed to initialize options page.", error);
  });
})(globalThis);
