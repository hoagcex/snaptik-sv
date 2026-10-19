import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webhookCallback } from 'grammy';
import { config } from './config.js';
import { botStats } from './bot.js';
import { validateTikTokVideoUrl } from './validator.js';
import { getTikTokVideo, formatBytes, formatDuration } from './tiktokService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

/**
 * Creates and configures the Express application
 * @param {import('grammy').Bot} [bot]
 * @returns {express.Express}
 */
export function createServer(bot) {
  const app = express();

  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve static assets from public directory
  app.use(express.static(path.join(projectRoot, 'public')));

  // Webhook handler (if webhook mode is configured)
  if (bot && config.isWebhookMode) {
    console.log(`Setting up Express webhook callback at /webhook`);
    app.use('/webhook', webhookCallback(bot, 'express'));
  }

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      nodeVersion: process.version
    });
  });

  // Bot Status and Live Statistics API
  app.get('/api/status', (req, res) => {
    const memory = process.memoryUsage();
    res.json({
      bot: {
        configured: Boolean(config.botToken),
        mode: config.isWebhookMode ? 'webhook' : 'polling',
        limits: {
          maxDurationSeconds: config.maxDurationSeconds,
          maxDurationFormatted: formatDuration(config.maxDurationSeconds),
          maxFileSizeMB: config.maxFileSizeMB,
          maxFileSizeBytes: config.maxFileSizeBytes,
          downloadsDir: config.downloadsDir
        }
      },
      stats: {
        ...botStats,
        uptimeSeconds: Math.round(process.uptime()),
        totalTransferredFormatted: formatBytes(botStats.totalBytesTransferred)
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        memoryRss: formatBytes(memory.rss),
        memoryHeapUsed: formatBytes(memory.heapUsed)
      }
    });
  });

  // URL Testing & Validation API endpoint (for dashboard testing)
  app.post('/api/validate', async (req, res) => {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    try {
      const validation = validateTikTokVideoUrl(url);
      if (!validation.isValidMedia) {
        return res.json({
          valid: false,
          error: validation.error,
          resolvedUrl: validation.resolvedUrl
        });
      }

      const mediaResult = await getTikTokVideo(validation.resolvedUrl);
      if (!mediaResult.success) {
        return res.json({
          valid: false,
          error: mediaResult.error,
          resolvedUrl: validation.resolvedUrl
        });
      }

      return res.json({
        valid: true,
        mediaType: mediaResult.mediaType,
        data: mediaResult.data,
        resolvedUrl: validation.resolvedUrl
      });
    } catch (err) {
      return res.status(500).json({
        valid: false,
        error: err.message
      });
    }
  });

  return app;
}
