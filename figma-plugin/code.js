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

figma.showUI(__html__, { width: 380, height: 640, themeColors: true });

/**
 * What is selected right now, for clipboard capture to attach a buffer to.
 *
 * The designer copies a frame and pastes into the plugin, so whatever they
 * copied is still selected when the paste lands. That pairing is what saves
 * them from having to identify the screen by hand.
 *
 * `isScreenFrame` mirrors `findScreenFrames` server-side: only a FRAME that is
 * a direct child of a page is a documented screen. It is also what gates the
 * "Publish selected screen" button, and the only place that check can be made:
 * the REST API returns a node fetched by id without its ancestors, so the
 * server cannot re-derive parentage from the id alone.
 */
function selectionInfo() {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) return null;

  const node = selection[0];
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    isScreenFrame: node.type === "FRAME" && node.parent.type === "PAGE",
  };
}

/**
 * The page being looked at, which is the unit that gets published.
 *
 * A file is a product stream and runs to hundreds of frames; a page is one
 * flow. The id is what the server keys the flow on — names change, and a
 * renamed page must move its screens rather than orphan them — and it is
 * unreachable server-side, since `/v1/files/:key/nodes` returns a subtree
 * without its ancestors.
 */
function pageInfo() {
  return { id: figma.currentPage.id, name: figma.currentPage.name };
}

function postContext() {
  figma.ui.postMessage({
    type: "context",
    page: pageInfo(),
    selection: selectionInfo(),
  });
}

async function boot() {
  const token = await figma.clientStorage.getAsync(STORAGE_KEY);

  figma.ui.postMessage({
    type: "init",
    token: token || null,
    // Undefined unless this runs as a private plugin with
    // `enablePrivatePluginApi`. The UI explains that rather than failing oddly.
    fileKey: figma.fileKey || null,
    fileName: figma.root.name,
    page: pageInfo(),
    selection: selectionInfo(),
  });
}

boot();

figma.on("selectionchange", postContext);
// Switching page changes what Publish would publish, so the panel has to say
// so the moment it happens — otherwise the button quietly means something else
// than it did a second ago.
figma.on("currentpagechange", postContext);

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

    // Jump to the next frame the worklist wants captured, so the designer
    // never has to hunt for it. The keystrokes still have to be theirs — no
    // plugin API can press ⌘C — but finding the frame does not.
    case "select-node": {
      // Required before reaching a node on a page that is not open, which is
      // the normal case here: a documentation file has many pages.
      await figma.loadAllPagesAsync();

      const node = await figma.getNodeByIdAsync(message.nodeId);
      if (!node) {
        figma.ui.postMessage({ type: "select-failed", nodeId: message.nodeId });
        break;
      }

      let page = node;
      while (page && page.type !== "PAGE") page = page.parent;
      if (page && page !== figma.currentPage) {
        await figma.setCurrentPageAsync(page);
      }

      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);
      break;
    }

    case "notify":
      figma.notify(message.message, { error: Boolean(message.error) });
      break;

    case "close":
      figma.closePlugin();
      break;
  }
};
