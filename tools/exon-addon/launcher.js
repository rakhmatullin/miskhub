const toolPage = chrome.runtime.getURL("popup.html");
const publishedPage = "https://rakhmatullin.github.io/miskhub/exon.html";

async function openTool() {
  await chrome.tabs.create({url: toolPage});
}

chrome.action.onClicked.addListener(() => { openTool().catch(console.warn); });
chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (!sender.url || (sender.frameId != null && sender.frameId !== 0)) return;
  const url = new URL(sender.url);
  if (url.origin + url.pathname !== publishedPage) return;
  if (message?.type === "exon-open") {
    openTool().then(() => respond({ready: true}), () => respond({ready: false}));
    return true;
  }
});
