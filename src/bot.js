import { Bot, InputFile } from 'grammy';
import { config } from './config.js';
import { extractTikTokUrls, validateTikTokVideoUrl } from './validator.js';
import { getTikTokVideo, formatBytes, formatDuration } from './tiktokService.js';
import { downloadVideoToLocal, downloadPhotosToLocal, deleteLocalFile, deleteLocalFiles } from './fileManager.js';

// Live statistics for Express dashboard
export const botStats = {
  startedAt: new Date(),
  totalRequests: 0,
  successfulDownloads: 0,
  rejectedDuration: 0,
  rejectedSize: 0,
  rejectedNonVideo: 0,
  failedDownloads: 0,
  totalBytesTransferred: 0,
  recentActivity: []
};

function logActivity(type, info) {
  botStats.recentActivity.unshift({
    timestamp: new Date().toISOString(),
    type,
    info
  });
  if (botStats.recentActivity.length > 25) {
    botStats.recentActivity.pop();
  }
}

/**
 * Escape Telegram Markdown special characters
 */
function escapeMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Initialize and configure Grammy Bot instance
 */
export function createBot() {
  if (!config.botToken) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN is not set in environment or .env! Bot cannot start.');
    return null;
  }

  const bot = new Bot(config.botToken);

  // Command: /start
  bot.command('start', async (ctx) => {
    const welcome = [
      `👋 *Hello ${ctx.from?.first_name || 'there'}!*`,
      '',
      `Welcome to *SnapTik Downloader Bot* 📥`,
      `Send me any TikTok video link, and I will download and send it to you with no watermark!`,
      '',
      `⚡ *Download Rules & Limits:*`,
      `• ⏱️ *Max Duration:* Under 2 minutes (< 120s)`,
      `• 📦 *Max File Size:* ${config.maxFileSizeMB} MB`,
      `• 🎬 *Only TikTok Videos:* Photo posts, shop products, and live streams are NOT supported.`,
      `• 🔒 *Auto-Cleanup:* Videos are saved to the server temporarily, sent to you, and deleted immediately!`,
      '',
      `Just paste a TikTok link below to try it out! 👇`
    ].join('\n');

    await ctx.reply(welcome, { parse_mode: 'Markdown' });
  });

  // Command: /help
  bot.command('help', async (ctx) => {
    const help = [
      `📖 *SnapTik Bot Help & Usage*`,
      '',
      `*How to download:*`,
      `1. Open TikTok and find a video you want to download.`,
      `2. Tap *Share* ➔ *Copy Link*.`,
      `3. Paste the link into this chat.`,
      '',
      `*Supported Links:*`,
      `✅ Standard video links: \`https://www.tiktok.com/@user/video/...\``,
      `✅ Short links: \`https://vt.tiktok.com/...\` or \`https://vm.tiktok.com/...\``,
      '',
      `*Unsupported Links (will be rejected):*`,
      `❌ TikTok photo carousels / slideshows (\`/photo/...\`)`,
      `❌ TikTok Shop product links (\`shop.tiktok.com\` or \`/product/...\`)`,
      `❌ TikTok Live streams`,
      `❌ Videos longer than 2 minutes (${config.maxDurationSeconds}s)`,
      `❌ Videos larger than ${config.maxFileSizeMB} MB`,
      '',
      `*Commands:*`,
      `• /start - Welcome message and info`,
      `• /limits - Current bot limits & constraints`,
      `• /ping - Check bot response and latency`
    ].join('\n');

    await ctx.reply(help, { parse_mode: 'Markdown' });
  });

  // Command: /limits
  bot.command('limits', async (ctx) => {
    const limits = [
      `⚙️ *Bot Constraints & Limits:*`,
      '',
      `• ⏱️ *Max Video Duration:* 2 minutes (120 seconds)`,
      `• 📦 *Max File Size:* ${config.maxFileSizeMB} MB`,
      `• 📁 *Storage Policy:* Ephemeral local storage (auto-deleted instantly after dispatch)`,
      `• 🛡️ *Validation:* Pre-filtering for non-videos, photos, and products`
    ].join('\n');

    await ctx.reply(limits, { parse_mode: 'Markdown' });
  });

  // Command: /ping
  bot.command('ping', async (ctx) => {
    const start = Date.now();
    const msg = await ctx.reply('🏓 Pong...');
    const latency = Date.now() - start;
    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `🏓 Pong! Latency: *${latency}ms* | Uptime: *${Math.round(process.uptime())}s*`,
      { parse_mode: 'Markdown' }
    );
  });

  // Main message handler for links
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    const urls = extractTikTokUrls(text);

    // If no TikTok URL detected
    if (urls.length === 0) {
      if (ctx.chat.type === 'private') {
        await ctx.reply(
          `👋 Please send a valid *TikTok video link* to download.\n\n_Example:_ \`https://www.tiktok.com/@user/video/123456789\``,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }

    botStats.totalRequests++;
    const targetUrl = urls[0];

    // Show native Telegram upload action immediately
    ctx.replyWithChatAction('upload_video').catch(() => {});

    // Send single lightweight status message
    const statusMsg = await ctx.reply('⚡ Fetching & downloading media...', {
      reply_parameters: { message_id: ctx.message.message_id }
    });

    const chatActionInterval = setInterval(() => {
      ctx.replyWithChatAction('upload_video').catch(() => {});
    }, 4000);

    let downloadedFilePath = null;
    let downloadedPhotoPaths = [];

    try {
      // Step 1: Fast URL & Type Validation
      const validation = validateTikTokVideoUrl(targetUrl);
      if (!validation.isValidMedia) {
        botStats.rejectedNonVideo++;
        logActivity('REJECT_NON_MEDIA', { url: targetUrl, reason: validation.error });
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          validation.error || '❌ Only TikTok video and photo links are supported.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Step 2: Extract media metadata & enforce constraints
      const mediaResult = await getTikTokVideo(validation.resolvedUrl);

      if (!mediaResult.success) {
        if (mediaResult.error.includes('duration')) {
          botStats.rejectedDuration++;
          logActivity('REJECT_DURATION', { url: targetUrl });
        } else if (mediaResult.error.includes('size')) {
          botStats.rejectedSize++;
          logActivity('REJECT_SIZE', { url: targetUrl });
        } else {
          botStats.rejectedNonVideo++;
          logActivity('REJECT_OTHER', { url: targetUrl, error: mediaResult.error });
        }

        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          mediaResult.error,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // PHOTO SLIDESHOW / CAROUSEL HANDLER
      if (mediaResult.mediaType === 'photo') {
        ctx.replyWithChatAction('upload_photo').catch(() => {});
        const photoData = mediaResult.data;

        // Download all photos to local project folder
        downloadedPhotoPaths = await downloadPhotosToLocal(photoData.images, photoData.id);

        if (downloadedPhotoPaths.length === 1) {
          await ctx.replyWithPhoto(new InputFile(downloadedPhotoPaths[0]), {
            reply_parameters: { message_id: ctx.message.message_id }
          });
        } else {
          // Telegram sendMediaGroup accepts 2 to 10 items per group
          for (let i = 0; i < downloadedPhotoPaths.length; i += 10) {
            const batch = downloadedPhotoPaths.slice(i, i + 10);
            if (batch.length === 1) {
              await ctx.replyWithPhoto(new InputFile(batch[0]));
            } else {
              const group = batch.map(fp => ({ type: 'photo', media: new InputFile(fp) }));
              await ctx.replyWithMediaGroup(group, i === 0 ? {
                reply_parameters: { message_id: ctx.message.message_id }
              } : undefined);
            }
          }
        }

        // Remove progress status message
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

        botStats.successfulDownloads++;
        logActivity('DOWNLOAD_SUCCESS', {
          title: (photoData.title || 'Photos').slice(0, 50),
          type: 'photo',
          count: downloadedPhotoPaths.length
        });
        return;
      }

      // VIDEO POST HANDLER
      const videoData = mediaResult.data;

      // Download video file to local/project folder
      const downloadResult = await downloadVideoToLocal(videoData.videoUrl, videoData.id);
      downloadedFilePath = downloadResult.filePath;
      const finalSizeBytes = downloadResult.sizeBytes;

      // Update transfer statistics
      botStats.totalBytesTransferred += finalSizeBytes;

      // Dispatch video directly to Telegram client (no caption text)
      await ctx.replyWithVideo(new InputFile(downloadedFilePath), {
        duration: videoData.duration || undefined,
        supports_streaming: true,
        reply_parameters: { message_id: ctx.message.message_id }
      });

      // Remove progress status message after delivery
      await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

      botStats.successfulDownloads++;
      logActivity('DOWNLOAD_SUCCESS', {
        title: videoData.title.slice(0, 50),
        duration: videoData.durationFormatted,
        size: formatBytes(finalSizeBytes)
      });
    } catch (err) {
      botStats.failedDownloads++;
      logActivity('ERROR', { error: err.message, url: targetUrl });
      console.error('Error handling TikTok download:', err);

      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        `❌ **Download Failed**\n\n${escapeMarkdown(err.message || 'An unexpected error occurred while downloading.')}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } finally {
      clearInterval(chatActionInterval);

      // GUARANTEED CLEANUP: delete the stored video or photos from the local project folder
      if (downloadedFilePath) {
        await deleteLocalFile(downloadedFilePath);
      }
      if (downloadedPhotoPaths && downloadedPhotoPaths.length > 0) {
        await deleteLocalFiles(downloadedPhotoPaths);
      }
    }
  });

  // Global error handler
  bot.catch((err) => {
    console.error('Telegram Bot Error occurred:', err.error || err);
  });

  return bot;
}
