// Full Yomibako bundle - injects word.css + parse.js applyTokens + mokuro observer
// Copy of D:\Projects\Yomibako\assets\jpd-breader\content\parse.js + jsx.js adapted for RN WebView (no imports)
// Surpasses Google/Apple: calm color-only states, furigana <rt>, tap→RN bridge
//
// Chunked pipeline (mirrors browserBundle.ts): each page's textBoxes are split
// into bounded chunks (<= MAX_CHUNK_CHARS / MAX_CHUNK_PARAS) so neither the
// JPDB request nor the injected token reply can freeze the WebView. Max
// MAX_INFLIGHT round-trips at once; failures stay eligible for retry.

export const YOMIBAKO_CSS = `
:where(rt){user-select:none;pointer-events:none}
:where(.jpdb-word ruby, .jpdb-word rt){color:inherit!important;font-size:inherit}
:where(.jpdb-word rt){font-size:60%}
:where(.jpdb-word:not(.unparsed)){cursor:pointer;transition:background-color 0.15s ease;border-radius:2px}
:where(.jpdb-word:not(.unparsed):hover){background-color:rgba(128,128,128,0.08)}
:where(.jpdb-word.locked){color:rgb(119,119,119);opacity:0.6}
:where(.jpdb-word.suspended){color:rgb(119,119,119);opacity:0.45}
:where(.jpdb-word.blacklisted){color:rgb(119,119,119);opacity:0.35}
:where(.jpdb-word.never-forget){color:rgb(112,192,0)}
:where(.jpdb-word.not-in-deck){color:crimson}
:where(.jpdb-word.new){color:rgb(75,141,255)}
:where(.jpdb-word.learning){color:rgb(94,167,128)}
:where(.jpdb-word.known){color:inherit;opacity:0.92}
:where(.jpdb-word.due){color:rgb(255,69,0)}
:where(.jpdb-word.failed){color:rgb(255,0,0)}
:where(.jpdb-word.not-in-deck:hover){background-color:rgba(220,20,60,0.06)}
:where(.jpdb-word.new:hover){background-color:rgba(75,141,255,0.07)}
:where(.jpdb-word.learning:hover),:where(.jpdb-word.never-forget:hover){background-color:rgba(94,167,128,0.08)}
:where(.jpdb-word.nav-highlight){outline:none;box-shadow:0 0 0 2px rgba(75,141,255,0.4),0 0 8px rgba(75,141,255,0.15);border-radius:3px;animation:jpdb-nav-pulse 0.6s ease-out}
@keyframes jpdb-nav-pulse{0%{box-shadow:0 0 0 4px rgba(75,141,255,0.5),0 0 16px rgba(75,141,255,0.3)}100%{box-shadow:0 0 0 2px rgba(75,141,255,0.4),0 0 8px rgba(75,141,255,0.15)}}
:where(.jpdb-word rt.jpdb-furi){font-size:0.6em;color:inherit;opacity:0.9}
/* mokuro textBox hover */
.pageContainer:hover .textBox{border:2px solid rgba(237,28,36,0.5)}
.textBox{position:absolute;border:1px solid transparent;transition:border 0.15s}
`;

export const YOMIBAKO_JS = `
(function(){
  if(window.__yomibakoInjected) return; window.__yomibakoInjected=true;
  console.log('[yomibako] injecting full parse bundle');

  // --- helpers (port of jsx.js + util.js) ---
  function nonNull(o){ if(o==null) throw Error('null'); return o; }
  function jsxCreateElement(name, props, ...content){
    const el=document.createElement(name);
    if(props) for(const [k,v] of Object.entries(props)){
      if(k.startsWith('on') && v instanceof Function){ el.addEventListener(k.slice(2).toLowerCase(), async(...a)=>{ try{ await v(...a);}catch(e){ console.error(e);} }); }
      else if(v!==false) el.setAttribute(k, String(v));
    }
    el.append(...content.flat().filter(c=>c!=null));
    return el;
  }

  function post(type, extra){
    try{
      const RN = window.ReactNativeWebView;
      if(RN && RN.postMessage) RN.postMessage(JSON.stringify(Object.assign({type}, extra||{})));
    }catch(_){}
  }

  // tap handler -> RN WordSheet (replaces onWordHoverStart) — full card parity minus Anki
  function onWordTap(e){
    try { e.preventDefault(); e.stopPropagation(); } catch(_){}
    const t=e.currentTarget;
    if(!t.jpdbData) return;
    const d=t.jpdbData.token.card;
    post('lookup', {
      vid:d.vid, sid:d.sid, spelling:d.spelling, reading:d.reading,
      state:d.state, meanings:d.meanings, frequencyRank:d.frequencyRank, pitchAccent:d.pitchAccent, partOfSpeech:d.partOfSpeech,
      context:t.jpdbData.context, contextOffset:t.jpdbData.contextOffset
    });
  }
  // Background tap (not on a word) -> RN toggles chrome. No overlay may sit
  // above the WebView or taps never reach the page.
  document.addEventListener('click', (e)=>{
    const t=e.target;
    if(t && t.closest && t.closest('.jpdb-word')) return;
    post('tap');
  });

  // --- parse.js core (applyTokens), returns wrapped span count ---
  function splitFragment(fragments, idx, offset){
    const old=fragments[idx];
    const newNode=old.node.splitText(offset - old.start);
    const nf={ start:offset, end:old.end, length:old.end-offset, node:newNode, hasRuby: old.hasRuby };
    fragments.splice(idx+1,0,nf);
    old.end=offset; old.length=offset-old.start;
  }
  function insertBefore(n, ref){ nonNull(ref.parentElement).insertBefore(n, ref); }
  function insertAfter(n, ref){
    const p=nonNull(ref.parentElement); const s=ref.nextSibling;
    if(s) p.insertBefore(n,s); else p.appendChild(n);
  }
  function wrap(node, wrapper){ insertBefore(wrapper, node); wrapper.append(node); }

  window.__yomibakoReverseIndex = window.__yomibakoReverseIndex || new Map();
  const reverseIndex = window.__yomibakoReverseIndex;
  const REVERSE_MAX=10000;

  function applyTokens(fragments, tokens){
    if(reverseIndex.size>REVERSE_MAX){ let i=0; const del=Math.floor(REVERSE_MAX/2); for(const k of reverseIndex.keys()){ if(i++>=del) break; reverseIndex.delete(k);} }
    let fi=0, cur=0; let frag=fragments[fi];
    let spans=0;
    const text=fragments.map(x=>x.node.data).join('');
    for(const token of tokens){
      if(!frag) return spans;
      while(cur < token.start){
        if(frag.end > token.start) splitFragment(fragments, fi, token.start);
        wrap(frag.node, jsxCreateElement('span',{class:'jpdb-word unparsed'}));
        cur+=frag.length; frag=fragments[++fi]; if(!frag) return spans;
      }
      while(cur < token.end){
        if(frag.end > token.end) splitFragment(fragments, fi, token.end);
        const className='jpdb-word '+token.card.state.join(' ');
        const wrapper=(token.rubies.length>0 && !frag.hasRuby)
          ? jsxCreateElement('ruby',{class:className})
          : jsxCreateElement('span',{class:className});
        wrapper.addEventListener('click', onWordTap);
        const key=token.card.vid+'/'+token.card.sid;
        const idx=reverseIndex.get(key);
        if(!idx) reverseIndex.set(key,{className, elements:[wrapper]});
        else idx.elements.push(wrapper);
        wrapper.jpdbData={ token, context:text, contextOffset:cur };
        wrap(frag.node, wrapper);
        spans++;
        if(!frag.hasRuby){
          for(const ruby of token.rubies){
            if(ruby.start>=frag.start && ruby.end<=frag.end){
              if(ruby.start>frag.start){ splitFragment(fragments, fi, ruby.start); insertAfter(jsxCreateElement('rt',null), frag.node); frag=fragments[++fi]; }
              if(ruby.end<frag.end){ splitFragment(fragments, fi, ruby.end); insertAfter(jsxCreateElement('rt',{class:'jpdb-furi'}, ruby.text), frag.node); frag=fragments[++fi]; }
              else insertAfter(jsxCreateElement('rt',{class:'jpdb-furi'}, ruby.text), frag.node);
            }
          }
        }
        cur=frag.end; frag=fragments[++fi]; if(!frag) break;
      }
    }
    for(const frag of fragments.slice(fi)){
      wrap(frag.node, jsxCreateElement('span',{class:'jpdb-word unparsed'}));
    }
    return spans;
  }
  window.__yomibakoApplyTokens = applyTokens;

  // --- RN bridge: pending parse round-trips + chunked token reassembly ---
  let seq=0;
  const pending=new Map();
  window.__yomibakoChunkBuf = window.__yomibakoChunkBuf || {};
  window.__yomibakoOnTokens = function(id, tokensArray){
    const p=pending.get(id); if(p) { pending.delete(id); try{ p.resolve(tokensArray); }catch(e){ console.warn('[yomibako] resolve failed', e); } }
  };
  window.__yomibakoOnError = function(id, err){ const p=pending.get(id); if(p){ pending.delete(id); try{ p.reject(err); }catch(_){} } };
  // RN splits token payloads > ~25KB into indexed string slices (giant
  // injectJavaScript payloads die silently on Android). Reassemble then resolve.
  window.__yomibakoOnTokensChunk = function(id, idx, total, part){
    try{
      let b=window.__yomibakoChunkBuf[id];
      if(!b){ b=window.__yomibakoChunkBuf[id]={parts:new Array(total), total:total}; }
      b.parts[idx]=part;
      let got=0; for(let i=0;i<b.total;i++){ if(b.parts[i]!==undefined) got++; }
      if(got>=b.total){
        const full=b.parts.join('');
        delete window.__yomibakoChunkBuf[id];
        const arr=JSON.parse(full);
        window.__yomibakoOnTokens(id, arr);
      }
    }catch(e){ console.warn('[yomibako] chunk reassemble failed', e); try{ delete window.__yomibakoChunkBuf[id]; }catch(_){} }
  };

  // --- chunked parse scheduler (one RN round-trip per bounded chunk) ---
  const MAX_CHUNK_CHARS = 4000;
  const MAX_CHUNK_PARAS = 15;
  const MAX_INFLIGHT = 3;
  let inflightParse = 0;
  const parseQueue = [];
  const pendingBatchesMap = new Map(); // pageEl -> true while in flight
  function pumpParseQueue(){
    while(inflightParse < MAX_INFLIGHT && parseQueue.length){
      const run = parseQueue.shift();
      try{ run(); }catch(e){ console.warn('[yomibako] queue run failed', e); }
    }
  }

  function markDone(page, ok){
    try{
      if(ok){ page.dataset.yomibakoParsed='1'; try{ observer.unobserve(page); }catch(_){} }
    }catch(_){}
    try{ pendingBatchesMap.delete(page); }catch(_){}
  }

  function requestParseForPage(page, paragraphs){
    const usable = paragraphs.filter(frags=>{
      const t = frags.map(f=>f.node.data).join('');
      return t.trim().length > 0;
    });
    if(!usable.length){ markDone(page, true); return; }
    // Split into bounded chunks — one RN round-trip per chunk
    const chunks=[]; let cur=[], curLen=0;
    for(const frags of usable){
      const len = frags.reduce((a,f)=>a + (f.node.data ? f.node.data.length : 0), 0);
      if(cur.length && (curLen + len > MAX_CHUNK_CHARS || cur.length >= MAX_CHUNK_PARAS)){ chunks.push(cur); cur=[]; curLen=0; }
      cur.push(frags); curLen += len;
    }
    if(cur.length) chunks.push(cur);
    let remaining = chunks.length;
    let anyFail = false;
    let anySkip = false;
    const onChunkSettled = (ok, skipped)=>{
      if(!ok) anyFail = true;
      if(skipped) anySkip = true;
      remaining--;
      if(remaining <= 0){
        // Skipped chunks (scrolled far away) must NOT mark the page parsed —
        // it stays observed and re-queues when scrolled back into view.
        if(anySkip && !anyFail){ try{ pendingBatchesMap.delete(page); }catch(_){} }
        else markDone(page, !anyFail);
      }
    };
    for(const chunkParts of chunks){
      const batches = chunkParts.map(frags=>{
        const text=frags.map(f=>f.node.data).join('');
        const s=seq++;
        return { frags, text, seq:s };
      });
      const texts=batches.map(b=>[b.seq,b.text]);
      const id=Math.random().toString(36).slice(2);
      const run = ()=>{
        // Skip queued work that scrolled far away — it re-queues on re-entry
        try{
          if(page && page.isConnected){
            const r = page.getBoundingClientRect();
            const near = r.bottom > -600 && r.top < (window.innerHeight + 600);
            if(!near){ onChunkSettled(true, true); pumpParseQueue(); return; }
          }
        }catch(_){}
        inflightParse++;
        const promise=new Promise((resolve,reject)=>{ pending.set(id,{resolve,reject}); });
        // Safety: auto-reject wedged chunks so the page stays retryable
        setTimeout(()=>{ if(pending.has(id)){ try{ pending.get(id).reject(new Error('jpdb timeout')); }catch(_){} pending.delete(id); } }, 15000);
        post('parse', { texts, id });
        promise.then(tokensArray=>{
          let spans=0;
          try{
            batches.forEach((b,i)=>{
              const toks=tokensArray && tokensArray[i];
              if(toks) spans+=applyTokens(b.frags, toks);
            });
            post('applied', { id, spans });
          }catch(err){ console.warn('[yomibako] apply failed', err); post('applyError', { id, error: String((err && err.message) || err).slice(0,200) }); }
          onChunkSettled(true);
        }).catch(err=>{
          console.warn('[yomibako] parse failed', err);
          try{ post('parseError', { id, error: String((err && err.message) || err).slice(0,200) }); }catch(_){}
          onChunkSettled(false);
        }).finally(()=>{ inflightParse--; pumpParseQueue(); });
      };
      if(inflightParse < MAX_INFLIGHT) run();
      else parseQueue.push(run);
    }
  }

  // --- mokuro observer ---
  // Page containers differ across mokuro versions — try known selectors.
  function pageEls(){
    let p=document.querySelectorAll('#pagesContainer > div');
    if(p.length) return {els:p, sel:'#pagesContainer > div'};
    p=document.querySelectorAll('#pagesContainer .page');
    if(p.length) return {els:p, sel:'#pagesContainer .page'};
    p=document.querySelectorAll('.page');
    if(p.length) return {els:p, sel:'.page'};
    p=document.querySelectorAll('#pagesContainer img');
    if(p.length) return {els:p, sel:'#pagesContainer img(fallback)'};
    return {els:p, sel:'none'};
  }
  // Text lives in .textBox, but inner markup varies (<p>, bare text, <br>,
  // <span>). Collect every non-empty text node so nothing is silently skipped.
  function boxFrags(box){
    const frags=[]; let off=0;
    const walker=document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const nodes=[]; let tn;
    while((tn=walker.nextNode())) nodes.push(tn);
    for(const t of nodes){
      const data=t.data; if(!data || !data.trim()) continue;
      const start=off; off+=data.length;
      frags.push({ node:t, start, end:off, length:data.length, hasRuby:false });
    }
    return frags;
  }
  const observer=new IntersectionObserver((entries)=>{
    const visible=entries.filter(e=>e.isIntersecting).map(e=>e.target);
    for(const page of visible){
      if(!(page instanceof HTMLElement)) continue;
      if(page.dataset && page.dataset.yomibakoParsed==='1'){ try{ observer.unobserve(page); }catch(_){} continue; }
      if(pendingBatchesMap.has(page)) continue;
      const paragraphs=[...page.querySelectorAll('.textBox')].map(boxFrags).filter(f=>f.length>0);
      // Fallback: page itself holds text but no .textBox (variant markup).
      if(paragraphs.length===0){
        const direct=boxFrags(page);
        if(direct.length>0) paragraphs.push(direct);
      }
      if(paragraphs.length===0){ try{ page.dataset.yomibakoParsed='1'; observer.unobserve(page); }catch(_){} continue; }
      pendingBatchesMap.set(page, true);
      requestParseForPage(page, paragraphs);
    }
  },{ rootMargin:'200px', threshold:0 });

  // --- image lazy loader for SAF content:// (no 50MB copy, direct stream) ---
  const imgCache=new Map();
  const imgPending=new Map();
  const imgObserver=new IntersectionObserver((entries)=>{
    for(const e of entries){
      if(!e.isIntersecting) continue;
      const img=e.target;
      imgObserver.unobserve(img);
      const orig=img.dataset.yomibakoOrig || img.getAttribute('src');
      if(!orig || orig.startsWith('data:')) continue;
      if(imgCache.has(orig)){ img.src=imgCache.get(orig); continue; }
      const id=Math.random().toString(36).slice(2);
      imgPending.set(id, img);
      post('fetchImage', { orig, id });
    }
  },{ rootMargin:'600px', threshold:0 });

  function setupImages(){
    // Cache-copy mode: images are real file:// URLs that load natively —
    // do NOT swap them for placeholders (that path blanks every page).
    if ((window).__yomibakoDirectFile) return;
    const imgs=document.querySelectorAll('#pagesContainer img');
    imgs.forEach(img=>{
      const orig=img.dataset.yomibakoOrig || img.getAttribute('src');
      if(!orig || orig.startsWith('data:')) return;
      // Already replaced by RN preprocessing to data-yomibako-orig + placeholder, just observe
      if(!img.dataset.yomibakoOrig) img.dataset.yomibakoOrig=orig;
      // Ensure placeholder to prevent WebView 404 on content://
      if(!img.src.startsWith('data:')) img.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      imgObserver.observe(img);
    });
  }
  window.__yomibakoOnImage=function(id, dataUri){
    const img=imgPending.get(id); imgPending.delete(id);
    if(!img) return;
    const orig=img.dataset.yomibakoOrig;
    if(dataUri) { imgCache.set(orig, dataUri); img.src=dataUri; img.style.background='#111'; }
  };
  window.__yomibakoOnImageError=function(id, err){ const img=imgPending.get(id); if(img) imgPending.delete(id); console.warn('[yomibako] image',err); };

  function observePages(){
    const {els: pages, sel} = pageEls();
    pages.forEach(p=>{
      if(p.dataset && p.dataset.yomibakoParsed==='1') return;
      try{ observer.observe(p); }catch(_){}
    });
    const boxes=document.querySelectorAll('.textBox').length;
    console.log('[yomibako] observing', pages.length, 'pages via', sel, boxes, 'textBoxes');
    setupImages();
    post('bridgeReady', { pages: pages.length, sel, boxes });
  }

  // Retry hook for the native side — re-queues anything unparsed
  window.__yomibakoRetry = function(){
    try{
      const {els: pages} = pageEls();
      pages.forEach(p=>{
        if(p.dataset && p.dataset.yomibakoParsed==='1') return;
        if(pendingBatchesMap.has(p)) return;
        try{ observer.observe(p); }catch(_){}
      });
    }catch(_){}
  };

  // Late-added pages (large volumes / slow image layout) — observe on arrival.
  try{
    const mo=new MutationObserver((mutations)=>{
      for(const m of mutations){
        for(const node of m.addedNodes){
          if(!(node instanceof HTMLElement)) continue;
          if(node.matches && (node.matches('#pagesContainer > div') || node.matches('#pagesContainer .page') || node.matches('.page'))){
            if(!(node.dataset && node.dataset.yomibakoParsed==='1')){ try{ observer.observe(node); }catch(_){} }
          }
          if(node.querySelectorAll){
            const {els} = pageEls();
            // cheap: only observe unparsed newcomers
            els.forEach(p=>{ if(!(p.dataset && p.dataset.yomibakoParsed==='1') && !pendingBatchesMap.has(p)){ try{ observer.observe(p); }catch(_){} } });
          }
        }
      }
    });
    const root=document.getElementById('pagesContainer') || document.body;
    mo.observe(root, { childList:true, subtree:true });
  }catch(_){}

  // expose
  window.__yomibakoObserve=observePages;

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', observePages);
  else observePages();
})();
true;
`;
