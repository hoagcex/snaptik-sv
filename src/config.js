import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';

const projectRoot = process.cwd();

export const config = {
  // Telegram Bot Token
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',

  // Express Web Server Port
  port: parseInt(process.env.PORT || '3000', 10),

  // Video duration limit in seconds (< 2 mins = 120s)
  maxDurationSeconds: parseInt(process.env.MAX_DURATION_SECONDS || '120', 10),

  // Video size limit in megabytes (Telegram bot upload limit is 50MB)
  maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10),

  // Calculated byte limit
  get maxFileSizeBytes() {
    return this.maxFileSizeMB * 1024 * 1024;
  },

  // Directory for storing downloads temporarily
  downloadsDir: path.resolve(projectRoot, process.env.DOWNLOADS_DIR || './downloads'),

  // Webhook URL (if set, bot operates in webhook mode; otherwise polling)
  webhookUrl: process.env.WEBHOOK_URL || '',

  // Is webhook mode enabled
  get isWebhookMode() {
    return Boolean(this.webhookUrl && this.webhookUrl.trim() !== '');
  },

  // Optional: Custom Telegram Bot API server root (e.g. http://localhost:8081 for self-hosted server allowing up to 2GB)
  telegramApiRoot: process.env.TELEGRAM_API_ROOT || '',

  // Is self-hosted local Bot API server enabled
  get isLocalBotApi() {
    return Boolean(this.telegramApiRoot && this.telegramApiRoot.trim() !== '');
  },

  // Effective Telegram upload limit in MB (50MB on official Telegram cloud, or up to 2000MB on local Bot API server)
  get telegramUploadLimitMB() {
    return this.isLocalBotApi ? this.maxFileSizeMB : Math.min(this.maxFileSizeMB, 50);
  },

  get telegramUploadLimitBytes() {
    return this.telegramUploadLimitMB * 1024 * 1024;
  }
};

// Ensure downloads directory exists
if (!fs.existsSync(config.downloadsDir)) {
  fs.mkdirSync(config.downloadsDir, { recursive: true });
}
