import path from 'node:path';
import fs from 'node:fs';
import youtubedl from 'youtube-dl-exec';
import getFBInfo from '@renpwn/fb-downloader';
import { config } from './config.js';
import { detectPlatform } from './validator.js';
import { getTikTokVideo, formatBytes, formatDuration } from './tiktokService.js';
import { downloadVideoToLocal, deleteLocalFile } from './fileManager.js';

function makePrivateErrorMessage(platformName) {
  const isReel = platformName === 'Instagram' || platformName === 'Facebook';
  const label = isReel ? 'Reel' : 'video';
  return `🔒 **Cannot download this ${platformName} ${label}.**\n\nThis ${label} is not public, restricted, or cannot be seen. The bot can only download public media.`;
}

/**
 * Checks whether an error indicates the media is private, login-required, or deleted
 * @param {string} errorText
 * @returns {boolean}
 */
function isPrivateOrRestrictedError(errorText) {
  const text = (errorText || '').toLowerCase();
  return (
    text.includes('private') ||
    text.includes('login') ||
    text.includes('empty media response') ||
    text.includes('not available') ||
    text.includes('unavailable') ||
    text.includes('cannot parse') ||
    text.includes('not found') ||
    text.includes('404') ||
    text.includes('403') ||
    text.includes('401') ||
    text.includes('restricted') ||
    text.includes('sign in') ||
    text.includes('certain audiences') ||
    text.includes('deleted') ||
    text.includes('permission') ||
    text.includes('authentication') ||
    text.includes('unable to fetch video information') ||
    text.includes('unsupported url') ||
    text.includes('could not find') ||
    text.includes('blocked') ||
    text.includes('protected account') ||
    text.includes('this tweet is from') ||
    text.includes('this post is unavailable') ||
    text.includes('suspended')
  );
}

/**
 * Download and process an Instagram Reel or post
 * @param {string} url
 * @returns {Promise<any>}
 */
export async function getInstagramReel(url) {
  try {
    // 1. Fetch metadata first to verify accessibility and duration
    let info = null;
    try {
      info = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCallHome: true
      });
    } catch (metaErr) {
      const errStr = (metaErr.stderr || metaErr.message || '');
      if (isPrivateOrRestrictedError(errStr)) {
        return {
          success: false,
          isPrivate: true,
          error: makePrivateErrorMessage('Instagram')
        };
      }
      throw metaErr;
    }

    if (!info) {
      return {
        success: false,
        isPrivate: true,
        error: makePrivateErrorMessage('Instagram')
      };
    }

    // 2. Validate duration (< 2 mins / 120s)
    const duration = info.duration || 0;
    if (duration > 0 && duration > config.maxDurationSeconds) {
      return {
        success: false,
        error: `⚠️ **Video duration exceeds limit!**\n\n` +
               `⏱️ Video length: **${formatDuration(duration)}**\n` +
               `⛔ Allowed limit: **< ${formatDuration(config.maxDurationSeconds)}** (2 minutes)\n\n` +
               `Please submit a shorter Reel.`
      };
    }

    // 3. Download directly to local downloads folder
    const safeId = (info.id || Date.now()).toString().replace(/[^a-zA-Z0-9_-]/g, '_');
    const localFilePath = path.join(config.downloadsDir, `ig_${safeId}_${Date.now()}.mp4`);

    await youtubedl(url, {
      output: localFilePath,
      format: 'best[ext=mp4]/best',
      noPlaylist: true
    });

    if (!fs.existsSync(localFilePath)) {
      throw new Error('Downloaded Instagram video file was not created.');
    }

    const stat = await fs.promises.stat(localFilePath);
    if (stat.size > config.maxFileSizeBytes) {
      await deleteLocalFile(localFilePath);
      return {
        success: false,
        error: `⚠️ **Video file size exceeds limit!**\n\n` +
               `📦 Size: **${formatBytes(stat.size)}**\n` +
               `⛔ Allowed limit: **${config.maxFileSizeMB} MB**`
      };
    }

    return {
      success: true,
      platform: 'instagram',
      mediaType: 'video',
      data: {
        id: safeId,
        title: info.title || 'Instagram Reel',
        filePath: localFilePath,
        sizeBytes: stat.size,
        duration: Math.round(duration)
      }
    };
  } catch (err) {
    const errStr = (err.stderr || err.message || '');
    if (isPrivateOrRestrictedError(errStr)) {
      return {
        success: false,
        isPrivate: true,
        error: makePrivateErrorMessage('Instagram')
      };
    }

    return {
      success: false,
      isPrivate: true,
      error: makePrivateErrorMessage('Instagram')
    };
  }
}

/**
 * Download and process a Facebook Reel or video
 * @param {string} url
 * @returns {Promise<any>}
 */
export async function getFacebookReel(url) {
  // Method 1: Fast direct extraction via @renpwn/fb-downloader
  try {
    const fbInfo = await getFBInfo(url);
    const streamUrl = fbInfo.sd || fbInfo.hd;

    if (streamUrl) {
      const downloadResult = await downloadVideoToLocal(streamUrl, 'fb_' + Date.now());
      return {
        success: true,
        platform: 'facebook',
        mediaType: 'video',
        data: {
          id: Date.now().toString(),
          title: fbInfo.title || 'Facebook Reel',
          filePath: downloadResult.filePath,
          sizeBytes: downloadResult.sizeBytes,
          duration: 0
        }
      };
    }
  } catch (fbErr) {
    // If fast method fails, try yt-dlp fallback
  }

  // Method 2: yt-dlp fallback
  try {
    let info = null;
    try {
      info = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCallHome: true
      });
    } catch (metaErr) {
      const errStr = (metaErr.stderr || metaErr.message || '');
      if (isPrivateOrRestrictedError(errStr)) {
        return {
          success: false,
          isPrivate: true,
          error: makePrivateErrorMessage('Facebook')
        };
      }
      throw metaErr;
    }

    if (!info) {
      return {
        success: false,
        isPrivate: true,
        error: makePrivateErrorMessage('Facebook')
      };
    }

    // Validate duration (< 2 mins / 120s)
    const duration = info.duration || 0;
    if (duration > 0 && duration > config.maxDurationSeconds) {
      return {
        success: false,
        error: `⚠️ **Video duration exceeds limit!**\n\n` +
               `⏱️ Video length: **${formatDuration(duration)}**\n` +
               `⛔ Allowed limit: **< ${formatDuration(config.maxDurationSeconds)}** (2 minutes)\n\n` +
               `Please submit a shorter Reel.`
      };
    }

    const safeId = (info.id || Date.now()).toString().replace(/[^a-zA-Z0-9_-]/g, '_');
    const localFilePath = path.join(config.downloadsDir, `fb_${safeId}_${Date.now()}.mp4`);

    await youtubedl(url, {
      output: localFilePath,
      format: 'best[ext=mp4]/best',
      noPlaylist: true
    });

    if (!fs.existsSync(localFilePath)) {
      throw new Error('Downloaded Facebook video file was not created.');
    }

    const stat = await fs.promises.stat(localFilePath);
    if (stat.size > config.maxFileSizeBytes) {
      await deleteLocalFile(localFilePath);
      return {
        success: false,
        error: `⚠️ **Video file size exceeds limit!**\n\n` +
               `📦 Size: **${formatBytes(stat.size)}**\n` +
               `⛔ Allowed limit: **${config.maxFileSizeMB} MB**`
      };
    }

    return {
      success: true,
      platform: 'facebook',
      mediaType: 'video',
      data: {
        id: safeId,
        title: info.title || 'Facebook Reel',
        filePath: localFilePath,
        sizeBytes: stat.size,
        duration: Math.round(duration)
      }
    };
  } catch (err) {
    const errStr = (err.stderr || err.message || '');
    if (isPrivateOrRestrictedError(errStr)) {
      return {
        success: false,
        isPrivate: true,
        error: makePrivateErrorMessage('Facebook')
      };
    }

    return {
      success: false,
      isPrivate: true,
      error: makePrivateErrorMessage('Facebook')
    };
  }
}

/**
 * Download and process an X (Twitter) video post
 * @param {string} url
 * @returns {Promise<any>}
 */
export async function getTwitterVideo(url) {
  try {
    // 1. Fetch metadata first to verify accessibility and duration
    let info = null;
    try {
      info = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCallHome: true
      });
    } catch (metaErr) {
      const errStr = (metaErr.stderr || metaErr.message || '');
      if (errStr.includes('No video could be found')) {
        return {
          success: false,
          isNoVideo: true,
          error: '❌ **No video found in this X (Twitter) post!**\n\nPlease submit an X/Twitter link containing a video.'
        };
      }
      if (isPrivateOrRestrictedError(errStr)) {
        return {
          success: false,
          isPrivate: true,
          error: makePrivateErrorMessage('X (Twitter)')
        };
      }
      throw metaErr;
    }

    if (!info) {
      return {
        success: false,
        isPrivate: true,
        error: makePrivateErrorMessage('X (Twitter)')
      };
    }

    // 2. Validate duration (< 2 mins / 120s)
    const duration = info.duration || 0;
    if (duration > 0 && duration > config.maxDurationSeconds) {
      return {
        success: false,
        error: `⚠️ **Video duration exceeds limit!**\n\n` +
               `⏱️ Video length: **${formatDuration(duration)}**\n` +
               `⛔ Allowed limit: **< ${formatDuration(config.maxDurationSeconds)}** (2 minutes)\n\n` +
               `Please submit a shorter video.`
      };
    }

    // 3. Download directly to local downloads folder
    const safeId = (info.id || Date.now()).toString().replace(/[^a-zA-Z0-9_-]/g, '_');
    const localFilePath = path.join(config.downloadsDir, `x_${safeId}_${Date.now()}.mp4`);

    await youtubedl(url, {
      output: localFilePath,
      format: 'best[ext=mp4]/best',
      noPlaylist: true
    });

    if (!fs.existsSync(localFilePath)) {
      throw new Error('Downloaded X (Twitter) video file was not created.');
    }

    const stat = await fs.promises.stat(localFilePath);
    if (stat.size > config.maxFileSizeBytes) {
      await deleteLocalFile(localFilePath);
      return {
        success: false,
        error: `⚠️ **Video file size exceeds limit!**\n\n` +
               `📦 Size: **${formatBytes(stat.size)}**\n` +
               `⛔ Allowed limit: **${config.maxFileSizeMB} MB**`
      };
    }

    return {
      success: true,
      platform: 'twitter',
      mediaType: 'video',
      data: {
        id: safeId,
        title: info.title || 'X (Twitter) Video',
        filePath: localFilePath,
        sizeBytes: stat.size,
        duration: Math.round(duration)
      }
    };
  } catch (err) {
    const errStr = (err.stderr || err.message || '');
    if (errStr.includes('No video could be found')) {
      return {
        success: false,
        isNoVideo: true,
        error: '❌ **No video found in this X (Twitter) post!**\n\nPlease submit an X/Twitter link containing a video.'
      };
    }
    if (isPrivateOrRestrictedError(errStr)) {
      return {
        success: false,
        isPrivate: true,
        error: makePrivateErrorMessage('X (Twitter)')
      };
    }

    return {
      success: false,
      isPrivate: true,
      error: makePrivateErrorMessage('X (Twitter)')
    };
  }
}

/**
 * Universal media fetcher routing to TikTok, Instagram, Facebook, or X (Twitter)
 * @param {string} url
 * @returns {Promise<any>}
 */
export async function fetchUniversalMedia(url) {
  const platform = detectPlatform(url);

  if (platform === 'tiktok') {
    const res = await getTikTokVideo(url);
    return {
      ...res,
      platform: 'tiktok'
    };
  }

  if (platform === 'instagram') {
    return await getInstagramReel(url);
  }

  if (platform === 'facebook') {
    return await getFacebookReel(url);
  }

  if (platform === 'twitter') {
    return await getTwitterVideo(url);
  }

  return {
    success: false,
    platform: 'unknown',
    error: '❌ Unsupported platform. Only TikTok, Instagram Reels, Facebook Reels, and X (Twitter) videos are supported.'
  };
}
