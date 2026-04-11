(function initOptions(global) {
  const { readSettings, writeSettings } = global.YAWTSettings;

  const enabledGloballyInput = document.getElementById("enabledGlobally");
  const thresholdInput = document.getElementById("thresholdPercent");
  const thresholdValue = document.getElementById("thresholdValue");

  const toggleIds = [
    "enabledOnVideoPage",
    "enabledOnWatchPagePlaylist",
    "enabledOnSearchResults",
    "enabledOnChannelVideos",
    "enabledOnSubscriptions",
    "enabledOnHome",
    "enabledOnPlaylistPage",
  ];

  function render(settings) {
    enabledGloballyInput.checked = Boolean(settings.enabledGlobally);
    thresholdInput.value = String(settings.thresholdPercent);
    thresholdValue.textContent = `${settings.thresholdPercent}%`;

    for (const toggleId of toggleIds) {
      const element = document.getElementById(toggleId);
      element.checked = Boolean(settings[toggleId]);
    }
  }

  async function init() {
    render(await readSettings());

    enabledGloballyInput.addEventListener("change", async (event) => {
      await writeSettings({ enabledGlobally: event.target.checked });
    });

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
