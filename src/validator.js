/**
 * TikTok URL Validator & Link Resolver
 * Detects whether a TikTok URL is a video, photo slideshow, product, live stream, or profile.
 */

// Regex for finding TikTok URLs within text
const TIKTOK_URL_REGEX = /https?:\/\/(?:[a-zA-Z0-9-]+\.)?tiktok\.com\/[^\s<>"]+/gi;

/**
 * Extracts all TikTok URLs from a string (message text)
 * @param {string} text
 * @returns {string[]}
 */
export function extractTikTokUrls(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(TIKTOK_URL_REGEX);
  if (!matches) return [];

  // Clean trailing punctuation that might get attached (like ., !, ?, etc.)
  return matches.map(url => url.replace(/[.,!?;:]+$/, ''));
}

/**
 * Fast synchronous check on URL pattern
 * @param {string} url
 * @returns {{ isValid: boolean, mediaType?: 'video' | 'photo' | 'shortlink' | 'unknown', reason: string, message?: string }}
 */
export function checkDirectUrlType(url) {
  const cleanUrl = url.trim();

  // 1. TikTok Shop product (rejected)
  if (cleanUrl.includes('shop.tiktok.com') || /\/product\//i.test(cleanUrl) || /\/view\/product\//i.test(cleanUrl)) {
    return {
      isValid: false,
      reason: 'product',
      message: '❌ **TikTok Shop product link detected!**\n\nOnly TikTok videos and photo slideshows can be downloaded.'
    };
  }

  // 2. Photo post / photo carousel / slideshow (NOW SUPPORTED!)
  if (/\/photo\/\d+/i.test(cleanUrl)) {
    return {
      isValid: true,
      mediaType: 'photo',
      reason: 'photo'
    };
  }

  // 3. TikTok Live stream (rejected)
  if (/@[\w.-]+\/live(\/|$|\?)/i.test(cleanUrl) || /\/live(\/|$|\?)/i.test(cleanUrl)) {
    return {
      isValid: false,
      reason: 'live',
      message: '❌ **TikTok Live stream detected!**\n\nLive streams cannot be downloaded.'
    };
  }

  // 4. TikTok Music / Sound link (rejected)
  if (/\/music\//i.test(cleanUrl)) {
    return {
      isValid: false,
      reason: 'music',
      message: '❌ **TikTok Music / Sound link detected!**\n\nPlease send a video or photo slideshow link.'
    };
  }

  // 5. User Profile only (e.g. tiktok.com/@username) (rejected)
  if (/^https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/?(?:\?.*)?$/i.test(cleanUrl)) {
    return {
      isValid: false,
      reason: 'profile',
      message: '❌ **TikTok Profile link detected!**\n\nPlease send a link to a specific TikTok video or photo post.'
    };
  }

  // 6. Direct video link (e.g. tiktok.com/@username/video/123456789...)
  if (/@[\w.-]+\/video\/\d+/i.test(cleanUrl) || /\/v\/\d+/i.test(cleanUrl)) {
    return {
      isValid: true,
      mediaType: 'video',
      reason: 'video'
    };
  }

  // 7. Short links (vt.tiktok.com, vm.tiktok.com, tiktok.com/t/...)
  if (/(?:vt|vm)\.tiktok\.com/i.test(cleanUrl) || /tiktok\.com\/t\//i.test(cleanUrl)) {
    return {
      isValid: true,
      mediaType: 'shortlink',
      reason: 'shortlink'
    };
  }

  return {
    isValid: true,
    mediaType: 'unknown',
    reason: 'unknown'
  };
}

/**
 * Fast URL validation: inspects direct patterns and confirms whether
 * the link belongs to TikTok and is not a product, live stream, or profile.
 * Shortlinks are passed directly to downloader service which handles server-side resolution.
 * @param {string} url
 * @returns {{ isValidMedia: boolean, isValidVideo: boolean, mediaType?: string, resolvedUrl: string, error?: string }}
 */
export function validateTikTokVideoUrl(url) {
  const directCheck = checkDirectUrlType(url);

  // If identified as non-media (product, live, profile, etc.)
  if (directCheck.isValid === false) {
    return {
      isValidMedia: false,
      isValidVideo: false,
      resolvedUrl: url,
      error: directCheck.message
    };
  }

  // Must belong to TikTok domain
  const isTikTokDomain = /tiktok\.com/i.test(url);
  if (!isTikTokDomain) {
    return {
      isValidMedia: false,
      isValidVideo: false,
      resolvedUrl: url,
      error: '❌ **Invalid URL!**\n\nThe link provided does not belong to TikTok.'
    };
  }

  return {
    isValidMedia: true,
    isValidVideo: true,
    mediaType: directCheck.mediaType,
    resolvedUrl: url
  };
}
