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

app.disable("x-powered-by");
app.use(helmet({
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
}));
app.use(express.json({ limit: "12kb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// Basic per-IP rate limit. For multiple server instances, use a shared store.
const rateBuckets = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt > 15 * 60 * 1000) {
    bucket = { startedAt: now, count: 0 };
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > 35) {
    return res.status(429).json({ error: "Too many requests. Please wait a few minutes and try again." });
  }
  next();
}
app.use("/api", rateLimit);

function validateFacebookUrl(value) {
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("Paste a valid Facebook video URL.");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("That link is not a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only web links are supported.");
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const allowed = host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch";
  if (!allowed) throw new Error("Please use a facebook.com or fb.watch video link.");
  if (parsed.username || parsed.password) throw new Error("Links containing credentials are not allowed.");
  parsed.hash = "";
  return parsed.toString();
}

function runYtDlp(args, timeoutMs, maxBuffer = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("The video service took too long. Try again later."));
    }, timeoutMs);

    function finish(err, output) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve({ stdout: output, stderr });
    }

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
      if (stdout.length > maxBuffer) {
        child.kill("SIGKILL");
        finish(new Error("The video information was too large to process."));
      }
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024);
    });
    child.on("error", err => finish(new Error("The video engine is unavailable. Ensure yt-dlp is installed.")));
    child.on("close", code => {
      if (settled) return;
      if (code !== 0) {
        const lower = stderr.toLowerCase();
        let message = "Could not access this video. It may be private, unavailable, or unsupported.";
        if (lower.includes("private") || lower.includes("login")) message = "This video appears to be private or requires login. Private/login-only videos are not supported.";
        else if (lower.includes("unsupported url")) message = "This Facebook link format is not currently supported.";
        else if (lower.includes("too many requests") || lower.includes("429")) message = "Facebook temporarily rate-limited this request. Please try again later.";
        finish(new Error(message));
      } else finish(null, stdout);
    });
  });
}

function normalizeInfo(info) {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const heights = [...new Set(formats
    .filter(f => f.vcodec && f.vcodec !== "none" && Number.isFinite(Number(f.height)))
    .map(f => Number(f.height))
    .filter(h => h > 0 && h <= 2160))]
    .sort((a, b) => b - a);

  const qualityOptions = [
    { value: "best", label: "Best available quality" },
    ...[1080, 720, 480, 360].filter(h => heights.some(actual => actual >= h)).map(h => ({
      value: String(h),
      label: `${h}p${h >= 720 ? " · HD" : ""}`
    }))
  ];
  return {
    title: String(info.title || "Facebook video").slice(0, 240),
    thumbnail: typeof info.thumbnail === "string" && /^https:\/\//i.test(info.thumbnail) ? info.thumbnail : null,
    duration: Number.isFinite(Number(info.duration)) ? Number(info.duration) : null,
    uploader: String(info.uploader || info.channel || "").slice(0, 120),
    qualityOptions
  };
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "VideoSnap" }));

app.post("/api/info", async (req, res) => {
  let url;
  try {
    url = validateFacebookUrl(req.body?.url);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const startedAt = Date.now();
    const { stdout } = await runYtDlp([
      "--dump-single-json", "--no-warnings", "--no-playlist",
      "--skip-download", "--socket-timeout", "20",
      "--", url
    ], INFO_TIMEOUT_MS);
    console.log(`[TIMING] /api/info yt-dlp: ${Date.now() - startedAt}ms`);
    const info = JSON.parse(stdout);
    if (info._type === "playlist" || Array.isArray(info.entries)) {
      return res.status(400).json({ error: "Please provide a single video link, not a playlist." });
    }
    res.json(normalizeInfo(info));
  } catch (error) {
    res.status(422).json({ error: error.message || "Could not read this video." });
  }
});

app.post("/api/download", async (req, res) => {
  let url;
  try {
    url = validateFacebookUrl(req.body?.url);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const quality = String(req.body?.quality || "best");
  if (!["best", "1080", "720", "480", "360"].includes(quality)) {
    return res.status(400).json({ error: "Choose one of the listed quality options." });
  }

  const tempDir = path.join(os.tmpdir(), `videosnap-${randomUUID()}`);
  try {
    await fsp.mkdir(tempDir, { recursive: true, mode: 0o700 });
    const format = quality === "best"
      ? "best[ext=mp4]/best"
      : `best[height<=${quality}][ext=mp4]/best[height<=${quality}]/best`;
    await runYtDlp([
      "--no-warnings", "--no-playlist", "--no-progress",
      "--max-filesize", "500M",
      "--socket-timeout", "25",
      "-f", format,
      "--merge-output-format", "mp4",
      "-o", path.join(tempDir, "video.%(ext)s"),
      "--", url
    ], DOWNLOAD_TIMEOUT_MS, 1024 * 1024);

    const entries = await fsp.readdir(tempDir);
    const videoName = entries.find(name => /^video\.(mp4|mkv|webm|mov)$/i.test(name));
    if (!videoName) throw new Error("The video could not be prepared. Try another quality or link.");
    const filePath = path.join(tempDir, videoName);
    const stat = await fsp.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_DOWNLOAD_BYTES) throw new Error("This file is too large. The limit is 500 MB.");

    const ext = path.extname(videoName).toLowerCase();
    res.setHeader("Content-Type", ext === ".mp4" ? "video/mp4" : ext === ".webm" ? "video/webm" : "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="videosnap-video${ext}"`);
    res.setHeader("Content-Length", stat.size);
    
let bytesSent = 0;
const totalBytes = stat.size;
const stream = fs.createReadStream(filePath);

res.setHeader("Content-Length", totalBytes);
res.setHeader("X-Content-Type-Options", "nosniff");

stream.on("data", (chunk) => {
  bytesSent += chunk.length;
  const percent = Math.min(100, Math.round((bytesSent / totalBytes) * 100));
  console.log(`[DOWNLOAD] ${percent}% (${bytesSent}/${totalBytes} bytes)`);
});

stream.on("error", (error) => {
  console.error("[DOWNLOAD] Stream error:", error.message);
  if (!res.headersSent) {
    res.status(500);
  }
  res.end();
});

res.on("close", () => {
  stream.destroy();
  fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

stream.pipe(res);

  } catch (error) {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    const message = error.message || "Download failed.";
    const status = message.includes("too large") ? 413 : 422;
    if (!res.headersSent) res.status(status).json({ error: message });
  }
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled request error:", err.message);
  res.status(500).json({ error: "Unexpected server error. Please try again." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`VideoSnap is running on port ${PORT}`);
});
