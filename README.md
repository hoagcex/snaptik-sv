# SnapTik & Reels Telegram Downloader Bot 🤖

A high-performance media downloader Telegram bot built with **Node.js > 24**, **GrammY**, and **Express** supporting **TikTok**, **Instagram Reels**, and **Facebook Reels**.

---

## 🌟 Key Features

* **Multi-Platform Support:**
  * ✅ **TikTok Videos & Photos:** Watermark-free videos and complete photo slideshow carousels.
  * ✅ **Instagram Reels & Videos:** Fast public Instagram Reel and post video downloads.
  * ✅ **Facebook Reels & Videos:** Public Facebook Reels and videos via direct extraction and fallback engine.
  * 🔒 **Private / Non-Public Reel Protection:** If a Reel is private, restricted, or cannot be seen, the bot displays a clear message stating it cannot download non-public media.
  * ❌ Rejects **TikTok Shop products**, **Live streams**, **Stories**, profiles, and audio-only links.
* **Duration Limit Enforcement:** Strictly enforces **video duration < 2 minutes (120 seconds)**. Media exceeding this duration are automatically rejected.
* **File Size Limit Enforcement:** Automatically rejects files exceeding **50 MB** (Telegram Bot API upload limit).
* **Ephemeral Local Storage & Guaranteed Cleanup:**
  1. Downloads media directly into the project's `./downloads/` folder.
  2. Sends the video or photo album to the client via Telegram without return text or captions.
  3. **Immediately deletes the stored media from disk** in a guaranteed `finally` block.
  4. Automatically sweeps any orphan files on startup and every 20 minutes.
* **Interactive Express Web Dashboard:** Runs an embedded Express web monitor at `http://localhost:3000` with live statistics, health checks (`/health`), and a built-in interactive URL validator tool supporting TikTok, Instagram, and Facebook links.

---

## 📋 Prerequisites

* **Node.js >= 24.0.0** (or modern Node with native `fetch` and ES Modules)
* A Telegram Bot token obtained from [@BotFather](https://t.me/BotFather)

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy the `.env.example` file to `.env`:
```bash
cp .env.example .env
```

Edit `.env` and fill in your Telegram Bot Token:
```env
# Required: Bot token from @BotFather
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

# Express server port (default: 3000)
PORT=3000

# Maximum video duration allowed in seconds (< 2 mins = 120s)
MAX_DURATION_SECONDS=120

# Maximum video file size allowed in MB (default: 50MB)
MAX_FILE_SIZE_MB=50

# Local folder for temporary downloads
DOWNLOADS_DIR=./downloads

# Optional: Webhook URL (leave blank for long polling)
# WEBHOOK_URL=https://your-domain.com
```

### 3. Run the Bot & Server
```bash
# Production mode
npm start

# Development mode with auto-reload
npm run dev
```

### 4. Run Automated Tests
```bash
npm test
```

---

## 🌐 Web Dashboard & Endpoints

When running, the Express server provides:
| Endpoint | Method | Description |
|---|---|---|
| `/` | `GET` | Modern Web Dashboard with live metrics & interactive link tester |
| `/health` | `GET` | Health check endpoint returning uptime and Node.js version |
| `/api/status` | `GET` | JSON status with request counters, limits, and system metrics |
| `/api/validate` | `POST` | Validates a TikTok URL (returns video info or rejection reason) |
| `/webhook` | `POST` | Telegram webhook endpoint (enabled when `WEBHOOK_URL` is set) |

---

## 💬 Bot Commands in Telegram

* `/start` - Displays bot introduction and usage guidelines.
* `/help` - Lists supported and unsupported link types with examples.
* `/limits` - Shows active duration, file size, and storage constraints.
* `/ping` - Tests bot latency and server uptime.

---

## 📁 Project Structure

```
snaptik/
├── src/
│   ├── config.js          # Environment variables & limit configurations
│   ├── validator.js       # URL extraction & multi-platform link validation
│   ├── mediaService.js    # Universal router for TikTok, Instagram Reels, & FB Reels
│   ├── tiktokService.js   # Multi-provider TikTok downloader (TikWM + TobyG74 fallback)
│   ├── fileManager.js     # Local download, stream size guard, and instant cleanup
│   ├── bot.js             # Grammy Telegram bot handlers (clean dispatch without return text)
│   └── server.js          # Express app: dashboard, health check, status API & webhook
├── public/                # Web Dashboard assets
│   ├── index.html         # Live dashboard & interactive link tester UI
│   └── style.css          # Modern dark-theme glassmorphic styling
├── test/                  # Unit and integration test suite
│   ├── validator.test.js
│   ├── mediaService.test.js
│   ├── tiktokService.test.js
│   └── fileManager.test.js
├── downloads/             # Ephemeral local storage (auto-cleaned)
├── .env.example           # Example environment template
├── package.json           # ES Modules & Node.js >= 24 engine
├── index.js               # Application entry point
└── README.md
```

---

## 🔒 Security & Disk Safety
* **Zero Disk Bloat:** Videos are strictly stored only while being dispatched, and immediately unlinked after sending.
* **Stream Abort Guard:** If an incoming download stream exceeds the configured file size limit (50MB), the stream is immediately aborted and the partial file removed.
* **Auto Garbage Collector:** Automatic sweep on startup cleans any residual temporary files from unexpected server restarts.
