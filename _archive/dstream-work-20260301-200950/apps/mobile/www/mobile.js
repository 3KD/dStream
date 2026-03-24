const APP_CONFIG_KEY = "dstream_mobile_config_v1";
const DEFAULT_EDGE_URL = "";
const DEFAULT_EDGE_URL_HINT = "https://your-node.example";
const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol"];
const FALLBACK_STORAGE_LABEL = "Browser localStorage (fallback)";
const SECURE_STORAGE_LABEL = "Capacitor Preferences (native)";

const state = {
  config: null,
  mode: "edit",
  secureStorage: null
};

function parseRelayList(raw) {
  const source = Array.isArray(raw) ? raw.join(",") : String(raw || "");
  const input = source.trim();
  if (!input) return [];
  return Array.from(
    new Set(
      input
        .split(/[\n,]+/g)
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((value) => /^wss?:\/\//i.test(value))
    )
  );
}

function normalizeEdgeUrl(raw) {
  try {
    const parsed = new URL(String(raw || "").trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

async function resolveSecureStorage() {
  if (state.secureStorage !== null) return state.secureStorage;
  const preferences = window.Capacitor?.Plugins?.Preferences;
  if (!preferences || typeof preferences.get !== "function" || typeof preferences.set !== "function") {
    state.secureStorage = false;
    return state.secureStorage;
  }
  try {
    await preferences.get({ key: "__dstream_storage_probe_v1" });
    state.secureStorage = true;
    return state.secureStorage;
  } catch {
    state.secureStorage = false;
    return state.secureStorage;
  }
}

async function readStorageRaw(key) {
  if (await resolveSecureStorage()) {
    const result = await window.Capacitor.Plugins.Preferences.get({ key });
    return typeof result?.value === "string" ? result.value : null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function writeStorageRaw(key, value) {
  if (await resolveSecureStorage()) {
    await window.Capacitor.Plugins.Preferences.set({ key, value });
    return;
  }
  window.localStorage.setItem(key, value);
}

async function removeStorageRaw(key) {
  if (await resolveSecureStorage()) {
    await window.Capacitor.Plugins.Preferences.remove({ key });
    return;
  }
  window.localStorage.removeItem(key);
}

async function readConfig() {
  try {
    const raw = await readStorageRaw(APP_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const edgeUrl = normalizeEdgeUrl(parsed?.edgeUrl);
    const relays = parseRelayList(parsed?.relays);
    if (!edgeUrl || relays.length === 0) return null;
    return { edgeUrl, relays };
  } catch {
    return null;
  }
}

async function writeConfig(config) {
  await writeStorageRaw(APP_CONFIG_KEY, JSON.stringify(config));
}

async function clearConfig() {
  await removeStorageRaw(APP_CONFIG_KEY);
}

function storageLabel() {
  if (state.secureStorage === true) return SECURE_STORAGE_LABEL;
  return FALLBACK_STORAGE_LABEL;
}

function buildBootstrapUrl(config) {
  const bootstrap = new URL("/mobile/bootstrap", config.edgeUrl);
  bootstrap.searchParams.set("relays", config.relays.join(","));
  bootstrap.searchParams.set("next", "/");
  bootstrap.searchParams.set("source", "mobile-shell");
  return bootstrap.toString();
}

function showError(message) {
  const el = document.getElementById("error");
  if (!el) return;
  el.textContent = message || "";
}

function setFormValues(config) {
  const edgeInput = document.getElementById("edge-url");
  const relaysInput = document.getElementById("relay-list");
  if (edgeInput) edgeInput.value = config?.edgeUrl || DEFAULT_EDGE_URL;
  if (edgeInput) edgeInput.placeholder = DEFAULT_EDGE_URL_HINT;
  if (relaysInput) relaysInput.value = (config?.relays || DEFAULT_RELAYS).join("\n");
}

function setSavedConfig(config) {
  const remember = document.getElementById("saved-config");
  if (!remember) return;
  if (!config) {
    remember.textContent = "none";
    return;
  }
  remember.textContent = `${config.edgeUrl} (${config.relays.length} relays)`;
}

function setStorageMode() {
  const el = document.getElementById("storage-mode");
  if (!el) return;
  el.textContent = storageLabel();
}

function setMode(mode) {
  state.mode = mode;
  const hasConfig = !!state.config;
  const savedPanel = document.getElementById("saved-panel");
  const setupForm = document.getElementById("setup-form");
  const cancelEdit = document.getElementById("cancel-edit");

  const showEditor = !hasConfig || mode === "edit";
  if (savedPanel) savedPanel.hidden = !hasConfig;
  if (setupForm) setupForm.hidden = !showEditor;
  if (cancelEdit) cancelEdit.hidden = !hasConfig || mode !== "edit";
}

function readFormConfig() {
  const edgeInput = document.getElementById("edge-url");
  const relaysInput = document.getElementById("relay-list");
  const edgeUrl = normalizeEdgeUrl(edgeInput?.value);
  const relays = parseRelayList(relaysInput?.value);
  if (!edgeUrl) {
    showError("Enter a valid edge node URL (https://your-node.example).");
    return null;
  }
  if (relays.length === 0) {
    showError("Enter at least one relay URL (ws:// or wss://).");
    return null;
  }
  return { edgeUrl, relays };
}

function launch(config) {
  window.location.replace(buildBootstrapUrl(config));
}

async function persistConfig(config) {
  await writeConfig(config);
  state.config = config;
  setSavedConfig(config);
  setMode("saved");
}

function bindHandlers() {
  const form = document.getElementById("setup-form");
  const launchButton = document.getElementById("launch-existing");
  const editButton = document.getElementById("edit-config");
  const saveOnlyButton = document.getElementById("save-only");
  const cancelButton = document.getElementById("cancel-edit");
  const resetButton = document.getElementById("reset-config");

  if (launchButton) {
    launchButton.addEventListener("click", async () => {
      const config = await readConfig();
      if (!config) {
        showError("No saved configuration found.");
        return;
      }
      launch(config);
    });
  }

  if (editButton) {
    editButton.addEventListener("click", () => {
      showError("");
      setFormValues(state.config);
      setMode("edit");
    });
  }

  if (saveOnlyButton) {
    saveOnlyButton.addEventListener("click", async () => {
      showError("");
      const config = readFormConfig();
      if (!config) return;
      await persistConfig(config);
    });
  }

  if (cancelButton) {
    cancelButton.addEventListener("click", () => {
      showError("");
      setFormValues(state.config);
      setMode("saved");
    });
  }

  if (resetButton) {
    resetButton.addEventListener("click", async () => {
      showError("");
      await clearConfig();
      state.config = null;
      setSavedConfig(null);
      setFormValues(null);
      setMode("edit");
    });
  }

  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");
    const config = readFormConfig();
    if (!config) return;
    await persistConfig(config);
    launch(config);
  });
}

async function main() {
  await resolveSecureStorage();
  setStorageMode();
  state.config = await readConfig();
  setSavedConfig(state.config);
  setFormValues(state.config);
  setMode(state.config ? "saved" : "edit");
  bindHandlers();
}

void main();
