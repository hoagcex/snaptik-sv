import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import youtubedl from 'youtube-dl-exec';
import getFBInfo from '@renpwn/fb-downloader';
import { config } from './config.js';
import { detectPlatform } from './validator.js';
import { getTikTokVideo, formatBytes, formatDuration } from './tiktokService.js';
import { downloadVideoToLocal, deleteLocalFile } from './fileManager.js';

const execFileAsync = promisify(execFile);

/**
 * Splits a large video (> Telegram upload limit) into stream-copied MP4 segments
 * that each fit under the Telegram Bot API limit using ffmpeg (zero re-encoding).
 *
 * @param {string} inputPath
 * @param {number} totalSizeBytes
 * @param {number} durationSec
 * @returns {Promise<Array<{ filePath: string, sizeBytes: number }>>}
 */
export async function splitLargeVideoForTelegram(inputPath, totalSizeBytes, durationSec = 0) {
  const maxBytes = config.telegramUploadLimitBytes;
  if (totalSizeBytes <= maxBytes) {
    return [{ filePath: inputPath, sizeBytes: totalSizeBytes }];
  }

  // Target ~45MB per part so keyframe boundaries never push a segment over 50MB
  const targetPartBytes = Math.floor(maxBytes * 0.88);
  const numParts = Math.max(2, Math.ceil(totalSizeBytes / targetPartBytes));
  const segmentSec = durationSec > 0
    ? Math.max(5, Math.floor(durationSec / numParts))
    : 30;

  const parsed = path.parse(inputPath);
  const pattern = path.join(parsed.dir, `${parsed.name}_part%03d${parsed.ext}`);

  try {
    await execFileAsync('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', inputPath,
      '-c', 'copy',
      '-map', '0',
      '-f', 'segment',
      '-segment_time', String(segmentSec),
      '-reset_timestamps', '1',
      pattern
    ]);

    const allFiles = await fs.promises.readdir(parsed.dir);
    const partPrefix = `${parsed.name}_part`;
    const partNames = allFiles
      .filter(f => f.startsWith(partPrefix) && f.endsWith(parsed.ext))
      .sort();

    if (partNames.length === 0) {
      return [{ filePath: inputPath, sizeBytes: totalSizeBytes }];
    }

    const parts = [];
    for (const name of partNames) {
      const fullPath = path.join(parsed.dir, name);
      const st = await fs.promises.stat(fullPath);
      parts.push({ filePath: fullPath, sizeBytes: st.size });
    }
    return parts;
  } catch {
    // shortcut: requires ffmpeg in PATH to split >50MB files on official Bot API; falls back to single file if missing
    return [{ filePath: inputPath, sizeBytes: totalSizeBytes }];
  }
}

/**
 * Picks a direct progressive MP4 HTTP URL from yt-dlp info that fits within maxFileSizeBytes
 */
function pickDirectStreamFromInfo(info) {
  if (info.url && (info.ext === 'mp4' || info.url.includes('.mp4')) && info.protocol?.startsWith('http')) {
    const size = info.filesize || info.filesize_approx || 0;
    if (size === 0 || size <= config.maxFileSizeBytes) {
      return { videoUrl: info.url, sizeBytes: size, headers: info.http_headers || {} };
    }
  }
  if (!Array.isArray(info.formats)) return null;

  const mp4Candidates = info.formats.filter(f =>
    f.url &&
    f.ext === 'mp4' &&
    f.vcodec && f.vcodec !== 'none' &&
    f.acodec && f.acodec !== 'none' &&
    (!f.protocol || f.protocol === 'https' || f.protocol === 'http')
  );

  if (mp4Candidates.length === 0) return null;

  // Sort by quality/tbr descending, preferring candidates within maxFileSizeBytes
  mp4Candidates.sort((a, b) => (b.tbr || b.filesize || 0) - (a.tbr || a.filesize || 0));
  const fitting = mp4Candidates.find(f => {
    const sz = f.filesize || f.filesize_approx || 0;
    return sz === 0 || sz <= config.telegramUploadLimitBytes;
  }) || mp4Candidates.find(f => {
    const sz = f.filesize || f.filesize_approx || 0;
    return sz === 0 || sz <= config.maxFileSizeBytes;
  }) || mp4Candidates[mp4Candidates.length - 1];

  return {
    videoUrl: fitting.url,
    sizeBytes: fitting.filesize || fitting.filesize_approx || 0,
    headers: fitting.http_headers || info.http_headers || {}
  };
}

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

    // 2. Validate duration (< config.maxDurationSeconds)
    const duration = info.duration || 0;
    if (duration > 0 && duration > config.maxDurationSeconds) {
      return {
        success: false,
        error: `⚠️ **Video duration exceeds limit!**\n\n` +
               `⏱️ Video length: **${formatDuration(duration)}**\n` +
               `⛔ Allowed limit: **< ${formatDuration(config.maxDurationSeconds)}**\n\n` +
               `Please submit a shorter Reel.`
      };
    }

    const safeId = (info.id || Date.now()).toString().replace(/[^a-zA-Z0-9_-]/g, '_');

    // Fast path: if yt-dlp already resolved a direct progressive MP4 stream within Telegram's limit, stream directly
    const directStream = pickDirectStreamFromInfo(info);
    if (directStream && directStream.videoUrl && (directStream.sizeBytes === 0 || directStream.sizeBytes <= config.telegramUploadLimitBytes)) {
      return {
        success: true,
        platform: 'instagram',
        mediaType: 'video',
        data: {
          id: safeId,
          title: info.title || 'Instagram Reel',
          videoUrl: directStream.videoUrl,
          sizeBytes: directStream.sizeBytes,
          headers: directStream.headers,
          duration: Math.round(duration)
        }
      };
    }

    // 3. Fallback: Download directly to local downloads folder (e.g. HLS/DASH or >50MB requiring split)
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
      return {
        success: true,
        platform: 'facebook',
        mediaType: 'video',
        data: {
          id: Date.now().toString(),
          title: fbInfo.title || 'Facebook Reel',
          videoUrl: streamUrl,
          sizeBytes: 0,
          duration: fbInfo.duration_ms ? Math.round(fbInfo.duration_ms / 1000) : 0
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

    // Validate duration (< config.maxDurationSeconds)
    const duration = info.duration || 0;
    if (duration > 0 && duration > config.maxDurationSeconds) {
      return {
        success: false,
        error: `⚠️ **Video duration exceeds limit!**\n\n` +
               `⏱️ Video length: **${formatDuration(duration)}**\n` +
               `⛔ Allowed limit: **< ${formatDuration(config.maxDurationSeconds)}**\n\n` +
               `Please submit a shorter Reel.`
      };
    }

    const safeId = (info.id || Date.now()).toString().replace(/[^a-zA-Z0-9_-]/g, '_');

    const directStream = pickDirectStreamFromInfo(info);
    if (directStream && directStream.videoUrl && (directStream.sizeBytes === 0 || directStream.sizeBytes <= config.telegramUploadLimitBytes)) {
      return {
        success: true,
        platform: 'facebook',
        mediaType: 'video',
        data: {
          id: safeId,
          title: info.title || 'Facebook Reel',
          videoUrl: directStream.videoUrl,
          sizeBytes: directStream.sizeBytes,
          headers: directStream.headers,
          duration: Math.round(duration)
        }
      };
    }

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
  const tweetIdMatch = url.match(/\/status\/(\d+)/i);
  const tweetId = tweetIdMatch ? tweetIdMatch[1] : null;

  // Method 1: Fast direct extraction via FixTweet / FxTwitter API (handles sensitive/NSFW tweets without login)
  if (tweetId) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const apiUrl = `https://api.fxtwitter.com/status/${tweetId}`;
      const res = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (data.code === 200 && data.tweet) {
          const videos = data.tweet.media?.videos;
          if (videos && Array.isArray(videos) && videos.length > 0) {
            const video = videos[0];
            const duration = video.duration || 0;

            // Validate duration (< config.maxDurationSeconds)
            if (duration > 0 && duration > config.maxDurationSeconds) {
              return {
                success: false,
                error: `⚠️ **Video duration exceeds limit!**\n\n` +
                       `⏱️ Video length: **${formatDuration(duration)}**\n` +
                       `⛔ Allowed limit: **< ${formatDuration(config.maxDurationSeconds)}**\n\n` +
                       `Please submit a shorter video.`
              };
            }

            // Pick highest bitrate MP4 variant
            let streamUrl = video.url;
            if (video.variants && Array.isArray(video.variants)) {
              const mp4s = video.variants.filter(v => v.content_type === 'video/mp4' && v.url);
              if (mp4s.length > 0) {
                mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                streamUrl = mp4s[0].url;
              }
            }

            return {
              success: true,
              platform: 'twitter',
              mediaType: 'video',
              data: {
                id: tweetId,
                title: data.tweet.text || 'X (Twitter) Video',
                videoUrl: streamUrl,
                sizeBytes: 0,
                duration: Math.round(duration)
              }
            };
          } else {
            // Post exists but has no videos (text, photos only)
            return {
              success: false,
              isNoVideo: true,
              error: '❌ **No video found in this X (Twitter) post!**\n\nPlease submit an X/Twitter link containing a video.'
            };
          }
        } else if (data.code === 401 || data.code === 403 || data.message?.includes('PRIVATE') || data.message?.includes('PROTECTED')) {
          return {
            success: false,
            isPrivate: true,
            error: makePrivateErrorMessage('X (Twitter)')
          };
        } else if (data.code === 404) {
          return {
            success: false,
            isPrivate: true,
            error: makePrivateErrorMessage('X (Twitter)')
          };
        }
      }
    } catch (fxErr) {
      // If primary method fails or times out, fall through to yt-dlp fallback
    }
  }

  // Method 2: yt-dlp fallback
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

    // 2. Validate duration (< config.maxDurationSeconds)
    const duration = info.duration || 0;
    if (duration > 0 && duration > config.maxDurationSeconds) {
      return {
        success: false,
        error: `⚠️ **Video duration exceeds limit!**\n\n` +
               `⏱️ Video length: **${formatDuration(duration)}**\n` +
               `⛔ Allowed limit: **< ${formatDuration(config.maxDurationSeconds)}**\n\n` +
               `Please submit a shorter video.`
      };
    }

    const safeId = (info.id || tweetId || Date.now()).toString().replace(/[^a-zA-Z0-9_-]/g, '_');

    const directStream = pickDirectStreamFromInfo(info);
    if (directStream && directStream.videoUrl && (directStream.sizeBytes === 0 || directStream.sizeBytes <= config.telegramUploadLimitBytes)) {
      return {
        success: true,
        platform: 'twitter',
        mediaType: 'video',
        data: {
          id: safeId,
          title: info.title || 'X (Twitter) Video',
          videoUrl: directStream.videoUrl,
          sizeBytes: directStream.sizeBytes,
          headers: directStream.headers,
          duration: Math.round(duration)
        }
      };
    }

    // 3. Download directly to local downloads folder
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
