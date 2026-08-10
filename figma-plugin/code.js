/**
 * Main-thread half of the publish plugin.
 *
 * Plain JavaScript on purpose: the plugin sandbox is a different environment
 * from the Next.js app (different globals, different typings), so giving it a
 * build step and a second tsconfig would cost more than it returns for ~60
 * lines. It is loaded directly by `manifest.json`.
 *
 * Division of labour with `ui.html`: everything that needs the Figma API lives
 * here, and everything that needs the network or `crypto` lives there. The
 * plugin sandbox has no `fetch` — only the UI iframe does.
 */

const STORAGE_KEY = "syncToken";

figma.showUI(__html__, { width: 380, height: 268, themeColors: true });

async function boot() {
  const token = await figma.clientStorage.getAsync(STORAGE_KEY);

  figma.ui.postMessage({
    type: "init",
    token: token || null,
    // Undefined unless this runs as a private plugin with
    // `enablePrivatePluginApi`. The UI explains that rather than failing oddly.
    fileKey: figma.fileKey || null,
    fileName: figma.root.name,
  });
}

boot();

figma.ui.onmessage = async (message) => {
  switch (message.type) {
    case "open-pairing":
      figma.openExternal(message.url);
      break;

    case "save-token":
      await figma.clientStorage.setAsync(STORAGE_KEY, message.token);
      break;

    case "forget-token":
      await figma.clientStorage.deleteAsync(STORAGE_KEY);
      break;

    case "notify":
      figma.notify(message.message, { error: Boolean(message.error) });
      break;

    case "close":
      figma.closePlugin();
      break;
  }
};
