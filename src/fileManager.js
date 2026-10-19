import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { formatBytes } from './tiktokService.js';

/**
 * Downloads a video from a direct URL and saves it to the local project downloads directory.
 * Includes real-time size limit enforcement during streaming.
 *
 * @param {string} videoUrl Direct video CDN URL
 * @param {string} videoId Unique TikTok ID for filename
 * @returns {Promise<{ filePath: string, sizeBytes: number }>}
 */
export async function downloadVideoToLocal(videoUrl, videoId = 'video', customHeaders = {}) {
  // Generate safe unique filename in local project downloads folder
  const safeId = String(videoId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `media_${safeId}_${Date.now()}.mp4`;
  const filePath = path.join(config.downloadsDir, fileName);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s download timeout

  let defaultReferer = 'https://www.tiktok.com/';
  if (videoUrl.includes('twimg.com') || videoUrl.includes('twitter.com') || videoUrl.includes('x.com')) {
    defaultReferer = 'https://x.com/';
  } else if (videoUrl.includes('fbcdn.net') || videoUrl.includes('facebook.com')) {
    defaultReferer = 'https://www.facebook.com/';
  } else if (videoUrl.includes('cdninstagram.com') || videoUrl.includes('instagram.com')) {
    defaultReferer = 'https://www.instagram.com/';
  }

  try {
    const response = await fetch(videoUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Referer': defaultReferer,
        ...customHeaders
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Failed to fetch video stream: HTTP ${response.status}`);
    }

    // Check Content-Length header if available upfront
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const declaredSize = parseInt(contentLength, 10);
      if (declaredSize > config.maxFileSizeBytes) {
        throw new Error(
          `⚠️ Video file size (${formatBytes(declaredSize)}) exceeds the maximum allowed limit of ${config.maxFileSizeMB} MB.`
        );
      }
    }

    // Stream directly with highWaterMark buffer for maximum throughput
    const fileWriteStream = fs.createWriteStream(filePath, { highWaterMark: 1024 * 1024 });
    await pipeline(response.body, fileWriteStream);

    // Verify file exists and final size
    const stat = await fs.promises.stat(filePath);
    if (stat.size === 0) {
      await deleteLocalFile(filePath);
      throw new Error('Downloaded video file is empty.');
    }

    if (stat.size > config.maxFileSizeBytes) {
      await deleteLocalFile(filePath);
      throw new Error(
        `⚠️ Video file size (${formatBytes(stat.size)}) exceeds the maximum allowed limit of ${config.maxFileSizeMB} MB.`
      );
    }

    return {
      filePath,
      sizeBytes: stat.size
    };
  } catch (err) {
    clearTimeout(timeout);
    // Ensure incomplete/failed file is removed immediately
    await deleteLocalFile(filePath);
    throw err;
  }
}

/**
 * Downloads multiple photos in parallel and stores them locally in downloads directory
 * @param {string[]} imageUrls
 * @param {string} postId
 * @returns {Promise<string[]>} List of local file paths
 */
export async function downloadPhotosToLocal(imageUrls, postId = 'photo') {
  const safeId = String(postId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const now = Date.now();

  const downloadPromises = imageUrls.map(async (imgUrl, index) => {
    const fileName = `tiktok_photo_${safeId}_${index + 1}_${now}.jpg`;
    const filePath = path.join(config.downloadsDir, fileName);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(imgUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.tiktok.com/'
        }
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Failed to fetch image ${index + 1}: HTTP ${response.status}`);
      }

      const fileWriteStream = fs.createWriteStream(filePath, { highWaterMark: 512 * 1024 });
      await pipeline(response.body, fileWriteStream);
      return filePath;
    } catch (err) {
      clearTimeout(timeout);
      await deleteLocalFile(filePath);
      throw err;
    }
  });

  return Promise.all(downloadPromises);
}

/**
 * Safely deletes multiple downloaded local files
 * @param {string[]} filePaths
 * @returns {Promise<void>}
 */
export async function deleteLocalFiles(filePaths) {
  if (!Array.isArray(filePaths)) return;
  await Promise.all(filePaths.map(fp => deleteLocalFile(fp)));
}

/**
 * Safely deletes a downloaded local file
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function deleteLocalFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      return true;
    }
  } catch (err) {
    console.error(`Failed to delete local video file ${filePath}:`, err.message);
  }
  return false;
}

/**
 * Sweep downloads folder for any orphan temporary files older than maxAgeMinutes
 * (e.g. from server restarts)
 * @param {number} maxAgeMinutes
 */
export async function sweepOrphanFiles(maxAgeMinutes = 15) {
  try {
    if (!fs.existsSync(config.downloadsDir)) return;
    const files = await fs.promises.readdir(config.downloadsDir);
    const now = Date.now();
    const maxAgeMs = maxAgeMinutes * 60 * 1000;

    for (const file of files) {
      if (file === '.gitkeep') continue;
      const fullPath = path.join(config.downloadsDir, file);
      try {
        const stat = await fs.promises.stat(fullPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(fullPath);
          console.log(`[Sweep] Removed orphan video file: ${file}`);
        }
      } catch (e) {
        // Ignore single file error
      }
    }
  } catch (err) {
    console.error('[Sweep] Error cleaning orphan files:', err.message);
  }
}
