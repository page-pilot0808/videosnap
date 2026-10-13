```javascript
const input = document.getElementById("videoUrl");
const message = document.getElementById("message");
const result = document.getElementById("result");
const getButton = document.getElementById("getVideo");
const downloadButton = document.getElementById("downloadBtn");
const qualitySelect = document.getElementById("quality");

let currentVideoUrl = "";
let busy = false;

// Progress UI
const style = document.createElement("style");
style.textContent = `
.progress-wrap {
  display: none;
  margin-top: 16px;
  padding: 15px;
  border: 1px solid #e3e8f3;
  border-radius: 14px;
  background: #fff;
}
.progress-wrap.show { display: block; }
.progress-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-size: .88rem;
  font-weight: 750;
}
.progress-track {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: #e7ebf7;
}
.progress-fill {
  height: 100%;
  width: 0%;
  border-radius: 999px;
  background: linear-gradient(90deg, #3867f5, #7c3aed);
  transition: width .15s ease;
}
.progress-fill.indeterminate {
  width: 35%;
  animation: videosnap-slide 1.1s ease-in-out infinite alternate;
}
@keyframes videosnap-slide {
  from { transform: translateX(0); }
  to { transform: translateX(185%); }
}
.progress-note {
  margin: 9px 0 0;
  color: #667085;
  font-size: .8rem;
  line-height: 1.5;
}
button:disabled {
  opacity: .65;
  cursor: wait;
  transform: none;
}
`;
document.head.appendChild(style);

const progressWrap = document.createElement("div");
progressWrap.className = "progress-wrap";
progressWrap.setAttribute("role", "status");
progressWrap.setAttribute("aria-live", "polite");
progressWrap.innerHTML = `
  <div class="progress-top">
    <span id="progressLabel">Preparing video...</span>
    <span id="progressPercent">Please wait</span>
  </div>
  <div class="progress-track">
    <div class="progress-fill indeterminate" id="progressFill"></div>
  </div>
  <p class="progress-note" id="progressNote">
    Please keep this page open.
  </p>
`;
message.after(progressWrap);

const progressLabel = document.getElementById("progressLabel");
const progressPercent = document.getElementById("progressPercent");
const progressFill = document.getElementById("progressFill");
const progressNote = document.getElementById("progressNote");

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.add("show");
  message.style.border = isError
    ? "1px solid #dc6262"
    : "1px solid transparent";
}

function clearMessage() {
  message.textContent = "";
  message.classList.remove("show");
  message.style.border = "0";
}

function setBusy(value) {
  busy = value;
  getButton.disabled = value;
  downloadButton.disabled = value;
  getButton.textContent = value ? "Please wait..." : "Get Video ↗";
}

function showProgress(label, percent = null, note = "") {
  progressWrap.classList.add("show");
  progressLabel.textContent = label;
  progressNote.textContent = note;

  if (percent === null) {
    progressPercent.textContent = "Working...";
    progressFill.classList.add("indeterminate");
    progressFill.style.width = "35%";
  } else {
    const safePercent = Math.max(0, Math.min(100, percent));
    progressPercent.textContent = `${safePercent}%`;
    progressFill.classList.remove("indeterminate");
    progressFill.style.width = `${safePercent}%`;
  }
}

function hideProgress() {
  progressWrap.classList.remove("show");
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${mins}:${secs}`;
}

async function postJson(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || `Request failed (${response.status}). Please try again.`
    );
  }

  return data;
}

function isFacebookUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");

    return ["http:", "https:"].includes(url.protocol) &&
      (
        host === "facebook.com" ||
        host.endsWith(".facebook.com") ||
        host === "fb.watch"
      );
  } catch {
    return false;
  }
}

async function getVideo() {
  if (busy) return;

  const url = input.value.trim();
  clearMessage();
  hideProgress();
  result.hidden = true;
  currentVideoUrl = "";

  if (!url) {
    showMessage("Paste a Facebook video link first.", true);
    input.focus();
    return;
  }

  if (!isFacebookUrl(url)) {
    showMessage(
      "Please enter a valid Facebook video link from facebook.com or fb.watch.",
      true
    );
    return;
  }

  setBusy(true);
  showProgress(
    "Checking video link...",
    null,
    "The server is checking the video. This may take a little while."
  );

  try {
    const data = await postJson("/api/info", { url });

    currentVideoUrl = url;

    document.getElementById("videoTitle").textContent =
      data.title || "Facebook video";

    const metadata = [];

    if (data.uploader) metadata.push(data.uploader);

    const duration = formatDuration(data.duration);
    if (duration) metadata.push(duration);

    metadata.push(
      `${(data.qualityOptions || []).length} quality option(s)`
    );

    document.getElementById("videoMeta").textContent =
      metadata.join(" · ");

    const thumb = document.getElementById("thumb");
    thumb.replaceChildren();

    if (data.thumbnail) {
      const img = document.createElement("img");
      img.src = data.thumbnail;
      img.alt = "Video thumbnail";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => {
        thumb.textContent = "▶";
      };
      thumb.appendChild(img);
    } else {
      thumb.textContent = "▶";
    }

    qualitySelect.replaceChildren();

    const options = data.qualityOptions?.length
      ? data.qualityOptions
      : [{ value: "best", label: "Best available quality" }];

    for (const option of options) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      qualitySelect.appendChild(element);
    }

    result.hidden = false;
    hideProgress();
    showMessage("Video found! Choose a quality and click Download Video.");
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });

  } catch (error) {
    hideProgress();
    showMessage(error.message || "Could not check this video.", true);
  } finally {
    setBusy(false);
  }
}

async function downloadVideo() {
  if (busy) return;

  if (!currentVideoUrl) {
    showMessage("Check a video link first.", true);
    return;
  }

  clearMessage();
  setBusy(true);

  showProgress(
    "Preparing your video...",
    null,
    "The server is preparing the file. Actual percentage may not be available yet."
  );

  try {
    const response = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: currentVideoUrl,
        quality: qualitySelect.value
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(
        data.error || `Download failed (${response.status}).`
      );
    }

    if (!response.body) {
      throw new Error(
        "Your browser cannot show download progress. Please try another browser."
      );
    }

    const totalBytes = Number(response.headers.get("Content-Length")) || 0;
    const reader = response.body.getReader();
    const chunks = [];
    let receivedBytes = 0;

    showProgress(
      "Downloading video...",
      0,
      totalBytes
        ? "Receiving the video file."
        : "Receiving the video file. The server did not provide its total size."
    );

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      chunks.push(value);
      receivedBytes += value.byteLength;

      if (totalBytes > 0) {
        const percent = Math.min(
          100,
          Math.floor((receivedBytes / totalBytes) * 100)
        );

        showProgress(
          "Downloading video...",
          percent,
          `${(receivedBytes / 1048576).toFixed(2)} MB received of ${(totalBytes / 1048576).toFixed(2)} MB`
        );
      } else {
        showProgress(
          "Downloading video...",
          null,
          `${(receivedBytes / 1048576).toFixed(2)} MB received`
        );
      }
    }

    if (receivedBytes === 0) {
      throw new Error("The server returned an empty video file.");
    }

    const contentType =
      response.headers.get("Content-Type") || "video/mp4";

    const blob = new Blob(chunks, { type: contentType });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = objectUrl;
    anchor.download = "videosnap-video.mp4";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);

    showProgress(
      "Download ready!",
      100,
      "The video has been received. Your browser should now save the file."
    );

    showMessage("Your video is ready. Check your browser's downloads.");

  } catch (error) {
    hideProgress();
    showMessage(
      error.message || "Download failed. Please try again.",
      true
    );
  } finally {
    setBusy(false);
  }
}

getButton.addEventListener("click", getVideo);

input.addEventListener("keydown", event => {
  if (event.key === "Enter") getVideo();
});

downloadButton.addEventListener("click", downloadVideo);
```
