
"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("videoUrl");
  const getVideoButton = document.getElementById("getVideo");
  const message = document.getElementById("message");
  const result = document.getElementById("result");
  const qualitySelect = document.getElementById("quality");
  const downloadButton = document.getElementById("downloadBtn");
  const resultTitle = document.getElementById("videoTitle");
  const resultText = document.getElementById("resultText");
  const thumbnail = document.getElementById("thumb");
  const videoMeta = document.getElementById("videoMeta");

  if (
    !input ||
    !getVideoButton ||
    !message ||
    !result ||
    !qualitySelect ||
    !downloadButton
  ) {
    console.error("VideoSnap: One or more required HTML elements are missing.");
    return;
  }

  let selectedPlatform = "YouTube";
  let currentUrl = "";
  let busy = false;
  let progressWrap;
  let progressFill;
  let progressTitle;
  let progressPercent;
  let progressNote;

  // Add platform selector without requiring an index.html edit.
  const picker = document.createElement("div");
  picker.className = "videosnap-platform-picker";
  picker.innerHTML = `
    <style>
      .videosnap-platform-picker {
        max-width: 780px;
        margin: 0 auto 18px;
      }
      .videosnap-platform-picker .platform-label {
        display: block;
        margin-bottom: 10px;
        font-weight: 750;
        font-size: .9rem;
      }
      .videosnap-platform-picker .platform-options {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .videosnap-platform-picker .platform-button {
        min-height: 48px;
        border: 1px solid var(--line, #e3e8f3);
        border-radius: 12px;
        padding: 10px 14px;
        color: var(--text, #172033);
        background: var(--surface, #fff);
        font-weight: 800;
        cursor: pointer;
      }
      .videosnap-platform-picker .platform-button.active {
        border: 2px solid var(--blue, #3867f5);
        background: var(--soft, #edf2ff);
      }
      .videosnap-platform-picker .platform-button:disabled {
        opacity: .6;
        cursor: not-allowed;
      }
      .videosnap-progress {
        display: none;
        margin-top: 16px;
        padding: 15px;
        border: 1px solid var(--line, #e3e8f3);
        border-radius: 14px;
        background: var(--surface, #fff);
      }
      .videosnap-progress.show { display: block; }
      .videosnap-progress-top {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
        font-size: .88rem;
        font-weight: 750;
      }
      .videosnap-progress-track {
        height: 9px;
        overflow: hidden;
        border-radius: 999px;
        background: #e7ebf7;
      }
      .videosnap-progress-fill {
        height: 100%;
        width: 0;
        border-radius: 999px;
        background: linear-gradient(90deg, #3867f5, #7c3aed);
        transition: width .15s ease;
      }
      .videosnap-progress-fill.indeterminate {
        width: 35%;
        animation: videosnap-progress-animation 1.1s ease-in-out infinite alternate;
      }
      .videosnap-progress-note {
        margin: 9px 0 0;
        color: var(--muted, #667085);
        font-size: .8rem;
        line-height: 1.5;
      }
      @keyframes videosnap-progress-animation {
        from { transform: translateX(0); }
        to { transform: translateX(185%); }
      }
      @media (max-width: 480px) {
        .videosnap-platform-picker .platform-button { font-size: .85rem; }
        .videosnap-progress-top { font-size: .82rem; }
      }
    </style>
    <span class="platform-label">Choose your platform</span>
    <div class="platform-options">
      <button type="button" class="platform-button active"
        data-platform="YouTube" aria-pressed="true">▶ YouTube</button>
      <button type="button" class="platform-button"
        data-platform="Facebook" aria-pressed="false">f Facebook</button>
    </div>
  `;

  const panel = input.closest(".panel");
  if (panel) {
    panel.parentNode.insertBefore(picker, panel);
  }

  // Add progress UI.
  progressWrap = document.createElement("div");
  progressWrap.className = "videosnap-progress";
  progressWrap.setAttribute("role", "status");
  progressWrap.setAttribute("aria-live", "polite");
  progressWrap.innerHTML = `
    <div class="videosnap-progress-top">
      <span class="progress-title">Preparing your video…</span>
      <span class="progress-percent">Working</span>
    </div>
    <div class="videosnap-progress-track">
      <div class="videosnap-progress-fill indeterminate"></div>
    </div>
    <p class="videosnap-progress-note">
      Please wait while VideoSnap processes your request.
    </p>
  `;

  message.insertAdjacentElement("afterend", progressWrap);

  progressFill = progressWrap.querySelector(".videosnap-progress-fill");
  progressTitle = progressWrap.querySelector(".progress-title");
  progressPercent = progressWrap.querySelector(".progress-percent");
  progressNote = progressWrap.querySelector(".videosnap-progress-note");

  function showMessage(text, type = "info") {
    message.textContent = text;
    message.classList.add("show");
    message.style.background =
      type === "error" ? "#fff0f0" : "var(--soft, #edf2ff)";
    message.style.color = type === "error" ? "#a51d2d" : "var(--text, #172033)";
  }

  function hideMessage() {
    message.classList.remove("show");
    message.textContent = "";
  }

  function showProgress(title, note = "Please wait…") {
    progressWrap.classList.add("show");
    progressTitle.textContent = title;
    progressPercent.textContent = "Working";
    progressNote.textContent = note;
    progressFill.classList.add("indeterminate");
    progressFill.style.width = "35%";
  }

  function setProgress(percent, note) {
    const safePercent = Math.max(0, Math.min(100, percent));

    progressFill.classList.remove("indeterminate");
    progressFill.style.width = `${safePercent}%`;
    progressPercent.textContent = `${Math.round(safePercent)}%`;

    if (note) progressNote.textContent = note;
  }

  function hideProgress() {
    progressWrap.classList.remove("show");
  }

  function setBusy(value) {
    busy = value;
    getVideoButton.disabled = value;
    downloadButton.disabled = value;

    picker.querySelectorAll("[data-platform]").forEach((button) => {
      button.disabled = value;
    });

    getVideoButton.style.opacity = value ? "0.65" : "";
    downloadButton.style.opacity = value ? "0.65" : "";
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "";

    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function validateSelectedPlatform(value) {
    let parsed;

    try {
      parsed = new URL(value);
    } catch {
      throw new Error("Please paste a complete video URL starting with https://.");
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only HTTP and HTTPS video links are supported.");
    }

    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");

    const isYouTube =
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be";

    const isFacebook =
      host === "facebook.com" ||
      host.endsWith(".facebook.com") ||
      host === "fb.watch";

    if (selectedPlatform === "YouTube" && !isYouTube) {
      throw new Error("Please paste a valid YouTube video link.");
    }

    if (selectedPlatform === "Facebook" && !isFacebook) {
      throw new Error("Please paste a valid Facebook video link.");
    }

    return parsed.toString();
  }

  async function readJsonResponse(response) {
    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error("The server returned an invalid response. Please try again.");
    }

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status}).`);
    }

    return data;
  }

  function resetResult() {
    result.classList.remove("show");
    currentUrl = "";

    if (resultTitle) resultTitle.textContent = "Video information";
    if (resultText) resultText.textContent = "";
    if (videoMeta) videoMeta.textContent = "";

    if (thumbnail) {
      thumbnail.replaceChildren();
    }

    qualitySelect.replaceChildren();
    downloadButton.disabled = true;
  }

  function showVideoInfo(info, url) {
    currentUrl = url;

    if (resultTitle) {
      resultTitle.textContent = info.title || "Video ready";
    }

    if (resultText) {
      resultText.textContent = info.uploader
        ? `Uploaded by ${info.uploader}`
        : `${selectedPlatform} video`;
    }

    if (videoMeta) {
      const duration = formatDuration(info.duration);
      videoMeta.textContent = duration ? `Duration: ${duration}` : "";
    }

    if (thumbnail) {
      thumbnail.replaceChildren();

      if (info.thumbnail) {
        const image = document.createElement("img");
        image.src = info.thumbnail;
        image.alt = "Video thumbnail";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.style.width = "100%";
        image.style.height = "100%";
        image.style.objectFit = "cover";
        image.style.borderRadius = "12px";

        image.addEventListener("error", () => {
          image.remove();
          thumbnail.textContent = "▶";
        }, { once: true });

        thumbnail.appendChild(image);
      } else {
        thumbnail.textContent = "▶";
      }
    }

    qualitySelect.replaceChildren();

    const options = Array.isArray(info.qualityOptions)
      ? info.qualityOptions
      : [{ value: "best", label: "Best available quality" }];

    for (const item of options) {
      const option = document.createElement("option");
      option.value = String(item.value);
      option.textContent = String(item.label);
      qualitySelect.appendChild(option);
    }

    if (resultText && !info.uploader) {
      resultText.textContent = "Choose an available quality and download the video.";
    }

    result.classList.add("show");
    downloadButton.disabled = false;
  }

  async function getVideo() {
    if (busy) return;

    hideMessage();
    hideProgress();
    resetResult();

    let url;

    try {
      url = validateSelectedPlatform(input.value.trim());
    } catch (error) {
      showMessage(error.message, "error");
      input.focus();
      return;
    }

    setBusy(true);
    showProgress(
      "Checking your video…",
      "Contacting the VideoSnap server to retrieve video information."
    );

    try {
      const response = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(70000)
      });

      const info = await readJsonResponse(response);

      showVideoInfo(info, url);
      progressTitle.textContent = "Video information loaded";
      progressFill.classList.remove("indeterminate");
      progressFill.style.width = "100%";
      progressPercent.textContent = "Ready";
      progressNote.textContent = "Choose your quality and click Download Video.";
      showMessage("Video information loaded successfully.");
      result.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      console.error("VideoSnap info error:", error);
      showMessage(error.message || "Could not retrieve this video.", "error");
      progressTitle.textContent = "Could not load video";
      progressPercent.textContent = "Failed";
      progressNote.textContent = "Check the link and try again.";
    } finally {
      setBusy(false);
    }
  }

  function getFilename(response) {
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);

    if (match && match[1] && /^[a-zA-Z0-9._-]+$/.test(match[1])) {
      return match[1];
    }

    return "videosnap-video.mp4";
  }

  async function downloadVideo() {
    if (busy) return;

    if (!currentUrl) {
      showMessage("Check a video link first.", "error");
      return;
    }

    hideMessage();
    setBusy(true);

    showProgress(
      "Preparing your download…",
      "The server is processing the video. This step may take some time."
    );

    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: currentUrl,
          quality: qualitySelect.value || "best"
        }),
        signal: AbortSignal.timeout(260000)
      });

      if (!response.ok) {
        const data = await readJsonResponse(response);
        throw new Error(data.error || "Download failed.");
      }

      if (!response.body) {
        throw new Error("Your browser does not support this download response.");
      }

      const total = Number(response.headers.get("Content-Length")) || 0;
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;

      progressTitle.textContent = "Receiving video file…";
      progressNote.textContent = total
        ? "The video is being transferred to your browser."
        : "Receiving the video file. File size is not available.";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        received += value.byteLength;

        if (total > 0) {
          const percent = (received / total) * 100;
          setProgress(
            percent,
            `Received ${(received / (1024 * 1024)).toFixed(2)} MB of ${(total / (1024 * 1024)).toFixed(2)} MB.`
          );
        } else {
          progressTitle.textContent = "Receiving video file…";
          progressPercent.textContent =
            `${(received / (1024 * 1024)).toFixed(1)} MB`;
        }
      }

      const contentType =
        response.headers.get("Content-Type") || "application/octet-stream";

      const blob = new Blob(chunks, { type: contentType });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = getFilename(response);
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);

      setProgress(100, "Your browser has received the video file.");
      progressTitle.textContent = "Download ready";
      progressPercent.textContent = "100%";
      showMessage("Your video file is ready. Check your browser's downloads.");
    } catch (error) {
      console.error("VideoSnap download error:", error);
      showMessage(error.message || "Download failed. Please try again.", "error");
      progressTitle.textContent = "Download failed";
      progressPercent.textContent = "Failed";
      progressNote.textContent = "Check the link or try another available quality.";
    } finally {
      setBusy(false);
    }
  }

  picker.querySelectorAll("[data-platform]").forEach((button) => {
    button.addEventListener("click", () => {
      if (busy) return;

      selectedPlatform = button.dataset.platform;

      picker.querySelectorAll("[data-platform]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });

      const label = document.querySelector('label[for="videoUrl"]');

      if (label) {
        label.textContent = `${selectedPlatform} video link`;
      }

      input.placeholder =
        selectedPlatform === "YouTube"
          ? "Paste your YouTube video link here..."
          : "Paste your Facebook video link here...";

      input.value = "";
      hideMessage();
      hideProgress();
      resetResult();
    });
  });

  getVideoButton.addEventListener("click", getVideo);
  downloadButton.addEventListener("click", downloadVideo);

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      getVideo();
    }
  });

  resetResult();
  input.placeholder = "Paste your YouTube video link here...";
});
