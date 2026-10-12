const input = document.getElementById("videoUrl");
const message = document.getElementById("message");
const result = document.getElementById("result");
const getButton = document.getElementById("getVideo");
const downloadButton = document.getElementById("downloadBtn");
const qualitySelect = document.getElementById("quality");

let currentVideoUrl = "";
let busy = false;

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.add("show");
  message.style.border = isError ? "1px solid #dc6262" : "1px solid transparent";
}
function clearMessage() {
  message.classList.remove("show");
  message.style.border = "0";
}
function setBusy(value) {
  busy = value;
  getButton.disabled = value;
  getButton.textContent = value ? "Checking…" : "Get Video ↗";
  downloadButton.disabled = value;
}
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}
async function postJson(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
function isFacebookUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return ["http:", "https:"].includes(url.protocol) &&
      (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch");
  } catch { return false; }
}
async function getVideo() {
  if (busy) return;
  const url = input.value.trim();
  clearMessage();
  result.hidden = true;
  if (!url) {
    showMessage("Paste a Facebook video link first 🙂", true);
    input.focus();
    return;
  }
  if (!isFacebookUrl(url)) {
    showMessage("Please enter a Facebook video link from facebook.com or fb.watch.", true);
    return;
  }

  setBusy(true);
  showMessage("Checking the video link… this can take a few seconds.");
  try {
    const data = await postJson("/api/info", { url });
    currentVideoUrl = url;
    document.getElementById("videoTitle").textContent = data.title || "Facebook video";
    const metadata = [];
    if (data.uploader) metadata.push(data.uploader);
    const duration = formatDuration(data.duration);
    if (duration) metadata.push(duration);
    metadata.push(`${(data.qualityOptions || []).length} quality option(s)`);
    document.getElementById("videoMeta").textContent = metadata.join(" · ");

    const thumb = document.getElementById("thumb");
    thumb.replaceChildren();
    if (data.thumbnail) {
      const img = document.createElement("img");
      img.src = data.thumbnail;
      img.alt = "Video thumbnail";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => { thumb.textContent = "▶"; };
      thumb.appendChild(img);
    } else {
      thumb.textContent = "▶";
    }

    qualitySelect.replaceChildren();
    for (const option of (data.qualityOptions || [{ value: "best", label: "Best available quality" }])) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      qualitySelect.appendChild(element);
    }
    result.hidden = false;
    showMessage("Video found! Choose a quality and click Download Video.");
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}
async function downloadVideo() {
  if (busy || !currentVideoUrl) {
    showMessage("Check a video link first.", true);
    return;
  }
  setBusy(true);
  showMessage("Preparing your video… please keep this page open.");
  try {
    const response = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: currentVideoUrl, quality: qualitySelect.value })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Download failed. Please try another link.");
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = "videosnap-video.mp4";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    showMessage("Your download should start now. Enjoy! 🎉");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}

getButton.addEventListener("click", getVideo);
input.addEventListener("keydown", event => { if (event.key === "Enter") getVideo(); });
downloadButton.addEventListener("click", downloadVideo);
