# VideoSnap — Facebook Video Downloader

VideoSnap is a small Node.js + Express app with separate frontend files and a backend powered by `yt-dlp`. It can fetch details and download some **publicly accessible** Facebook videos. It cannot guarantee that every Facebook link will work.

Use this only for videos you own or have permission to save. Do not use it to bypass private-video permissions, login requirements, DRM, or other access controls. Follow Facebook/Meta terms and local copyright law.

## Project structure

```text
videosnap-project/
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server.js
├── package.json
├── Dockerfile
├── render.yaml
├── .dockerignore
└── .gitignore
```

## Run locally

Requirements: Node.js 20+ and `yt-dlp` installed and available on your PATH. `ffmpeg` is recommended for merging audio/video streams.

1. Extract the ZIP.
2. Open a terminal in the project folder.
3. Install Node packages:

   ```bash
   npm install
   ```

4. Install `yt-dlp` using its official instructions: https://github.com/yt-dlp/yt-dlp/wiki/Installation
5. Make sure `yt-dlp --version` works in your terminal.
6. Start the app:

   ```bash
   npm start
   ```

7. Open http://localhost:3000

## Deploy online with Render (Docker)

1. Create a GitHub repository and upload the extracted project files.
2. Sign in to https://render.com and choose **New → Web Service**.
3. Connect your GitHub repository.
4. Choose **Docker** runtime (Render can detect the included Dockerfile).
5. Deploy. The Dockerfile installs Node.js dependencies, yt-dlp, Python and ffmpeg.
6. Open the Render URL after deployment. The health endpoint is `/api/health`.

You can also use the included `render.yaml` as a starting point. Hosting providers may charge for the server; check their current pricing and limits before deploying.

## API endpoints

- `GET /api/health` — service health check.
- `POST /api/info` — JSON body `{ "url": "https://www.facebook.com/..." }`; returns title, thumbnail, duration and quality choices.
- `POST /api/download` — JSON body `{ "url": "...", "quality": "best" }`; returns the video file as an attachment. Allowed quality values: `best`, `1080`, `720`, `480`, `360`.

## Important operational notes

- Facebook frequently changes video access and delivery. A link may stop working even if it worked previously.
- Private, login-only, removed, region-restricted or unsupported videos will fail.
- The backend accepts Facebook URLs only, applies a basic in-memory rate limit and caps a video at 500 MB.
- For production use, consider a persistent shared rate limiter, request/concurrency limits, monitoring, abuse reporting, a privacy policy, and an explicit copyright/permission notice.
- Never add browser cookies, session tokens, or private account credentials to this public service.
- This starter project has not been deployed to your hosting account; you must connect the repository and deploy it yourself.

## Troubleshooting

- **“Video engine is unavailable”**: confirm `yt-dlp --version` works inside the running environment. With Docker, rebuild the image.
- **Video cannot be accessed**: the link may be private, unsupported or blocked by Facebook. Try a public video you have permission to download.
- **Download fails or times out**: try a lower quality or a smaller video. Hosting timeouts and memory limits can also affect downloads.
