import test from 'node:test';
import assert from 'node:assert';
import { getInstagramReel, getFacebookReel, getTwitterVideo, fetchUniversalMedia } from '../src/mediaService.js';

test('getInstagramReel should detect private/restricted reel and show cannot download message', async () => {
  const privateUrl = 'https://www.instagram.com/reel/C-fake_private_reel_12345/';
  const result = await getInstagramReel(privateUrl);

  assert.strictEqual(result.success, false, 'Private reel must not succeed');
  assert.strictEqual(result.isPrivate, true, 'isPrivate must be true');
  assert.ok(result.error.includes('Cannot download'), 'Error must state Cannot download');
  assert.ok(result.error.includes('not public, restricted, or cannot be seen'), 'Error must state reason');
});

test('getFacebookReel should detect private/restricted reel and show cannot download message', async () => {
  const privateUrl = 'https://www.facebook.com/reel/999999999999999999';
  const result = await getFacebookReel(privateUrl);

  assert.strictEqual(result.success, false, 'Non-existent or private FB reel must not succeed');
  assert.strictEqual(result.isPrivate, true, 'isPrivate must be true');
  assert.ok(result.error.includes('Cannot download'), 'Error must state Cannot download');
  assert.ok(result.error.includes('not public, restricted, or cannot be seen'), 'Error must state reason');
});

test('getTwitterVideo should detect missing video or private tweet and handle gracefully', async () => {
  const fakeTweet = 'https://x.com/fake_user_1234/status/999999999999999999';
  const result = await getTwitterVideo(fakeTweet);

  assert.strictEqual(result.success, false);
  assert.ok(
    result.error.includes('No video found') || result.error.includes('Cannot download'),
    'Error must explain no video found or cannot download'
  );
});

test('fetchUniversalMedia should route instagram, facebook, and twitter properly', async () => {
  const igRes = await fetchUniversalMedia('https://www.instagram.com/reel/C-fake_private_reel_12345/');
  assert.strictEqual(igRes.success, false);
  assert.strictEqual(igRes.isPrivate, true);

  const twitterRes = await fetchUniversalMedia('https://x.com/fake_user_1234/status/999999999999999999');
  assert.strictEqual(twitterRes.success, false);

  const unknownRes = await fetchUniversalMedia('https://threads.net/@user/post/123456');
  assert.strictEqual(unknownRes.success, false);
  assert.strictEqual(unknownRes.platform, 'unknown');
});
