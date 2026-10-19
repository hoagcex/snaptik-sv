import { config } from './config.js';
import tobygDl from '@tobyg74/tiktok-api-dl';

const { Downloader } = tobygDl;

/**
 * Format seconds into human readable duration string (e.g. '1m 24s' or '45s')
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatDuration(totalSeconds) {
  const sec = Math.round(totalSeconds);
  const minutes = Math.floor(sec / 60);
  const remainingSeconds = sec % 60;
  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }
  return `${minutes}m ${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}s`;
}

/**
 * Format bytes into human readable string (e.g. '15.4 MB')
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return 'Unknown size';
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Fetch video info from TikWM API
 * @param {string} url
 * @returns {Promise<any>}
 */
async function fetchFromTikWM(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch('https://www.tikwm.com/api/', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: new URLSearchParams({
        url: url
      })
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`TikWM HTTP error: ${res.status}`);
    }

    const data = await res.json();
    if (data.code !== 0 || !data.data) {
      throw new Error(data.msg || 'TikWM returned non-zero code');
    }

    return data.data;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Fetch video info using @tobyg74/tiktok-api-dl (v1 or v2 fallback)
 * @param {string} url
 * @param {'v1' | 'v2'} version
 * @returns {Promise<any>}
 */
async function fetchFromTobyG74(url, version = 'v1') {
  const result = await Downloader(url, { version });
  if (result.status !== 'success' || !result.result) {
    throw new Error(result.message || `Downloader ${version} failed`);
  }
  return result.result;
}

/**
 * Main service to extract TikTok video info with validation against:
 * 1. Photo posts / slideshows (rejected)
 * 2. Non-videos (rejected)
 * 3. Video duration (< 2 mins / maxDurationSeconds)
 * 4. Video file size (<= maxFileSizeBytes)
 *
 * @param {string} tiktokUrl
 * @returns {Promise<{
 *   success: boolean,
 *   data?: {
 *     id: string,
 *     title: string,
 *     author: { name: string, username: string },
 *     duration: number,
 *     durationFormatted: string,
 *     sizeBytes: number,
 *     sizeFormatted: string,
 *     videoUrl: string,
 *     coverUrl?: string
 *   },
 *   error?: string
 * }>}
 */
export async function getTikTokVideo(tiktokUrl) {
  let videoData = null;
  let source = '';

  // 1. Try Primary: TikWM API
  try {
    const tikwm = await fetchFromTikWM(tiktokUrl);
    source = 'TikWM';

    // Check if it is a photo slideshow
    if (tikwm.images && Array.isArray(tikwm.images) && tikwm.images.length > 0) {
      return {
        success: true,
        mediaType: 'photo',
        data: {
          id: tikwm.id || Date.now().toString(),
          title: tikwm.title || 'TikTok Photos',
          author: {
            name: tikwm.author?.nickname || 'Unknown Author',
            username: tikwm.author?.unique_id || 'unknown'
          },
          images: tikwm.images,
          imageCount: tikwm.images.length,
          source
        }
      };
    }

    const videoUrl = tikwm.play || tikwm.hdplay;
    if (!videoUrl) {
      return {
        success: false,
        error: '❌ **No video stream found for this TikTok link.**\n\nMake sure the video is public and available.'
      };
    }

    const duration = tikwm.duration || 0;
    const size = tikwm.size || tikwm.hd_size || 0;

    videoData = {
      id: tikwm.id || Date.now().toString(),
      title: tikwm.title || 'TikTok Video',
      author: {
        name: tikwm.author?.nickname || 'Unknown Author',
        username: tikwm.author?.unique_id || 'unknown'
      },
      duration,
      sizeBytes: size,
      videoUrl,
      coverUrl: tikwm.cover || tikwm.origin_cover || ''
    };
  } catch (primaryErr) {
    // 2. Try Secondary Fallback: Downloader v1
    try {
      const v1 = await fetchFromTobyG74(tiktokUrl, 'v1');
      source = 'TiktokAPI-v1';

      if (v1.type === 'image' || (v1.images && v1.images.length > 0)) {
        return {
          success: true,
          mediaType: 'photo',
          data: {
            id: v1.id || Date.now().toString(),
            title: v1.desc || 'TikTok Photos',
            author: {
              name: v1.author?.nickname || 'Unknown Author',
              username: v1.author?.uniqueId || 'unknown'
            },
            images: v1.images || [],
            imageCount: (v1.images || []).length,
            source
          }
        };
      }

      const videoUrl = v1.video?.playAddr?.[0] || v1.video?.downloadAddr?.[0];
      if (!videoUrl) {
        return {
          success: false,
          error: '❌ **No video stream found for this TikTok link.**'
        };
      }

      // v1 duration is in milliseconds
      const durationMs = v1.video?.duration || 0;
      const durationSec = Math.round(durationMs / 1000);

      videoData = {
        id: v1.id || Date.now().toString(),
        title: v1.desc || 'TikTok Video',
        author: {
          name: v1.author?.nickname || 'Unknown Author',
          username: v1.author?.uniqueId || 'unknown'
        },
        duration: durationSec,
        sizeBytes: 0, // Not provided directly in v1 metadata; will be checked upon download
        videoUrl,
        coverUrl: v1.video?.cover?.[0] || ''
      };
    } catch (secondaryErr) {
      // 3. Try Tertiary Fallback: Downloader v2 (SSSTik)
      try {
        const v2 = await fetchFromTobyG74(tiktokUrl, 'v2');
        source = 'SSSTik-v2';

        if (v2.type === 'image' || (v2.images && v2.images.length > 0)) {
          return {
            success: false,
            error: '❌ **TikTok Photo slideshow detected!**\n\nThis bot only downloads TikTok videos.'
          };
        }

        const videoUrl = v2.video?.playAddr?.[0];
        if (!videoUrl) {
          return {
            success: false,
            error: '❌ **Could not retrieve video stream from TikTok.**'
          };
        }

        videoData = {
          id: Date.now().toString(),
          title: v2.desc || 'TikTok Video',
          author: {
            name: v2.author?.nickname || 'Unknown Author',
            username: 'unknown'
          },
          duration: 0,
          sizeBytes: 0,
          videoUrl,
          coverUrl: ''
        };
      } catch (tertiaryErr) {
        return {
          success: false,
          error: `❌ **Failed to retrieve TikTok video.**\n\n${primaryErr.message || 'Please verify the URL and try again.'}`
        };
      }
    }
  }

  // --- Validate Duration Limit (< 2 mins / config.maxDurationSeconds) ---
  if (videoData.duration > 0 && videoData.duration > config.maxDurationSeconds) {
    return {
      success: false,
      error: `⚠️ **Video duration exceeds limit!**\n\n` +
             `⏱️ Video length: **${formatDuration(videoData.duration)}**\n` +
             `⛔ Allowed limit: **< ${formatDuration(config.maxDurationSeconds)}** (2 minutes)\n\n` +
             `Please submit a shorter TikTok video.`
    };
  }

  // --- Validate File Size Limit if reported upfront ---
  if (videoData.sizeBytes > 0 && videoData.sizeBytes > config.maxFileSizeBytes) {
    return {
      success: false,
      error: `⚠️ **Video file size exceeds limit!**\n\n` +
             `📦 Estimated size: **${formatBytes(videoData.sizeBytes)}**\n` +
             `⛔ Allowed limit: **${config.maxFileSizeMB} MB**\n\n` +
             `Telegram restricts bot uploads to ${config.maxFileSizeMB} MB.`
    };
  }

  return {
    success: true,
    mediaType: 'video',
    data: {
      ...videoData,
      durationFormatted: formatDuration(videoData.duration),
      sizeFormatted: formatBytes(videoData.sizeBytes),
      source
    }
  };
}
