import test from 'node:test';
import assert from 'node:assert/strict';
import { immersionText, fetchImmersionExamples, __resetImmersionForTests } from '../immersionKit';
import { immersionKitApi } from '../api';

test('immersionText strips br and decodes entities', () => {
  assert.equal(immersionText('a<br>b<BR/>c<br />d'), 'a\nb\nc\nd');
  assert.equal(immersionText('&quot;q&quot; &#39;a&apos; &amp; &lt;x&gt;'), '"q" \'a\' & <x>');
  assert.equal(immersionText('plain'), 'plain');
});

test('fetch maps metadata/media urls', async () => {
  __resetImmersionForTests();
  const origMeta = immersionKitApi.fetchMetadata;
  const origSearch = immersionKitApi.search;
  (immersionKitApi as any).fetchMetadata = async () => ({
    data: { one_piece: { title: 'One Piece', category: 'anime' } },
  });
  (immersionKitApi as any).search = async () => ({
    examples: [
      { id: 'anime_1', title: 'one_piece', sentence: 's', translation: 't', image: 'i.jpg', sound: 's.mp3' },
    ],
  });
  try {
    const out = await fetchImmersionExamples('word');
    assert.equal(out.length, 1);
    assert.equal(out[0].sourceTitle, 'One Piece');
    assert.equal(out[0].category, 'anime');
    assert.ok(out[0].imageUrl.includes('immersionkit/media/'));
    assert.ok(out[0].soundUrl.endsWith('.mp3'));
  } finally {
    (immersionKitApi as any).fetchMetadata = origMeta;
    (immersionKitApi as any).search = origSearch;
    __resetImmersionForTests();
  }
});

test('particle fallback splits the word when direct search is empty', async () => {
  __resetImmersionForTests();
  const origMeta = immersionKitApi.fetchMetadata;
  const origSearch = immersionKitApi.search;
  const seen: string[] = [];
  (immersionKitApi as any).fetchMetadata = async () => ({ data: {} });
  (immersionKitApi as any).search = async (w: string) => {
    seen.push(w);
    if (w === '猫') return { examples: [{ id: 'x_1', title: 't', sentence: w, translation: '' }] };
    return { examples: [] };
  };
  try {
    const out = await fetchImmersionExamples('猫を');
    assert.equal(out.length, 1);
    assert.ok(seen.includes('猫を') && seen.includes('猫'));
  } finally {
    (immersionKitApi as any).fetchMetadata = origMeta;
    (immersionKitApi as any).search = origSearch;
    __resetImmersionForTests();
  }
});

test('empty word and aborted signal short-circuit', async () => {
  __resetImmersionForTests();
  const origMeta = immersionKitApi.fetchMetadata;
  const origSearch = immersionKitApi.search;
  (immersionKitApi as any).fetchMetadata = async () => ({ data: {} });
  let calls = 0;
  (immersionKitApi as any).search = async () => { calls++; return { examples: [] }; };
  try {
    assert.deepEqual(await fetchImmersionExamples(''), []);
    const c = new AbortController();
    c.abort();
    assert.deepEqual(await fetchImmersionExamples('word', c.signal), []);
    assert.equal(calls, 0);
  } finally {
    (immersionKitApi as any).fetchMetadata = origMeta;
    (immersionKitApi as any).search = origSearch;
    __resetImmersionForTests();
  }
});

test('metadata failure still maps with slug titles', async () => {
  __resetImmersionForTests();
  const origMeta = immersionKitApi.fetchMetadata;
  const origSearch = immersionKitApi.search;
  (immersionKitApi as any).fetchMetadata = async () => { throw new Error('net'); };
  (immersionKitApi as any).search = async () => ({ examples: [{ title: 'my_show', sentence: 's' }] });
  try {
    const out = await fetchImmersionExamples('w');
    assert.equal(out[0].sourceTitle, 'my show');
  } finally {
    (immersionKitApi as any).fetchMetadata = origMeta;
    (immersionKitApi as any).search = origSearch;
    __resetImmersionForTests();
  }
});

test('word without particles and empty direct search returns []', async () => {
  __resetImmersionForTests();
  const origMeta = immersionKitApi.fetchMetadata;
  const origSearch = immersionKitApi.search;
  (immersionKitApi as any).fetchMetadata = async () => ({ data: {} });
  (immersionKitApi as any).search = async () => ({ examples: [] });
  try {
    assert.deepEqual(await fetchImmersionExamples('hello'), []);
  } finally {
    (immersionKitApi as any).fetchMetadata = origMeta;
    (immersionKitApi as any).search = origSearch;
    __resetImmersionForTests();
  }
});

test('particle word with no matches anywhere returns []', async () => {
  __resetImmersionForTests();
  const origMeta = immersionKitApi.fetchMetadata;
  const origSearch = immersionKitApi.search;
  (immersionKitApi as any).fetchMetadata = async () => ({ data: {} });
  (immersionKitApi as any).search = async () => ({ examples: [] });
  try {
    assert.deepEqual(await fetchImmersionExamples('猫を'), []);
  } finally {
    (immersionKitApi as any).fetchMetadata = origMeta;
    (immersionKitApi as any).search = origSearch;
    __resetImmersionForTests();
  }
});

test('repeat fetch hits the in-memory cache', async () => {
  __resetImmersionForTests();
  const origMeta = immersionKitApi.fetchMetadata;
  const origSearch = immersionKitApi.search;
  let searches = 0;
  (immersionKitApi as any).fetchMetadata = async () => ({ data: {} });
  (immersionKitApi as any).search = async () => {
    searches++;
    return { examples: [{ id: 'x_1', title: 't', sentence: 's', translation: '' }] };
  };
  try {
    const first = await fetchImmersionExamples('cacheme');
    const second = await fetchImmersionExamples('cacheme');
    assert.deepEqual(second, first);
    assert.equal(searches, 1);
  } finally {
    (immersionKitApi as any).fetchMetadata = origMeta;
    (immersionKitApi as any).search = origSearch;
    __resetImmersionForTests();
  }
});

test('search failure rejects and clears the cache entry', async () => {
  __resetImmersionForTests();
  const origMeta = immersionKitApi.fetchMetadata;
  const origSearch = immersionKitApi.search;
  (immersionKitApi as any).fetchMetadata = async () => ({ data: {} });
  (immersionKitApi as any).search = async () => { throw new Error('net down'); };
  try {
    await assert.rejects(() => fetchImmersionExamples('broken'), /net down/);
    await assert.rejects(() => fetchImmersionExamples('broken'), /net down/);
  } finally {
    (immersionKitApi as any).fetchMetadata = origMeta;
    (immersionKitApi as any).search = origSearch;
    __resetImmersionForTests();
  }
});
