// Yomibako WebView bridge - LEGACY fallback, NOT injected by MokuroWebView
// (MokuroWebView injects only yomibakoBundle.ts YOMIBAKO_JS, which owns the
// __yomibakoInjected guard + full chunked pipeline. Kept for reference/tests.)
// Replaces browser.runtime.connect with ReactNativeWebView.postMessage
// Bundles logic from assets/jpd-breader without needing ES imports in WebView

export const YOMIBAKO_BRIDGE_JS = `
(function(){
  // Prevent double inject (own flag — never collides with YOMIBAKO_JS)
  if (window.__yomibakoBridgeInjected) return; window.__yomibakoBridgeInjected = true;

  // Stub browser API expected by jpd-breader modules
  window.browser = window.browser || { runtime: { getURL: (p)=> p, connect: ()=>({ onMessage:{addListener:()=>{}}, onDisconnect:{addListener:()=>{}}, postMessage:()=>{} }) }, storage: { sync: { get: async()=>({}), set: async()=>{} } } };
  window.chrome = window.browser;

  // Intercept fetch to jpdb so we can proxy via RN if needed
  const origFetch = window.fetch;
  window.__yomibakoParseQueue = [];
  window.__yomibakoPostParse = (texts) => {
    return new Promise((resolve, reject)=>{
      window.__yomibakoResolve = resolve;
      window.__yomibakoReject = reject;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type:'parse', texts }));
      // timeout 15s
      setTimeout(()=> reject(new Error('jpdb timeout')), 15000);
    });
  };

  // Minimal applyTokens port for fallback (full bundle will override)
  // This is used if assets/jpd-breader/content/parse.js not bundled
  window.__yomibakoApplyTokens = function(fragments, tokens){
    // fragments: [{node, start, end}] tokens: from jpdbApi.parse
    // Simplified - full logic in parse.js:93 will be injected via separate bundle
    console.log('[yomibako] applyTokens', fragments.length, tokens.length);
  };

  // Hook mokuro.js visibility observer to RN
  const obs = new IntersectionObserver((entries)=>{
    const visible = entries.filter(e=>e.isIntersecting).map(e=>e.target);
    if (visible.length) {
      // Each page: #pagesContainer > div
      visible.forEach(page=>{
        // Notify RN that page became visible - RN can prefetch jpdb
        // window.ReactNativeWebView.postMessage(JSON.stringify({type:'pageVisible', id: page.id}));
      });
    }
  }, { rootMargin: '200px', threshold: 0 });

  function observeMokuroPages(){
    const pages = document.querySelectorAll('#pagesContainer > div');
    pages.forEach(p=> obs.observe(p));
    if (pages.length) console.log('[yomibako] observing', pages.length, 'pages');
  }

  // TextBox tap -> send to RN bottom sheet (instead of hover popup)
  document.addEventListener('click', (e)=>{
    const t = e.target.closest('.jpdb-word');
    if (t && t.jpdbData) {
      e.preventDefault();
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'lookup',
        vid: t.jpdbData.token.card.vid,
        sid: t.jpdbData.token.card.sid,
        spelling: t.jpdbData.token.card.spelling,
        reading: t.jpdbData.token.card.reading,
        state: t.jpdbData.token.card.state,
      }));
    }
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeMokuroPages);
  else observeMokuroPages();

  // Expose for RN to trigger
  window.__yomibakoObserve = observeMokuroPages;
  console.log('[yomibako] bridge injected, awaiting jpdb');
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'bridgeReady'}));
})();
true;
`;

// Full jpd-breader bundle injection (concatenates the actual source files for WebView)
// We inline util.js + jsx.js + word.js + parse.js + common.js + mokuro.js stripped of imports
export async function buildFullBundle(): Promise<string> {
  // In production this would be built at bundle time via Metro asset. For dev we fetch via FileSystem
  // Placeholder - returns bridge only; to wire full parse.js:93 applyTokens, copy assets/jpd-breader/content/parse.js into WebView
  return YOMIBAKO_BRIDGE_JS;
}
