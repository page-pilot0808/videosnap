
"use strict";

const input = document.getElementById("videoUrl");
const message = document.getElementById("message");
const result = document.getElementById("result");
const getButton = document.getElementById("getVideo");
const downloadButton = document.getElementById("downloadBtn");
const qualitySelect = document.getElementById("quality");

let currentVideoUrl = "";
let busy = false;
let activeObjectUrl = null;

if (
  !input ||
  !message ||
  !result ||
  !getButton ||
  !downloadButton ||
  !qualitySelect
) {
  console.error(
    "VideoSnap: Required HTML elements are missing. Check public/index.html IDs."
  );
} else {
  initializeVideoSnap();
}

function initializeVideoSnap() {
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

    .progress-wrap.show {
      display: block;
    }

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
      overflow-wrap: anywhere;
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

  message.insertAdjacentElement("afterend", progressWrap);

  const progressLabel = progressWrap.querySelector("#progressLabel");
  const progressPercent = progressWrap.querySelector("#progressPercent");
  const progressFill = progressWrap.querySelector("#progressFill");
  const progressNote = progressWrap.querySelector("#progressNote");

  // Show messages and bold only the successful video-found message.
  function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.add("show");

    message.style.fontWeight =
      text.startsWith("Video found!") ? "700" : "400";

    message.style.border = isError
      ? "1px solid #dc6262"
      : "1px solid transparent";
  }

  function clearMessage() {
    message.textContent = "";
    message.classList.remove("show");
    message.style.border = "0";
    message.style.fontWeight = "400";
  }

  function showProgress(label, percent = null, note = "") {
    progressWrap.classList.add("show");
    progressLabel.textContent = label;
    progressNote.textContent = note;

    if (percent === null) {
      progressPercent.textContent = "Working...";
      progressFill.classList.add("indeterminate");
      progressFill.style.width = "35%";
      return;
    }

    const safePercent = Math.max(0, Math.min(100, percent));

    progressPercent.textContent = `${safePercent}%`;
    progressFill.classList.remove("indeterminate");
    progressFill.style.width = `${safePercent}%`;
  }

  function hideProgress() {
    progressWrap.classList.remove("show");
  }

  function setBusy(value) {
    busy = value;
    getButton.disabled = value;
    downloadButton.disabled = value;
    getButton.textContent = value ? "Please wait..." : "Get Video ↗";
  }

  function formatDuration(seconds) {
    const value = Number(seconds);

    if (!Number.isFinite(value) || value <= 0) {
      return "";
    }

    const minutes = Math.floor(value / 60);
    const remainingSeconds = Math.floor(value % 60)
      .toString()
      .padStart(2, "0");

    return `${minutes}:${remainingSeconds}`;
  }

  function isFacebookUrl(value) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");

      const validHost =
        host === "facebook.com" ||
        host.endsWith(".facebook.com") ||
        host === "fb.watch";

      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        validHost
      );
    } catch {
      return false;
    }
  }

  async function readJson(response) {
    return response.json().catch(() => ({}));
  }

  async function postJson(endpoint, payload) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await readJson(response);

    if (!response.ok) {
      throw new Error(
        data.error ||
        `Request failed (${response.status}). Please try again.`
      );
    }

    return data;
  }

  function resetResult() {
    result.hidden = true;
    result.classList.remove("show");
    currentVideoUrl = "";
    qualitySelect.replaceChildren();
  }

  function setTextIfPresent(id, value) {
    const element = document.getElementById(id);

    if (element) {
      element.textContent = value;
    }
  }

  function displayThumbnail(url) {
    const thumb = document.getElementById("thumb");

    if (!thumb) {
      return;
    }

    thumb.replaceChildren();

    if (!url) {
      thumb.textContent = "▶";
      return;
    }

    try {
      const parsed = new URL(url);

      if (
        parsed.protocol !== "https:" &&
        parsed.protocol !== "http:"
      ) {
        thumb.textContent = "▶";
        return;
      }

      const img = document.createElement("img");
      img.src = parsed.href;
      img.alt = "Video thumbnail";
      img.referrerPolicy = "no-referrer";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";

      img.onerror = () => {
        thumb.replaceChildren();
        thumb.textContent = "▶";
      };

      thumb.appendChild(img);
    } catch {
      thumb.textContent = "▶";
    }
  }

  function displayQualityOptions(options) {
    qualitySelect.replaceChildren();

    const validOptions = Array.isArray(options)
      ? options.filter(option =>
          option &&
          typeof option.value === "string" &&
          option.value.length > 0
        )
      : [];

    if (validOptions.length === 0) {
      const option = document.createElement("option");
      option.value = "best";
      option.textContent = "Best available quality";
      qualitySelect.appendChild(option);
      return;
    }

    validOptions.forEach(item => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent =
        typeof item.label === "string"
          ? item.label
          : item.value;

      qualitySelect.appendChild(option);
    });
  }

  async function getVideo() {
    if (busy) return;

    clearMessage();
    hideProgress();
    resetResult();

    const url = input.value.trim();

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
      input.focus();
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

      setTextIfPresent(
        "videoTitle",
        data.title || "Facebook video"
      );

      const metadata = [];

      if (data.uploader) {
        metadata.push(data.uploader);
      }

      const duration = formatDuration(data.duration);

      if (duration) {
        metadata.push(duration);
      }

      const optionCount = Array.isArray(data.qualityOptions)
        ? data.qualityOptions.length
        : 0;

      if (optionCount > 0) {
        metadata.push(`${optionCount} quality option(s)`);
      }

      setTextIfPresent("videoMeta", metadata.join(" · "));

      displayThumbnail(data.thumbnail || "");
      displayQualityOptions(data.qualityOptions);

      result.hidden = false;
      result.classList.add("show");

      hideProgress();

      showMessage(
        "Video found! Choose a quality and click Download Video."
      );

      result.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
    } catch (error) {
      currentVideoUrl = "";
      hideProgress();

      showMessage(
        error.message || "Could not check this video.",
        true
      );

      console.error("VideoSnap info error:", error);
    } finally {
      setBusy(false);
    }
  }

  function getDownloadFilename(response) {
    const disposition = response.headers.get("Content-Disposition");

    if (disposition) {
      const utf8Match = disposition.match(
        /filename\*=UTF-8''([^;]+)/i
      );

      if (utf8Match) {
        try {
          return decodeURIComponent(utf8Match[1].trim());
        } catch {
          // Use the regular filename fallback.
        }
      }

      const regularMatch = disposition.match(
        /filename="?([^";]+)"?/i
      );

      if (regularMatch) {
        return regularMatch[1].trim();
      }
    }

    return "videosnap-video.mp4";
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
      "The server is preparing the file. Please wait."
    );

    let reader = null;

    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "video/mp4, application/octet-stream, application/json"
        },
        body: JSON.stringify({
          url: currentVideoUrl,
          quality: qualitySelect.value
        })
      });

      if (!response.ok) {
        const data = await readJson(response);

        throw new Error(
          data.error || `Download failed (${response.status}).`
        );
      }

      if (!response.body) {
        throw new Error(
          "Your browser cannot read the download stream. Try another browser."
        );
      }

      const contentType =
        response.headers.get("Content-Type") || "video/mp4";

      if (contentType.includes("application/json")) {
        const data = await readJson(response);

        throw new Error(
          data.error || "The server returned an unexpected response."
        );
      }

      const totalBytes =
        Number(response.headers.get("Content-Length")) || 0;

      reader = response.body.getReader();

      const chunks = [];
      let receivedBytes = 0;

      showProgress(
        "Downloading video...",
        totalBytes > 0 ? 0 : null,
        totalBytes > 0
          ? "Receiving the video file."
          : "Receiving the video file. Total file size is not available."
      );

      while (true) {
        const item = await reader.read();

        if (item.done) {
          break;
        }

        if (!item.value) {
          continue;
        }

        chunks.push(item.value);
        receivedBytes += item.value.byteLength;

        const receivedMB = (
          receivedBytes / (1024 * 1024)
        ).toFixed(2);

        if (totalBytes > 0) {
          const percent = Math.min(
            100,
            Math.floor((receivedBytes / totalBytes) * 100)
          );

          const totalMB = (
            totalBytes / (1024 * 1024)
          ).toFixed(2);

          showProgress(
            "Downloading video...",
            percent,
            `${receivedMB} MB received of ${totalMB} MB`
          );
        } else {
          showProgress(
            "Downloading video...",
            null,
            `${receivedMB} MB received`
          );
        }
      }

      if (receivedBytes === 0) {
        throw new Error("The server returned an empty file.");
      }

      const blob = new Blob(chunks, { type: contentType });

      if (activeObjectUrl) {
        URL.revokeObjectURL(activeObjectUrl);
      }

      activeObjectUrl = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = activeObjectUrl;
      anchor.download = getDownloadFilename(response);

      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      showProgress(
        "Download ready!",
        100,
        `${(receivedBytes / (1024 * 1024)).toFixed(2)} MB received. Your browser should now save the file.`
      );

      showMessage(
        "Your video is ready. Check your browser's downloads."
      );

      const urlToRevoke = activeObjectUrl;
      activeObjectUrl = null;

      window.setTimeout(() => {
        URL.revokeObjectURL(urlToRevoke);
      }, 60000);
    } catch (error) {
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancellation errors.
        }
      }

      hideProgress();

      showMessage(
        error.message || "Download failed. Please try again.",
        true
      );

      console.error("VideoSnap download error:", error);
    } finally {
      setBusy(false);
    }
  }

  getButton.addEventListener("click", getVideo);

  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      getVideo();
    }
  });

  downloadButton.addEventListener("click", downloadVideo);

  downloadButton.disabled = false;
}
