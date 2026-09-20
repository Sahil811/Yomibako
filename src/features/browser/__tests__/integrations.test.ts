import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIntegration, isAnkiUrl, SITE_INTEGRATIONS, ANKI_BLOCKLIST } from '../integrations';

test('registry has unique ids and required fields', () => {
  const ids = SITE_INTEGRATIONS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of SITE_INTEGRATIONS) {
    assert.ok(s.id && s.label && s.selector && s.description, s.id);
    assert.ok(s.hosts.length > 0, s.id);
    assert.ok(['visible', 'mutation', 'youtube-asr'].includes(s.parser), s.id);
  }
});

test('detectIntegration matches each non-mokuro integration', () => {
  assert.equal(detectIntegration('https://reader.ttsu.app/book/1')?.id, 'ttu');
  assert.equal(detectIntegration('https://ttu-ebook.web.app/x')?.id, 'ttu');
  assert.equal(detectIntegration('https://anacreondjt.gitlab.io/texthooker.html')?.id, 'texthooker');
  assert.equal(detectIntegration('https://app.readwok.com/read')?.id, 'readwok');
  assert.equal(detectIntegration('https://ja.wikipedia.org/wiki/猫')?.id, 'wikipedia');
  assert.equal(detectIntegration('https://ncode.syosetu.com/n1234/')?.id, 'wikipedia');
  assert.equal(detectIntegration('https://www.youtube.com/watch?v=abc')?.id, 'youtube');
  assert.equal(detectIntegration('https://m.youtube.com/watch?v=abc')?.id, 'youtube');
  assert.equal(detectIntegration('https://bunpro.jp/quiz')?.id, 'bunpro');
  assert.equal(detectIntegration('https://www.nhk.or.jp/news/')?.id, 'nhk-jpdb');
  assert.equal(detectIntegration('https://jpdb.io/vocabulary/123/cat')?.id, 'nhk-jpdb');
});

test('detectIntegration is case-insensitive', () => {
  assert.equal(detectIntegration('HTTPS://JA.WIKIPEDIA.ORG/wiki/X')?.id, 'wikipedia');
  assert.equal(detectIntegration('https://APP.READWOK.COM/')?.id, 'readwok');
});

test('mokuro is never returned for the browser', () => {
  assert.equal(detectIntegration('https://mokuro.moe/book.html'), undefined);
  assert.equal(detectIntegration('https://mokuro.app/x'), undefined);
});

test('anki urls are excluded even when they would otherwise match', () => {
  assert.equal(detectIntegration('https://ankiuser.net/x'), undefined);
  assert.equal(detectIntegration('https://ankiweb.net/shared/'), undefined);
  assert.equal(detectIntegration('https://ANKIUSER.NET/x'), undefined);
});

test('unknown urls return undefined', () => {
  assert.equal(detectIntegration('https://example.com/'), undefined);
  assert.equal(detectIntegration(''), undefined);
  assert.equal(detectIntegration('not a url'), undefined);
});

test('isAnkiUrl detects the blocklist', () => {
  for (const d of ANKI_BLOCKLIST) {
    assert.equal(isAnkiUrl(`https://${d}/x`), true);
  }
  assert.equal(isAnkiUrl('https://ANKIWEB.NET/x'), true);
  assert.equal(isAnkiUrl('https://example.com/ankiuser.net.evil.com/'), true);
  assert.equal(isAnkiUrl('https://example.com/'), false);
  assert.equal(isAnkiUrl(''), false);
});
