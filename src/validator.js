/**
 * Universal Media URL Validator & Link Resolver
 * Supports TikTok, Instagram Reels, and Facebook Reels.
 */

// Regex for finding TikTok, Instagram, and Facebook URLs within text
export const MEDIA_URL_REGEX = /https?:\/\/(?:[a-zA-Z0-9-]+\.)?(?:tiktok\.com|instagram\.com|instagr\.am|facebook\.com|fb\.watch|fb\.com)\/[^\s<>"]+/gi;

/**
 * Extracts all supported media URLs from a string (message text)
 * @param {string} text
 * @returns {string[]}
 */
export function extractMediaUrls(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(MEDIA_URL_REGEX);
  if (!matches) return [];

  return matches.map(url => url.replace(/[.,!?;:]+$/, ''));
}

// Backwards-compatible alias
export const extractTikTokUrls = extractMediaUrls;

/**
 * Detect the social media platform from URL
 * @param {string} url
 * @returns {'tiktok' | 'instagram' | 'facebook' | 'unknown'}
 */
export function detectPlatform(url) {
  const clean = (url || '').trim().toLowerCase();
  if (clean.includes('tiktok.com')) return 'tiktok';
  if (clean.includes('instagram.com') || clean.includes('instagr.am')) return 'instagram';
  if (clean.includes('facebook.com') || clean.includes('fb.watch') || clean.includes('fb.com')) return 'facebook';
  return 'unknown';
}

/**
 * Fast synchronous check on URL pattern
 * @param {string} url
 * @returns {{ isValid: boolean, platform: string, mediaType?: 'video' | 'photo' | 'shortlink' | 'unknown', reason: string, message?: string }}
 */
export function checkDirectUrlType(url) {
  const cleanUrl = url.trim();
  const platform = detectPlatform(cleanUrl);

  if (platform === 'tiktok') {
    // 1. TikTok Shop product (rejected)
    if (cleanUrl.includes('shop.tiktok.com') || /\/product\//i.test(cleanUrl) || /\/view\/product\//i.test(cleanUrl)) {
      return {
        isValid: false,
        platform,
        reason: 'product',
        message: '❌ **TikTok Shop product link detected!**\n\nOnly TikTok videos and photo slideshows can be downloaded.'
      };
    }

    // 2. Photo post / photo carousel / slideshow
    if (/\/photo\/\d+/i.test(cleanUrl)) {
      return {
        isValid: true,
        platform,
        mediaType: 'photo',
        reason: 'photo'
      };
    }

    // 3. TikTok Live stream (rejected)
    if (/@[\w.-]+\/live(\/|$|\?)/i.test(cleanUrl) || /\/live(\/|$|\?)/i.test(cleanUrl)) {
      return {
        isValid: false,
        platform,
        reason: 'live',
        message: '❌ **TikTok Live stream detected!**\n\nLive streams cannot be downloaded.'
      };
    }

    // 4. TikTok Music / Sound link (rejected)
    if (/\/music\//i.test(cleanUrl)) {
      return {
        isValid: false,
        platform,
        reason: 'music',
        message: '❌ **TikTok Music / Sound link detected!**\n\nPlease send a video or photo slideshow link.'
      };
    }

    // 5. User Profile only (e.g. tiktok.com/@username) (rejected)
    if (/^https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/?(?:\?.*)?$/i.test(cleanUrl)) {
      return {
        isValid: false,
        platform,
        reason: 'profile',
        message: '❌ **TikTok Profile link detected!**\n\nPlease send a link to a specific TikTok video or photo post.'
      };
    }

    // 6. Direct video link
    if (/@[\w.-]+\/video\/\d+/i.test(cleanUrl) || /\/v\/\d+/i.test(cleanUrl)) {
      return {
        isValid: true,
        platform,
        mediaType: 'video',
        reason: 'video'
      };
    }

    // 7. Short links (vt.tiktok.com, vm.tiktok.com, tiktok.com/t/...)
    if (/(?:vt|vm)\.tiktok\.com/i.test(cleanUrl) || /tiktok\.com\/t\//i.test(cleanUrl)) {
      return {
        isValid: true,
        platform,
        mediaType: 'shortlink',
        reason: 'shortlink'
      };
    }

    return {
      isValid: true,
      platform,
      mediaType: 'unknown',
      reason: 'unknown'
    };
  }

  if (platform === 'instagram') {
    // Stories are temporary and cannot be downloaded publicly
    if (/\/stories\//i.test(cleanUrl)) {
      return {
        isValid: false,
        platform,
        reason: 'stories',
        message: '❌ **Instagram Stories are not supported.**\n\nPlease send a link to a public Instagram Reel or post.'
      };
    }

    // Check if it is a profile link only (e.g. instagram.com/username/)
    if (/^https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/[a-zA-Z0-9_.]+\/?(?:\?.*)?$/i.test(cleanUrl)) {
      return {
        isValid: false,
        platform,
        reason: 'profile',
        message: '❌ **Instagram Profile link detected!**\n\nPlease send a link to a specific Instagram Reel or video post.'
      };
    }

    return {
      isValid: true,
      platform,
      mediaType: 'video',
      reason: 'instagram_media'
    };
  }

  if (platform === 'facebook') {
    // Root facebook link
    if (/^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/?(?:\?.*)?$/i.test(cleanUrl)) {
      return {
        isValid: false,
        platform,
        reason: 'root',
        message: '❌ **Please send a link to a specific Facebook Reel or video.**'
      };
    }

    // Stories are temporary and require login
    if (/\/stories\//i.test(cleanUrl)) {
      return {
        isValid: false,
        platform,
        reason: 'stories',
        message: '❌ **Facebook Stories are not supported.**\n\nPlease send a link to a public Facebook Reel or video.'
      };
    }

    // Profile page without video/reel path
    if (
      /^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/(?:profile\.php\?id=\d+|[a-zA-Z0-9_.-]+)\/?(?:\?.*)?$/i.test(cleanUrl) &&
      !/\/(?:reel|reels|videos|watch|share)\b/i.test(cleanUrl)
    ) {
      return {
        isValid: false,
        platform,
        reason: 'profile',
        message: '❌ **Facebook Profile link detected!**\n\nPlease send a link to a specific Facebook Reel or video.'
      };
    }

    return {
      isValid: true,
      platform,
      mediaType: 'video',
      reason: 'facebook_media'
    };
  }

  return {
    isValid: false,
    platform: 'unknown',
    reason: 'unsupported_platform',
    message: '❌ **Unsupported URL!**\n\nOnly TikTok, Instagram Reels, and Facebook Reels are supported.'
  };
}

/**
 * Validates any supported media URL (TikTok, Instagram, Facebook)
 * @param {string} url
 * @returns {{ isValidMedia: boolean, isValidVideo: boolean, platform: string, mediaType?: string, resolvedUrl: string, error?: string }}
 */
export function validateMediaUrl(url) {
  const directCheck = checkDirectUrlType(url);

  if (directCheck.isValid === false) {
    return {
      isValidMedia: false,
      isValidVideo: false,
      platform: directCheck.platform || 'unknown',
      resolvedUrl: url,
      error: directCheck.message
    };
  }

  return {
    isValidMedia: true,
    isValidVideo: true,
    platform: directCheck.platform,
    mediaType: directCheck.mediaType,
    resolvedUrl: url
  };
}

// Backwards-compatible alias for existing code/tests
export const validateTikTokVideoUrl = validateMediaUrl;
