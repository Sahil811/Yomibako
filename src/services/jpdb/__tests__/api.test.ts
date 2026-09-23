import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JpdbError,
  LOGIN_HINT,
  isRetryableStatus,
  jpdbApi,
  immersionKitApi,
  kanjiApi,
  geminiApi,
  youtubeApi,
  __resetApiForTests,
} from '../api';
import * as session from '../session';

function mockFetch(handler: (url: string, init: any) => any) {
  const orig = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, init: any) => handler(url, init);
  return () => { (globalThis as any).fetch = orig; };
}

function okJson(data: any) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
}
function errStatus(status: number, body = '') {
  return { ok: false, status, text: async () => body, json: async () => ({}) };
}

test('JpdbError carries status/retriable and LOGIN_HINT mentions login', () => {
  const e = new JpdbError('m', 503, true);
  assert.equal(e.name, 'JpdbError');
  assert.equal(e.status, 503);
  assert.equal(e.retriable, true);
  assert.ok(LOGIN_HINT.toLowerCase().includes('logged'));
});

test('isRetryableStatus matches 500/502/503/504 only', () => {
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(502), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(504), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isRetryableStatus(404), false);
  assert.equal(isRetryableStatus(429), false);
});

test('parse maps vocabulary and tokens with furigana', async () => {
  __resetApiForTests();
  // force direct-fetch path (no session wait)
  const origSessionFetch = (session as any).sessionFetch;
  (session as any).sessionFetch = async () => { throw new Error('no bridge'); };
  const restore = mockFetch(async (url) => {
    assert.ok(url.includes('/api/v1/parse'));
    return okJson({
      vocabulary: [[1, 2, 3, '猫', 'ねこ', 5, ['n'], [['cat']], [['n']], ['new'], ['LHH']]],
      tokens: [[[0, 0, 1, null]]],
    });
  });
  try {
    const out = await jpdbApi.parse({ text: ['猫'], apiToken: 't' });
    assert.equal(out.cards.length, 1);
    assert.equal(out.cards[0].spelling, '猫');
    assert.equal(out.tokens[0][0].card.vid, 1);
  } finally {
    restore();
    (session as any).sessionFetch = origSessionFetch;
  }
});

test('parse maps string and ruby furigana parts', async () => {
  __resetApiForTests();
  const origSessionFetch = (session as any).sessionFetch;
  (session as any).sessionFetch = async () => { throw new Error('no bridge'); };
  const restore = mockFetch(async () => okJson({
    vocabulary: [[1, 2, 3, '猫が', 'ねこが', 5, ['n'], [['cat']], [['n']], ['new'], ['LHH']]],
    tokens: [[[0, 0, 2, ['x', ['猫', 'ねこ']]]]],
  }));
  try {
    const out = await jpdbApi.parse({ text: ['猫が'], apiToken: 't' });
    assert.equal(out.tokens[0][0].rubies.length, 1);
    assert.equal(out.tokens[0][0].rubies[0].text, 'ねこ');
  } finally {
    restore();
    (session as any).sessionFetch = origSessionFetch;
  }
});

test('parse surfaces server error_message', async () => {
  __resetApiForTests();
  const restore = mockFetch(async () => errStatus(400, JSON.stringify({ error_message: 'bad req' })));
  try {
    await assert.rejects(() => jpdbApi.parse({ text: ['x'], apiToken: 't' }), /bad req/);
  } finally {
    restore();
  }
});

test('lookup/add/remove go through deck endpoints', async () => {
  __resetApiForTests();
  const seen: string[] = [];
  const restore = mockFetch(async (url) => {
    seen.push(url);
    return okJson({ ok: true });
  });
  try {
    await jpdbApi.lookupVocabulary({ list: [[1, 2]], apiToken: 't' });
    await jpdbApi.addVocabulary({ deckId: 5, vocabulary: [[1, 2]], apiToken: 't' });
    await jpdbApi.removeVocabulary({ deckId: 5, vocabulary: [[1, 2]], apiToken: 't' });
    assert.ok(seen.some((u) => u.includes('lookup-vocabulary')));
    assert.ok(seen.some((u) => u.includes('add-vocabulary')));
    assert.ok(seen.some((u) => u.includes('remove-vocabulary')));
  } finally {
    restore();
  }
});

test('forq deck id delegates to prioritize/deprioritize', async () => {
  __resetApiForTests();
  const origSessionFetch = (session as any).sessionFetch;
  (session as any).sessionFetch = async () => { throw new Error('no bridge'); };
  const restore = mockFetch(async () => ({ ok: true, status: 200, text: async () => 'ok', json: async () => ({}) }));
  const origPrio = (jpdbApi as any).prioritize;
  const origDeprio = (jpdbApi as any).deprioritize;
  let prio = 0;
  let deprio = 0;
  (jpdbApi as any).prioritize = async () => { prio++; return {}; };
  (jpdbApi as any).deprioritize = async () => { deprio++; return {}; };
  try {
    await jpdbApi.addVocabulary({ deckId: 'forq', vocabulary: [[1, 2]], apiToken: 't' });
    await jpdbApi.removeVocabulary({ deckId: 'forq', vocabulary: [[1, 2]], apiToken: 't' });
    assert.equal(prio, 1);
    assert.equal(deprio, 1);
  } finally {
    restore();
    (session as any).sessionFetch = origSessionFetch;
    (jpdbApi as any).prioritize = origPrio;
    (jpdbApi as any).deprioritize = origDeprio;
  }
});

test('getAudioHash extracts data-audio and nulls on 404', async () => {
  __resetApiForTests();
  const origSessionFetch = (session as any).sessionFetch;
  (session as any).sessionFetch = async () => { throw new Error('no bridge'); };
  const origPage = jpdbApi.fetchVocabularyPage;
  try {
    (jpdbApi as any).fetchVocabularyPage = async () => '<div data-audio="m1/abc"></div>';
    assert.equal(await jpdbApi.getAudioHash({ vid: 1, spelling: '猫' }), 'm1/abc');
    (jpdbApi as any).fetchVocabularyPage = async () => '<div>none</div>';
    assert.equal(await jpdbApi.getAudioHash({ vid: 1, spelling: '猫' }), null);
    (jpdbApi as any).fetchVocabularyPage = async () => { throw new JpdbError('nf', 404); };
    assert.equal(await jpdbApi.getAudioHash({ vid: 1, spelling: '猫' }), null);
  } finally {
    (jpdbApi as any).fetchVocabularyPage = origPage;
    (session as any).sessionFetch = origSessionFetch;
  }
});

test('getCardState maps vocabulary_info and 404s', async () => {
  __resetApiForTests();
  const orig = jpdbApi.lookupVocabulary;
  try {
    (jpdbApi as any).lookupVocabulary = async () => ({ vocabulary_info: [[['new']]] });
    assert.deepEqual(await jpdbApi.getCardState({ vid: 1, sid: 2, apiToken: 't' }), ['new']);
    (jpdbApi as any).lookupVocabulary = async () => ({ vocabulary_info: [null] });
    await assert.rejects(() => jpdbApi.getCardState({ vid: 1, sid: 2, apiToken: 't' }), /not found/);
    (jpdbApi as any).lookupVocabulary = async () => { throw new JpdbError('x', 500); };
    await assert.rejects(() => jpdbApi.getCardState({ vid: 1, sid: 2, apiToken: 't' }), /lookup failed/);
  } finally {
    (jpdbApi as any).lookupVocabulary = orig;
  }
});

test('review rejects unknown ratings', async () => {
  __resetApiForTests();
  await assert.rejects(() => (jpdbApi as any).review({ vid: 1, sid: 2, rating: 'zzz' }), /unknown rating/);
});

test('setCardSentence posts sentence payload', async () => {
  __resetApiForTests();
  let body: any;
  const restore = mockFetch(async (url, init) => {
    assert.ok(url.includes('set-card-sentence'));
    body = JSON.parse(init.body);
    return okJson({});
  });
  try {
    await jpdbApi.setCardSentence({ vid: 1, sid: 2, sentence: 's', translation: 't', apiToken: 'k' });
    assert.equal(body.sentence, 's');
    assert.equal(body.vid, 1);
  } finally {
    restore();
  }
});

test('setCardSentence surfaces server errors', async () => {
  __resetApiForTests();
  const restore = mockFetch(async () => errStatus(500, JSON.stringify({ error_message: 'oops' })));
  try {
    await assert.rejects(
      () => jpdbApi.setCardSentence({ vid: 1, sid: 2, apiToken: 'k' }),
      /oops/,
    );
  } finally {
    restore();
  }
});

test('fetchAudioBytes returns the buffer', async () => {
  __resetApiForTests();
  const buf = new Uint8Array([1, 2, 3]).buffer;
  const restore = mockFetch(async (url) => {
    assert.ok(url.includes('/static/v/'));
    return { ok: true, status: 200, arrayBuffer: async () => buf };
  });
  try {
    assert.equal(await jpdbApi.fetchAudioBytes({ hash: 'h' }), buf);
  } finally {
    restore();
  }
});

test('review page login gate and submit flow', async () => {
  __resetApiForTests();
  const origSessionFetch = (session as any).sessionFetch;
  (session as any).sessionFetch = async () => { throw new Error('no bridge'); };
  const origText = jpdbApi.fetchReviewPage;
  const origSubmit = jpdbApi.submitReview;
  try {
    (jpdbApi as any).fetchReviewPage = async () => '<input name="r" value="42">';
    let submitted: any;
    (jpdbApi as any).submitReview = async (a: any) => { submitted = a; return 'done'; };
    assert.equal(await jpdbApi.review({ vid: 1, sid: 2, rating: 'good' }), 'done');
    assert.equal(submitted.grade, '4');
    assert.equal(submitted.reviewNo, 42);
    (jpdbApi as any).fetchReviewPage = async () => '<html>no number</html>';
    await assert.rejects(() => jpdbApi.review({ vid: 1, sid: 2, rating: 'good' }), /review number/);
  } finally {
    (jpdbApi as any).fetchReviewPage = origText;
    (jpdbApi as any).submitReview = origSubmit;
    (session as any).sessionFetch = origSessionFetch;
  }
});

test('fetchReviewPage direct-fetch login detection', async () => {
  __resetApiForTests();
  const origSessionFetch = (session as any).sessionFetch;
  (session as any).sessionFetch = async () => { throw new Error('no bridge'); };
  const restore = mockFetch(async () => ({ ok: true, status: 200, text: async () => '<a href="/login">x</a>' }));
  try {
    await assert.rejects(() => jpdbApi.fetchReviewPage({ vid: 1, sid: 2 }), /Not logged in/);
  } finally {
    restore();
    (session as any).sessionFetch = origSessionFetch;
  }
});

test('setFlag needs a deck and wraps failures', async () => {
  __resetApiForTests();
  const config = await import('../config');
  const origGetDeckId = config.getDeckId;
  const origAdd = jpdbApi.addVocabulary;
  try {
    (config as any).getDeckId = async () => null;
    await assert.rejects(
      () => jpdbApi.setFlag({ vid: 1, sid: 2, flag: 'blacklist', state: true, apiToken: 'k' }),
      /No deck ID/,
    );
    (config as any).getDeckId = async () => 9;
    (jpdbApi as any).addVocabulary = async () => { throw new JpdbError('down', 500); };
    await assert.rejects(() => jpdbApi.setFlag({ vid: 1, sid: 2, flag: 'blacklist', state: true, apiToken: 'k' }), /failed/);
    (jpdbApi as any).addVocabulary = async () => ({ ok: true });
    assert.deepEqual(
      await jpdbApi.setFlag({ vid: 1, sid: 2, flag: 'blacklist', state: true, apiToken: 'k' }),
      { ok: true },
    );
  } finally {
    (config as any).getDeckId = origGetDeckId;
    (jpdbApi as any).addVocabulary = origAdd;
  }
});

test('mine requires a mining deck and fans out', async () => {
  __resetApiForTests();
  const config = await import('../config');
  const origLoad = config.loadConfig;
  const calls: string[] = [];
  const origAdd = jpdbApi.addVocabulary;
  const origSet = jpdbApi.setCardSentence;
  const origReview = (jpdbApi as any).review;
  try {
    (config as any).loadConfig = async () => ({ miningDeckId: null, forqOnMine: false });
    await assert.rejects(() => (jpdbApi as any).mine({ vid: 1, sid: 2, apiToken: 'k' }), /mining deck/);
    (config as any).loadConfig = async () => ({ miningDeckId: 3, forqDeckId: 'forq', forqOnMine: true });
    (jpdbApi as any).addVocabulary = async (a: any) => { calls.push(String(a.deckId)); return {}; };
    (jpdbApi as any).setCardSentence = async () => { calls.push('sentence'); return {}; };
    (jpdbApi as any).review = async () => { calls.push('review'); return {}; };
    await (jpdbApi as any).mine({ vid: 1, sid: 2, apiToken: 'k', sentence: 's', reviewRating: 'good' });
    assert.ok(calls.includes('3') && calls.includes('sentence'));
  } finally {
    (config as any).loadConfig = origLoad;
    (jpdbApi as any).addVocabulary = origAdd;
    (jpdbApi as any).setCardSentence = origSet;
    (jpdbApi as any).review = origReview;
  }
});

test('supplemental apis hit their endpoints and surface errors', async () => {
  __resetApiForTests();
  const restore = mockFetch(async (url) => {
    if (url.includes('immersionkit')) return okJson({ data: {} });
    if (url.includes('kanjiapi')) return okJson({ meanings: ['a'] });
    if (url.includes('youtube') || url.includes('google')) return { ok: true, status: 200, text: async () => 'page', json: async () => ({}) };
    return errStatus(500, 'err');
  });
  try {
    assert.deepEqual(await immersionKitApi.fetchMetadata(), { data: {} });
    assert.deepEqual((await kanjiApi.fetchKanji('日')).meanings, ['a']);
    assert.equal(await youtubeApi.fetchWatchPage('https://youtube.com/watch'), 'page');
    await assert.rejects(() => immersionKitApi.fetchMedia('https://x'), /media/);
  } finally {
    restore();
  }
  const restore2 = mockFetch(async () => errStatus(404, 'nf'));
  try {
    await assert.rejects(() => kanjiApi.fetchKanji('日'), /kanji 404/);
  } finally {
    restore2();
  }
});

test('gemini needs a key, returns text, handles 404 fallback and empty', async () => {
  __resetApiForTests();
  await assert.rejects(() => geminiApi.explainWord({ apiKey: '  ', prompt: 'p' }), /API key/);
  let n = 0;
  const restore = mockFetch(async () => {
    n++;
    if (n === 1) return errStatus(404, 'gone');
    return okJson({ candidates: [{ content: { parts: [{ text: 'hello' }] } }] });
  });
  try {
    assert.equal(await geminiApi.explainWord({ apiKey: 'k', prompt: 'p' }), 'hello');
  } finally {
    restore();
  }
  const restore3 = mockFetch(async () => errStatus(429, 'slow'));
  try {
    await assert.rejects(() => geminiApi.explainWord({ apiKey: 'k', prompt: 'p' }), /rate limit/);
  } finally {
    restore3();
  }
  const restore4 = mockFetch(async () => okJson({ candidates: [] }));
  try {
    await assert.rejects(() => geminiApi.explainWord({ apiKey: 'k', prompt: 'p' }), /empty/);
  } finally {
    restore4();
  }
});

test('session-backed scrape short-circuits and enforces login', async () => {
  __resetApiForTests();
  const origSessionFetch = (session as any).sessionFetch;
  try {
    (session as any).sessionFetch = async () => ({ status: 200, text: '<html>ok</html>' });
    assert.equal(await jpdbApi.fetchVocabularyPage({ vid: 1, spelling: 'x' }), '<html>ok</html>');
    (session as any).sessionFetch = async () => ({ status: 200, text: '<a href="/login">in</a>' });
    await assert.rejects(() => jpdbApi.fetchReviewPage({ vid: 1, sid: 2 }), /Not logged in/);
    await assert.rejects(() => jpdbApi.prioritize({ vid: 1, sid: 2 }), /FORQ requires login/);
    await assert.rejects(() => jpdbApi.deprioritize({ vid: 1, sid: 2 }), /FORQ requires login/);
  } finally {
    (session as any).sessionFetch = origSessionFetch;
  }
});

test('gemini maps 401 and bare statuses', async () => {
  __resetApiForTests();
  const r401 = mockFetch(async () => errStatus(401, 'bad key'));
  try {
    await assert.rejects(() => geminiApi.explainWord({ apiKey: 'k', prompt: 'p' }), /rejected/);
  } finally {
    r401();
  }
  const r500 = mockFetch(async () => errStatus(500, ''));
  try {
    await assert.rejects(() => geminiApi.explainWord({ apiKey: 'k', prompt: 'p' }), /HTTP 500/);
  } finally {
    r500();
  }
});

test('youtube transcript and immersion media roundtrip', async () => {
  __resetApiForTests();
  const buf = new Uint8Array([9]).buffer;
  const restore = mockFetch(async (url) => {
    if (url.includes('transcript')) return { ok: true, status: 200, text: async () => 'caps' };
    return { ok: true, status: 200, text: async () => 't', json: async () => ({}), arrayBuffer: async () => buf };
  });
  try {
    assert.equal(await youtubeApi.fetchTranscript('https://x/transcript'), 'caps');
    assert.equal(await immersionKitApi.fetchMedia('https://m/f.mp3'), buf);
  } finally {
    restore();
  }
});

test('prioritize/deprioritize direct fetch paths', async () => {
  __resetApiForTests();
  const origSessionFetch = (session as any).sessionFetch;
  (session as any).sessionFetch = async () => { throw new Error('no bridge'); };
  try {
    const rOk = mockFetch(async () => ({ ok: true, status: 200, text: async () => 'ok' }));
    __resetApiForTests();
    assert.equal(await jpdbApi.prioritize({ vid: 1, sid: 2 }), 'ok');
    __resetApiForTests();
    assert.equal(await jpdbApi.deprioritize({ vid: 1, sid: 2 }), 'ok');
    rOk();
    const rLogin = mockFetch(async () => ({ ok: true, status: 200, text: async () => '<a href="/login">x</a>' }));
    __resetApiForTests();
    await assert.rejects(() => jpdbApi.prioritize({ vid: 1, sid: 2 }), /FORQ requires login/);
    __resetApiForTests();
    await assert.rejects(() => jpdbApi.deprioritize({ vid: 1, sid: 2 }), /FORQ requires login/);
    rLogin();
    const rErr = mockFetch(async () => errStatus(500, 'e'));
    __resetApiForTests();
    await assert.rejects(() => jpdbApi.prioritize({ vid: 1, sid: 2 }), /prioritize 500/);
    __resetApiForTests();
    await assert.rejects(() => jpdbApi.deprioritize({ vid: 1, sid: 2 }), /deprioritize 500/);
    rErr();
  } finally {
    (session as any).sessionFetch = origSessionFetch;
  }
});

test('setFlag wraps deck lookup crashes', async () => {
  __resetApiForTests();
  const config = await import('../config');
  const orig = (config as any).getDeckId;
  (config as any).getDeckId = async () => { throw new Error('store down'); };
  try {
    await assert.rejects(
      () => jpdbApi.setFlag({ vid: 1, sid: 2, flag: 'blacklist', state: true, apiToken: 'k' }),
      /deck lookup failed/,
    );
  } finally {
    (config as any).getDeckId = orig;
  }
});

test('immersion search errors and youtube transcript errors surface', async () => {
  __resetApiForTests();
  const r = mockFetch(async () => errStatus(500, 'bad'));
  try {
    await assert.rejects(() => immersionKitApi.search('x'), /search 500/);
    await assert.rejects(() => youtubeApi.fetchTranscript('https://t'), /transcript 500/);
    await assert.rejects(() => youtubeApi.fetchWatchPage('https://w'), /watch 500/);
    await assert.rejects(() => kanjiApi.fetchKanji('日'), /kanji 500/);
  } finally {
    r();
  }
});

test('submitReview posts and surfaces errors', async () => {
  __resetApiForTests();
  const origSessionFetch = (session as any).sessionFetch;
  (session as any).sessionFetch = async () => ({ status: 200, text: 'submitted' });
  try {
    assert.equal(await jpdbApi.submitReview({ vid: 1, sid: 2, reviewNo: 3, grade: '4' }), 'submitted');
  } finally {
    (session as any).sessionFetch = origSessionFetch;
  }
  (session as any).sessionFetch = async () => { throw new Error('no bridge'); };
  const r = mockFetch(async () => errStatus(500, 'e'));
  try {
    await assert.rejects(() => jpdbApi.submitReview({ vid: 1, sid: 2, reviewNo: 3, grade: '4' }), /submit review/);
  } finally {
    r();
    (session as any).sessionFetch = origSessionFetch;
  }
});

test('deck endpoints tolerate non-JSON error bodies', async () => {
  __resetApiForTests();
  const r = mockFetch(async () => errStatus(400, 'plain text'));
  try {
    await assert.rejects(() => jpdbApi.parse({ text: ['x'], apiToken: 't' }), /JPDB parse 400/);
    await assert.rejects(() => jpdbApi.addVocabulary({ deckId: 1, vocabulary: [[1, 2]], apiToken: 't' }), /addVocabulary 400/);
    await assert.rejects(() => jpdbApi.removeVocabulary({ deckId: 1, vocabulary: [[1, 2]], apiToken: 't' }), /removeVocabulary 400/);
    await assert.rejects(() => jpdbApi.setCardSentence({ vid: 1, sid: 2, apiToken: 't' }), /setCardSentence 400/);
  } finally {
    r();
  }
});

test('getAudioHash annotates bridge errors', async () => {
  __resetApiForTests();
  const origPage = (jpdbApi as any).fetchVocabularyPage;
  const sess = await import('../session');
  (sess as any).__resetSessionForTests();
  // seed a bridge error via a failed job
  (sess as any).registerSessionExecutor(() => {});
  (sess as any).markSessionReady();
  try {
    (jpdbApi as any).fetchVocabularyPage = async () => { throw new JpdbError('down', 500); };
    // force lastSessionJobError by driving a failed session job
    await assert.rejects(() => jpdbApi.getAudioHash({ vid: 1, spelling: 'x' }), /down/);
  } finally {
    (jpdbApi as any).fetchVocabularyPage = origPage;
    (sess as any).__resetSessionForTests();
  }
});

test('scrape happy paths via session', async () => {
  __resetApiForTests();
  const origSessionFetch = (session as any).sessionFetch;
  try {
    (session as any).sessionFetch = async () => ({ status: 200, text: '<html>ok</html>' });
    __resetApiForTests();
    assert.equal(await jpdbApi.prioritize({ vid: 1, sid: 2 }), '<html>ok</html>');
    __resetApiForTests();
    assert.equal(await jpdbApi.deprioritize({ vid: 1, sid: 2 }), '<html>ok</html>');
    __resetApiForTests();
    assert.equal(await jpdbApi.fetchReviewPage({ vid: 1, sid: 2 }), '<html>ok</html>');
    __resetApiForTests();
    assert.equal(await jpdbApi.submitReview({ vid: 1, sid: 2, reviewNo: 1, grade: '4' }), '<html>ok</html>');
    __resetApiForTests();
    assert.ok(await jpdbApi.fetchVocabularyPage({ vid: 1, spelling: 'x' }), 'session text');
  } finally {
    (session as any).sessionFetch = origSessionFetch;
  }
});

test('setFlag remove path and mine variants', async () => {
  __resetApiForTests();
  const config = await import('../config');
  const origGetDeckId = (config as any).getDeckId;
  const origAdd = jpdbApi.addVocabulary;
  const origRemove = jpdbApi.removeVocabulary;
  const origLoad = (config as any).loadConfig;
  try {
    (config as any).getDeckId = async () => 9;
    let removed = 0;
    (jpdbApi as any).removeVocabulary = async () => { removed++; return {}; };
    await jpdbApi.setFlag({ vid: 1, sid: 2, flag: 'never-forget', state: false, apiToken: 'k' });
    assert.equal(removed, 1);
    // mine without forq/review/sentence
    (config as any).loadConfig = async () => ({ miningDeckId: 3, forqDeckId: 'forq', forqOnMine: false });
    let added = 0;
    (jpdbApi as any).addVocabulary = async () => { added++; return {}; };
    await (jpdbApi as any).mine({ vid: 1, sid: 2, apiToken: 'k', forq: false });
    assert.equal(added, 1);
  } finally {
    (config as any).getDeckId = origGetDeckId;
    (jpdbApi as any).addVocabulary = origAdd;
    (jpdbApi as any).removeVocabulary = origRemove;
    (config as any).loadConfig = origLoad;
  }
});

test('gemini explicit model, blocked response and passthrough errors', async () => {
  __resetApiForTests();
  const r1 = mockFetch(async () => okJson({ promptFeedback: { blockReason: 'SAFETY' } }));
  try {
    await assert.rejects(() => geminiApi.explainWord({ apiKey: 'k', prompt: 'p', model: 'm1' }), /no text.*SAFETY/);
  } finally {
    r1();
  }
  const r2 = mockFetch(async () => errStatus(400, JSON.stringify({ error: { message: 'bad key' } })));
  try {
    await assert.rejects(() => geminiApi.explainWord({ apiKey: 'k', prompt: 'p' }), /bad key/);
  } finally {
    r2();
  }
});

test('request retry recovers from 503 then succeeds', async () => {
  __resetApiForTests();
  let calls = 0;
  const restore = mockFetch(async () => {
    calls++;
    if (calls === 1) return errStatus(503, 'busy');
    return okJson({ vocabulary_info: [[['new']]] });
  });
  try {
    assert.deepEqual(await jpdbApi.lookupVocabulary({ list: [[1, 2]], apiToken: 't' }), { vocabulary_info: [[['new']]] });
    assert.equal(calls, 2);
  } finally {
    restore();
  }
});
