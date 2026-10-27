
const express = require("express");
const helmet = require("helmet");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;
const INFO_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 240_000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 35;

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "same-site" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null
      }
    }
  })
);

app.use(express.json({ limit: "12kb" }));

app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html"]
  })
);

// Basic in-memory rate limiter.
// For multiple instances, use a shared store.
const rateBuckets = new Map();

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";

  let bucket = rateBuckets.get(key);

  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
  }

  bucket.count += 1;
  rateBuckets.set(key, bucket);

  if (bucket.count > MAX_REQUESTS_PER_WINDOW) {
    res.setHeader("Retry-After", "900");

    return res.status(429).json({
      error: "Too many requests. Please wait a few minutes and try again."
    });
  }

  next();
}

app.use("/api", rateLimit);

// Avoid keeping expired IP buckets indefinitely.
const rateCleanup = setInterval(() => {
  const now = Date.now();

  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.startedAt >= RATE_WINDOW_MS) {
      rateBuckets.delete(key);
    }
  }
}, 5 * 60 * 1000);

rateCleanup.unref();

// Supported public video URL hosts.
function validateVideoUrl(value) {
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("Paste a valid YouTube or Facebook video URL.");
  }

  let parsed;

  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("That link is not a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only HTTP and HTTPS video links are supported.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Links containing credentials are not allowed.");
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");

  const isYouTube =
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be" ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com");

  const isFacebook =
    host === "facebook.com" ||
    host.endsWith(".facebook.com") ||
    host === "fb.watch";

  if (!isYouTube && !isFacebook) {
    throw new Error(
      "Please use a supported YouTube or Facebook video link."
    );
  }

  // Return a normalized URL without a fragment.
  parsed.hash = "";

  return {
    url: parsed.toString(),
    platform: isYouTube ? "YouTube" : "Facebook"
  };
}

// Run yt-dlp with bounded output and timeout.
function runYtDlp(args, timeoutMs, maxBuffer = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let child;

    try {
      child = spawn("yt-dlp", args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
    } catch {
      reject(new Error("Could not start the video engine."));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGKILL");

      finish(
        new Error("The video service took too long. Please try again.")
      );
    }, timeoutMs);

    function finish(error, output) {
      if (settled) return;

      settled = true;
      clearTimeout(timer);

      if (error) {
        reject(error);
      } else {
        resolve({ stdout: output, stderr });
      }
    }

    child.stdout.on("data", (chunk) => {
      if (settled) return;

      stdout += chunk.toString();

      if (stdout.length > maxBuffer) {
        child.kill("SIGKILL");

        finish(
          new Error("The video information was too large to process.")
        );
      }
    });

    child.stderr.on("data", (chunk) => {
      if (settled) return;

      stderr += chunk.toString();

      if (stderr.length > 64 * 1024) {
        stderr = stderr.slice(-64 * 1024);
      }
    });

    child.on("error", (error) => {
      console.error("[YTDLP] Process error:", error.message);

      finish(
        new Error(
          "The video engine is unavailable. Ensure yt-dlp is installed."
        )
      );
    });

    child.on("close", (code) => {
      if (settled) return;

      if (code !== 0) {
        const lower = stderr.toLowerCase();

        let message =
          "Could not access this video. It may be private, unavailable, or unsupported.";

        if (
          lower.includes("private") ||
          lower.includes("login required") ||
          lower.includes("sign in to confirm")
        ) {
          message =
            "This video requires access or login. Private/login-only videos are not supported.";
        } else if (lower.includes("unsupported url")) {
          message =
            "This video link format is not currently supported.";
        } else if (
          lower.includes("too many requests") ||
          lower.includes("http error 429") ||
          lower.includes("429")
        ) {
          message =
            "The video platform temporarily rate-limited this request. Please try again later.";
        } else if (
          lower.includes("max-filesize") ||
          lower.includes("file is larger than")
        ) {
          message = "This video exceeds the 500 MB download limit.";
        }

        finish(new Error(message));
      } else {
        finish(null, stdout);
      }
    });
  });
}

function normalizeInfo(info, platform) {
  const formats = Array.isArray(info.formats) ? info.formats : [];

  const heights = [
    ...new Set(
      formats
        .filter(
          (format) =>
            format.vcodec &&
            format.vcodec !== "none" &&
            Number.isFinite(Number(format.height))
        )
        .map((format) => Number(format.height))
        .filter((height) => height > 0 && height <= 2160)
    )
  ].sort((a, b) => b - a);

  const qualityOptions = [
    { value: "best", label: "Best available quality" },
    ...[1080, 720, 480, 360]
      .filter((height) => heights.some((actual) => actual >= height))
      .map((height) => ({
        value: String(height),
        label: `${height}p${height >= 720 ? " · HD" : ""}`
      }))
  ];

  const duration = Number(info.duration);

  return {
    platform,
    title: String(info.title || `${platform} video`).slice(0, 240),

    thumbnail:
      typeof info.thumbnail === "string" &&
      /^https:\/\//i.test(info.thumbnail)
        ? info.thumbnail
        : null,

    duration:
      Number.isFinite(duration) && duration >= 0
        ? duration
        : null,

    uploader: String(
      info.uploader || info.channel || info.creator || ""
    ).slice(0, 120),

    qualityOptions
  };
}

function getErrorMessage(error) {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

// Health check.
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "VideoSnap",
    supportedPlatforms: ["YouTube", "Facebook"]
  });
});

// Retrieve video information.
app.post("/api/info", async (req, res) => {
  let validated;

  try {
    validated = validateVideoUrl(req.body?.url);
  } catch (error) {
    return res.status(400).json({
      error: getErrorMessage(error)
    });
  }

  const { url, platform } = validated;
  const startedAt = Date.now();

  try {
    const { stdout } = await runYtDlp(
      [
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        "--skip-download",
        "--socket-timeout",
        "20",
        "--",
        url
      ],
      INFO_TIMEOUT_MS
    );

    console.log(
      `[TIMING] /api/info ${platform}: ${Date.now() - startedAt}ms`
    );

    const info = JSON.parse(stdout);

    if (info._type === "playlist" || Array.isArray(info.entries)) {
      return res.status(400).json({
        error: "Please provide a single video link, not a playlist."
      });
    }

    return res.json(normalizeInfo(info, platform));
  } catch (error) {
    console.error(
      `[INFO] ${platform} request failed:`,
      getErrorMessage(error)
    );

    return res.status(422).json({
      error: getErrorMessage(error)
    });
  }
});

// Download a supported video.
app.post("/api/download", async (req, res) => {
  let validated;

  try {
    validated = validateVideoUrl(req.body?.url);
  } catch (error) {
    return res.status(400).json({
      error: getErrorMessage(error)
    });
  }

  const { url, platform } = validated;
  const quality = String(req.body?.quality || "best");

  if (!["best", "1080", "720", "480", "360"].includes(quality)) {
    return res.status(400).json({
      error: "Choose one of the listed quality options."
    });
  }

  const requestStartedAt = Date.now();
  const tempDir = path.join(os.tmpdir(), `videosnap-${randomUUID()}`);

  let stream = null;
  let cleanupPromise = null;

  function cleanup() {
    if (!cleanupPromise) {
      cleanupPromise = fsp
        .rm(tempDir, { recursive: true, force: true })
        .catch((error) => {
          console.error(
            "[CLEANUP] Could not remove temporary directory:",
            error.message
          );
        });
    }

    return cleanupPromise;
  }

  try {
    console.log(`[DOWNLOAD] Started: ${platform}, quality=${quality}`);

    await fsp.mkdir(tempDir, {
      recursive: true,
      mode: 0o700
    });

    const format =
      quality === "best"
        ? "best[ext=mp4]/best"
        : `best[height<=${quality}][ext=mp4]/best[height<=${quality}]/best`;

    await runYtDlp(
      [
        "--no-warnings",
        "--no-playlist",
        "--no-progress",
        "--max-filesize",
        "500M",
        "--socket-timeout",
        "25",
        "-f",
        format,
        "--merge-output-format",
        "mp4",
        "-o",
        path.join(tempDir, "video.%(ext)s"),
        "--",
        url
      ],
      DOWNLOAD_TIMEOUT_MS,
      1024 * 1024
    );

    console.log(
      `[TIMING] yt-dlp completed: ${Date.now() - requestStartedAt}ms`
    );

    const entries = await fsp.readdir(tempDir);

    const videoName = entries.find((name) =>
      /^video\.(mp4|mkv|webm|mov)$/i.test(name)
    );

    if (!videoName) {
      throw new Error(
        "The video could not be prepared. Try another quality or link."
      );
    }

    const filePath = path.join(tempDir, videoName);
    const stat = await fsp.stat(filePath);

    if (!stat.isFile() || stat.size <= 0) {
      throw new Error("The video file could not be prepared.");
    }

    if (stat.size > MAX_DOWNLOAD_BYTES) {
      throw new Error("This file is too large. The limit is 500 MB.");
    }

    const ext = path.extname(videoName).toLowerCase();

    const contentType =
      ext === ".mp4"
        ? "video/mp4"
        : ext === ".webm"
          ? "video/webm"
          : "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="videosnap-video${ext}"`
    );
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");

    console.log(
      `[TIMING] File ready: ${Date.now() - requestStartedAt}ms; ` +
      `size=${(stat.size / 1024 / 1024).toFixed(2)} MB`
    );

    let bytesSent = 0;
    let lastLoggedPercent = -1;

    stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => {
      bytesSent += chunk.length;

      const percent = Math.min(
        100,
        Math.floor((bytesSent / stat.size) * 100)
      );

      if (percent !== lastLoggedPercent) {
        lastLoggedPercent = percent;

        console.log(
          `[DOWNLOAD] ${percent}% (${bytesSent}/${stat.size} bytes)`
        );
      }
    });

    stream.on("error", (error) => {
      console.error("[DOWNLOAD] Stream error:", error.message);

      if (!res.headersSent) {
        res.status(500).json({
          error: "An error occurred while sending the video."
        });
      } else if (!res.destroyed) {
        res.destroy(error);
      }

      void cleanup();
    });

    stream.on("end", () => {
      console.log(
        `[DOWNLOAD] Completed in ${Date.now() - requestStartedAt}ms`
      );
    });

    res.on("close", () => {
      // Stop reading if the client disconnects early.
      if (!res.writableEnded && stream && !stream.destroyed) {
        stream.destroy();
      }

      void cleanup();
    });

    stream.pipe(res);
  } catch (error) {
    await cleanup();

    console.error(
      `[DOWNLOAD] ${platform} failed:`,
      getErrorMessage(error)
    );

    if (!res.headersSent && !res.destroyed) {
      const message = getErrorMessage(error);
      const status = message.toLowerCase().includes("too large")
        ? 413
        : 422;

      return res.status(status).json({ error: message });
    }
  }
});

// JSON response for unexpected errors.
app.use((err, _req, res, _next) => {
  console.error("[SERVER] Unhandled error:", err.message);

  if (!res.headersSent && !res.destroyed) {
    res.status(500).json({
      error: "Unexpected server error. Please try again."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`VideoSnap is running on port ${PORT}`);
});
