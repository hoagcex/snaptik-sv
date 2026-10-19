import test from 'node:test';
import assert from 'node:assert';
import { extractTikTokUrls, checkDirectUrlType, validateTikTokVideoUrl } from '../src/validator.js';

test('extractTikTokUrls should extract URLs from message text', () => {
  const text = 'Hey check this out https://www.tiktok.com/@user/video/7451777267107187986 it is amazing!';
  const urls = extractTikTokUrls(text);
  assert.strictEqual(urls.length, 1);
  assert.strictEqual(urls[0], 'https://www.tiktok.com/@user/video/7451777267107187986');
});

test('extractTikTokUrls should return empty array for messages without TikTok links', () => {
  const text = 'Hello world, no links here https://youtube.com/watch?v=123';
  const urls = extractTikTokUrls(text);
  assert.strictEqual(urls.length, 0);
});

test('checkDirectUrlType should recognize photo posts as valid photo media', () => {
  const photoUrl = 'https://www.tiktok.com/@creator/photo/7696854617610571024';
  const result = checkDirectUrlType(photoUrl);
  assert.strictEqual(result.isValid, true);
  assert.strictEqual(result.mediaType, 'photo');
});

test('checkDirectUrlType should reject TikTok Shop products', () => {
  const shopUrl = 'https://shop.tiktok.com/view/product/1729482910482';
  const result = checkDirectUrlType(shopUrl);
  assert.strictEqual(result.isValid, false);
  assert.strictEqual(result.reason, 'product');
});

test('checkDirectUrlType should reject TikTok Live links', () => {
  const liveUrl = 'https://www.tiktok.com/@creator/live';
  const result = checkDirectUrlType(liveUrl);
  assert.strictEqual(result.isValid, false);
  assert.strictEqual(result.reason, 'live');
});

test('checkDirectUrlType should identify standard video links', () => {
  const videoUrl = 'https://www.tiktok.com/@creator/video/7451777267107187986';
  const result = checkDirectUrlType(videoUrl);
  assert.strictEqual(result.isValid, true);
  assert.strictEqual(result.mediaType, 'video');
});

test('validateTikTokVideoUrl should accept photo post link', () => {
  const photoUrl = 'https://www.tiktok.com/@tx_thao/photo/7696854617610571024';
  const result = validateTikTokVideoUrl(photoUrl);
  assert.strictEqual(result.isValidMedia, true);
  assert.strictEqual(result.mediaType, 'photo');
});

test('validateTikTokVideoUrl should accept valid video link', () => {
  const videoUrl = 'https://www.tiktok.com/@tobz2k19/video/7451777267107187986';
  const result = validateTikTokVideoUrl(videoUrl);
  assert.strictEqual(result.isValidMedia, true);
});

test('detectPlatform should identify tiktok, instagram, facebook, and twitter', async () => {
  const { detectPlatform } = await import('../src/validator.js');
  assert.strictEqual(detectPlatform('https://www.tiktok.com/@user/video/123'), 'tiktok');
  assert.strictEqual(detectPlatform('https://vt.tiktok.com/ZS4w1xnNH/'), 'tiktok');
  assert.strictEqual(detectPlatform('https://www.instagram.com/reel/C3bXYZ/'), 'instagram');
  assert.strictEqual(detectPlatform('https://instagr.am/p/C3bXYZ/'), 'instagram');
  assert.strictEqual(detectPlatform('https://www.facebook.com/reel/123456789'), 'facebook');
  assert.strictEqual(detectPlatform('https://fb.watch/2e_gW229e0/'), 'facebook');
  assert.strictEqual(detectPlatform('https://x.com/NASA/status/1649311822720901126'), 'twitter');
  assert.strictEqual(detectPlatform('https://twitter.com/user/status/123'), 'twitter');
  assert.strictEqual(detectPlatform('https://t.co/abcXYZ123'), 'twitter');
  assert.strictEqual(detectPlatform('https://youtube.com/watch?v=123'), 'unknown');
});

test('checkDirectUrlType should accept Instagram Reels and reject Stories or Profiles', async () => {
  const { checkDirectUrlType } = await import('../src/validator.js');
  
  const reelResult = checkDirectUrlType('https://www.instagram.com/reel/C3bXYZ123/');
  assert.strictEqual(reelResult.isValid, true);
  assert.strictEqual(reelResult.platform, 'instagram');

  const profileResult = checkDirectUrlType('https://www.instagram.com/cristiano/');
  assert.strictEqual(profileResult.isValid, false);
  assert.strictEqual(profileResult.reason, 'profile');

  const storyResult = checkDirectUrlType('https://www.instagram.com/stories/cristiano/123456789/');
  assert.strictEqual(storyResult.isValid, false);
  assert.strictEqual(storyResult.reason, 'stories');
});

test('checkDirectUrlType should accept Facebook Reels and reject Stories or Profiles', async () => {
  const { checkDirectUrlType } = await import('../src/validator.js');
  
  const reelResult = checkDirectUrlType('https://www.facebook.com/reel/108392817291028');
  assert.strictEqual(reelResult.isValid, true);
  assert.strictEqual(reelResult.platform, 'facebook');

  const watchResult = checkDirectUrlType('https://fb.watch/2e_gW229e0/');
  assert.strictEqual(watchResult.isValid, true);
  assert.strictEqual(watchResult.platform, 'facebook');

  const profileResult = checkDirectUrlType('https://www.facebook.com/zuck');
  assert.strictEqual(profileResult.isValid, false);
  assert.strictEqual(profileResult.reason, 'profile');

  const rootResult = checkDirectUrlType('https://www.facebook.com/');
  assert.strictEqual(rootResult.isValid, false);
  assert.strictEqual(rootResult.reason, 'root');

  const storyResult = checkDirectUrlType('https://www.facebook.com/stories/123456789/');
  assert.strictEqual(storyResult.isValid, false);
  assert.strictEqual(storyResult.reason, 'stories');
});

test('checkDirectUrlType should accept X (Twitter) video links and reject Profiles or Root', async () => {
  const { checkDirectUrlType } = await import('../src/validator.js');
  
  const statusResult = checkDirectUrlType('https://x.com/NASA/status/1649311822720901126');
  assert.strictEqual(statusResult.isValid, true);
  assert.strictEqual(statusResult.platform, 'twitter');
  assert.strictEqual(statusResult.mediaType, 'video');

  const twitterStatus = checkDirectUrlType('https://twitter.com/user/status/987654321');
  assert.strictEqual(twitterStatus.isValid, true);
  assert.strictEqual(twitterStatus.platform, 'twitter');

  const profileResult = checkDirectUrlType('https://x.com/elonmusk');
  assert.strictEqual(profileResult.isValid, false);
  assert.strictEqual(profileResult.reason, 'profile');

  const rootResult = checkDirectUrlType('https://x.com/');
  assert.strictEqual(rootResult.isValid, false);
  assert.strictEqual(rootResult.reason, 'root');

  const shortResult = checkDirectUrlType('https://t.co/abcXYZ123');
  assert.strictEqual(shortResult.isValid, true);
  assert.strictEqual(shortResult.platform, 'twitter');
});

test('extractMediaUrls should extract URLs for all supported platforms', async () => {
  const { extractMediaUrls } = await import('../src/validator.js');
  const text = 'Check IG https://www.instagram.com/reel/C-xyz123/ and FB https://fb.watch/abc123/ and X https://x.com/user/status/123456 now!';
  const urls = extractMediaUrls(text);
  assert.strictEqual(urls.length, 3);
  assert.strictEqual(urls[0], 'https://www.instagram.com/reel/C-xyz123/');
  assert.strictEqual(urls[1], 'https://fb.watch/abc123/');
  assert.strictEqual(urls[2], 'https://x.com/user/status/123456');
});
