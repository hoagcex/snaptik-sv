import { Bot, InputFile } from 'grammy';
import { config } from './config.js';
import { extractMediaUrls, validateMediaUrl, detectPlatform } from './validator.js';
import { formatBytes, formatDuration } from './tiktokService.js';
import { fetchUniversalMedia } from './mediaService.js';
import { downloadVideoToLocal, downloadPhotosToLocal, deleteLocalFile, deleteLocalFiles } from './fileManager.js';

// Live statistics for Express dashboard
export const botStats = {
  startedAt: new Date(),
  totalRequests: 0,
  successfulDownloads: 0,
  rejectedDuration: 0,
  rejectedSize: 0,
  rejectedNonVideo: 0,
  rejectedPrivate: 0,
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

  const botOptions = {};
  if (config.telegramApiRoot) {
    botOptions.client = {
      apiRoot: config.telegramApiRoot
    };
  }

  const bot = new Bot(config.botToken, botOptions);

  // Command: /start
  bot.command('start', async (ctx) => {
    const welcome = [
      `👋 *Hello ${ctx.from?.first_name || 'there'}!*`,
      '',
      `Welcome to *SnapTik & Media Downloader Bot* 📥`,
      `Send me any link to a:`,
      `• 🎬 *TikTok Video* (no watermark) or *Photo Slideshow*`,
      `• 📸 *Instagram Reel* or Video`,
      `• 👥 *Facebook Reel* or Video`,
      `• 🐦 *X (Twitter) Video*`,
      '',
      `⚡ *Download Rules & Limits:*`,
      `• ⏱️ *Max Duration:* Under 2 minutes (< 120s)`,
      `• 📦 *Max File Size:* ${config.maxFileSizeMB} MB`,
      `• 🔒 *Public Media Only:* Private, friends-only, or restricted posts cannot be downloaded.`,
      `• 🧹 *Auto-Cleanup:* Videos are saved to the server temporarily, sent to you, and deleted immediately!`,
      '',
      `Just paste a link below to try it out! 👇`
    ].join('\n');

    await ctx.reply(welcome, { parse_mode: 'Markdown' });
  });

  // Command: /help
  bot.command('help', async (ctx) => {
    const help = [
      `📖 *Downloader Bot Help & Usage*`,
      '',
      `*How to download:*`,
      `1. Find a video or Reel on TikTok, Instagram, Facebook, or X (Twitter).`,
      `2. Tap *Share* ➔ *Copy Link*.`,
      `3. Paste the link into this chat.`,
      '',
      `*Supported Platforms:*`,
      `✅ *TikTok:* Videos without watermark & photo slideshows`,
      `✅ *Instagram:* Public Reels & video posts`,
      `✅ *Facebook:* Public Reels & videos`,
      `✅ *X (Twitter):* Public video posts`,
      '',
      `*Unsupported Links (will be rejected):*`,
      `❌ Non-public or restricted posts (cannot be seen)`,
      `❌ TikTok Shop products or Live streams`,
      `❌ Instagram or Facebook Stories`,
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
      `• 🔒 *Privacy Policy:* Only public videos and Reels are downloadable`,
      `• 🛡️ *Validation:* Pre-filtering for profiles, stories, products, and private media`
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
    const urls = extractMediaUrls(text);

    // If no supported URL detected
    if (urls.length === 0) {
      if (ctx.chat.type === 'private') {
        await ctx.reply(
          `👋 Please send a valid *TikTok*, *Instagram Reel*, *Facebook Reel*, or *X (Twitter)* link.\n\n` +
          `_Examples:_\n` +
          `• TikTok: \`https://vt.tiktok.com/ZS4w1xnNH/\`\n` +
          `• Instagram: \`https://www.instagram.com/reel/C3bXYZ/\`\n` +
          `• Facebook: \`https://www.facebook.com/reel/123456789/\`\n` +
          `• X (Twitter): \`https://x.com/user/status/123456789\``,
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
      const validation = validateMediaUrl(targetUrl);
      if (!validation.isValidMedia) {
        botStats.rejectedNonVideo++;
        logActivity('REJECT_NON_MEDIA', { url: targetUrl, reason: validation.error });
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          validation.error || '❌ Only TikTok, Instagram Reels, Facebook Reels, and X (Twitter) videos are supported.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Step 2: Extract media metadata & enforce constraints
      const mediaResult = await fetchUniversalMedia(validation.resolvedUrl);

      if (!mediaResult.success) {
        if (mediaResult.isPrivate) {
          botStats.rejectedPrivate++;
          logActivity('REJECT_PRIVATE', { url: targetUrl, platform: mediaResult.platform });
        } else if (mediaResult.error?.includes('duration')) {
          botStats.rejectedDuration++;
          logActivity('REJECT_DURATION', { url: targetUrl });
        } else if (mediaResult.error?.includes('size')) {
          botStats.rejectedSize++;
          logActivity('REJECT_SIZE', { url: targetUrl });
        } else {
          botStats.rejectedNonVideo++;
          logActivity('REJECT_OTHER', { url: targetUrl, error: mediaResult.error });
        }

        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          mediaResult.error || '❌ Cannot download media.',
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
          platform: mediaResult.platform,
          type: 'photo',
          count: downloadedPhotoPaths.length
        });
        return;
      }

      // VIDEO POST / REEL HANDLER
      const videoData = mediaResult.data;
      let finalSizeBytes = 0;

      // Handle video already downloaded directly to disk vs direct stream URL
      if (videoData.filePath) {
        downloadedFilePath = videoData.filePath;
        finalSizeBytes = videoData.sizeBytes || 0;
      } else if (videoData.videoUrl) {
        const downloadResult = await downloadVideoToLocal(videoData.videoUrl, videoData.id);
        downloadedFilePath = downloadResult.filePath;
        finalSizeBytes = downloadResult.sizeBytes;
      } else {
        throw new Error('No downloadable video file or stream URL found.');
      }

      // Enforce Telegram Bot API upload limit (50MB on official cloud server)
      if (finalSizeBytes > config.telegramUploadLimitBytes) {
        botStats.rejectedSize++;
        logActivity('REJECT_SIZE', { url: targetUrl, size: finalSizeBytes });
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `⚠️ **Video exceeds Telegram's ${config.telegramUploadLimitMB} MB upload limit!**\n\n` +
          `📦 Video size: **${formatBytes(finalSizeBytes)}**\n` +
          `⛔ Telegram limit: **${config.telegramUploadLimitMB} MB**\n\n` +
          `Telegram's official cloud servers reject any bot file upload larger than **50 MB** (\`413 Request Entity Too Large\`).` +
          (!config.isLocalBotApi && config.maxFileSizeMB > 50
            ? `\n\n💡 *Note:* Even though \`MAX_FILE_SIZE_MB=${config.maxFileSizeMB}\` is set in \`.env\`, Telegram's official cloud servers will not accept uploads over 50 MB unless connected to a self-hosted Telegram Bot API server.`
            : ''),
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Update transfer statistics
      botStats.totalBytesTransferred += finalSizeBytes;

      // Dispatch video directly to Telegram client (strictly no caption text per user instructions)
      await ctx.replyWithVideo(new InputFile(downloadedFilePath), {
        duration: videoData.duration || undefined,
        supports_streaming: true,
        reply_parameters: { message_id: ctx.message.message_id }
      });

      // Remove progress status message after delivery
      await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

      botStats.successfulDownloads++;
      logActivity('DOWNLOAD_SUCCESS', {
        title: (videoData.title || 'Video').slice(0, 50),
        platform: mediaResult.platform,
        duration: videoData.durationFormatted || `${videoData.duration || 0}s`,
        size: formatBytes(finalSizeBytes)
      });
    } catch (err) {
      botStats.failedDownloads++;
      logActivity('ERROR', { error: err.message, url: targetUrl });
      console.error('Error handling media download:', err);

      let errorMessage = `❌ **Download Failed**\n\n${escapeMarkdown(err.message || 'An unexpected error occurred while downloading.')}`;
      if (err.error_code === 413 || err.description?.includes('Request Entity Too Large') || err.message?.includes('413')) {
        errorMessage = `⚠️ **File size exceeds Telegram's limit!**\n\n` +
          `📦 Video size: **${formatBytes(finalSizeBytes || 0)}**\n` +
          `⛔ Telegram Cloud Limit: **50 MB**\n\n` +
          `Telegram's official Bot API server strictly rejected this upload with error \`413 Request Entity Too Large\`.\n` +
          `Telegram restricts all bot file uploads on its cloud servers to a maximum of **50 MB**.`;
      }

      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        errorMessage,
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
