// Browser bundle for generic jpd-breader site integrations (without Anki)
// Supports: ttu, anacreon/texthooker, readwok, wikipedia/syosetu, youtube, bunpro, nhk/jpdb generic
// Anki domains (ankiuser.net, ankiweb.net) explicitly excluded per user request

export const BROWSER_CSS = `
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
:where(.jpdb-word.nav-highlight){outline:none;box-shadow:0 0 0 2px rgba(75,141,255,0.4),0 0 8px rgba(75,141,255,0.15);border-radius:3px;animation:jpdb-nav-pulse 0.6s ease-out}
@keyframes jpdb-nav-pulse{0%{box-shadow:0 0 0 4px rgba(75,141,255,0.5),0 0 16px rgba(75,141,255,0.3)}100%{box-shadow:0 0 0 2px rgba(75,141,255,0.4),0 0 8px rgba(75,141,255,0.15)}}
:where(.jpdb-word rt.jpdb-furi){font-size:0.6em;color:inherit;opacity:0.9}
`;

export const BROWSER_JS = `
(function(){
  if(window.__yomibakoBrowserInjected) return; window.__yomibakoBrowserInjected = true;
  console.log('[yomibako-browser] injecting generic parse bundle');

  // Block Anki domains explicitly (user requested removal)
  const blockedAnki = ["ankiuser.net","ankiweb.net"];
  if(blockedAnki.some(d=>location.hostname.includes(d))){
    console.log('[yomibako-browser] Anki domain blocked per config');
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'blocked', reason:'anki'}));
    return;
  }

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
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
        JSON.stringify(Object.assign({type:type},extra||{}))
      );
    }catch(_){}
  }

  // displayCategory port from content/parse.js — needed for paragraphsInNode
  const displayCategoryCache = new Map();
  function displayCategory(node){
    if(node instanceof Text || node instanceof CDATASection) return 'text';
    if(node instanceof Element){
      if(node.tagName==='RUBY') return 'ruby';
      if(node.tagName==='RP') return 'none';
      if(node.tagName==='RT') return 'ruby-text';
      if(node.tagName==='RB') return 'inline';
      const cacheKey = node.tagName+'|'+(node.className||'');
      if(displayCategoryCache.has(cacheKey)) return displayCategoryCache.get(cacheKey);
      const display = getComputedStyle(node).display.split(/\\s/g);
      let cat;
      if(display[0]==='none') cat='none';
      else if(display.some(x=>x.startsWith('block'))) cat='block';
      else if(display.some(x=>x.startsWith('inline'))) cat='inline';
      else if(display[0]==='flex') cat='block';
      else if(display[0]==='ruby') cat='ruby';
      else if(display[0].startsWith('ruby-text')) cat='ruby-text';
      else if(display[0].startsWith('ruby-base')) cat='inline';
      else if(display[0]==='contents') cat='inline';
      else cat='none';
      displayCategoryCache.set(cacheKey, cat);
      if(displayCategoryCache.size>1000){ const first=displayCategoryCache.keys().next().value; displayCategoryCache.delete(first); }
      return cat;
    }
    return 'none';
  }

  function openWord(t,type='lookup',ev){
    if(!t.jpdbData) return;
    const d=t.jpdbData.token.card;
    // Mirrors the reader bundle: per-fragment rects so a wrapped word anchors
    // to the line the pointer is on, the owning block so the popup does not
    // cover the paragraph being read, and the contact point so it clears the
    // reader's own finger.
    var rect=null, rects=null, boxRect=null, point=null, pointerType='touch', vertical=false;
    try{
      var r=t.getBoundingClientRect();
      rect={x:r.left,y:r.top,w:r.width,h:r.height};
      var list=t.getClientRects(), acc=[];
      for(var i=0;i<list.length;i++){
        var c=list[i];
        if(c.width>0&&c.height>0) acc.push({x:c.left,y:c.top,w:c.width,h:c.height});
      }
      if(acc.length) rects=acc;
      var block=t.closest? t.closest('p,li,dd,blockquote,h1,h2,h3,h4,h5,h6,td,figcaption') : null;
      if(block){
        var b=block.getBoundingClientRect();
        // A block taller than the viewport leaves no slot anywhere, which would
        // force the edge fallback on every lookup. Only avoid blocks the reader
        // can actually take in at once.
        if(b.width>0&&b.height>0&&b.height<=window.innerHeight*0.6) boxRect={x:b.left,y:b.top,w:b.width,h:b.height};
      }
      var wm=(window.getComputedStyle(t).writingMode||'');
      vertical=wm.indexOf('vertical')===0 || wm==='tb' || wm==='tb-rl';
    }catch(_){}
    if(ev){
      if(typeof ev.clientX==='number'&&typeof ev.clientY==='number') point={x:ev.clientX,y:ev.clientY};
      if(ev.pointerType) pointerType = ev.pointerType==='mouse' ? 'mouse' : 'touch';
    }
    // getBoundingClientRect is layout-viewport relative. On a pinch-zoomed page
    // the visual viewport is what the user actually sees, so report it and let
    // the native side correct for it.
    var vv=window.visualViewport;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type:type,
      vid:d.vid, sid:d.sid, spelling:d.spelling, reading:d.reading,
      state:d.state, meanings:d.meanings, frequencyRank:d.frequencyRank, pitchAccent:d.pitchAccent, partOfSpeech:d.partOfSpeech,
      context:t.jpdbData.context, contextOffset:t.jpdbData.contextOffset,
      rect:rect, rects:rects, boxRect:boxRect, point:point, pointerType:pointerType,
      vertical:vertical, vw:window.innerWidth, vh:window.innerHeight,
      visual: vv ? { scale:vv.scale, offsetLeft:vv.offsetLeft, offsetTop:vv.offsetTop, width:vv.width } : null
    }));
  }

  function onWordTap(e){
    try { e.preventDefault(); e.stopPropagation(); } catch(_) {}
    openWord(e.currentTarget,'lookup',e);
  }

  function onWordHover(e){
    // Pointer enter also fires for touch on some WebViews; touch already has
    // the click path and must not schedule duplicate pronunciation.
    if(e.pointerType && e.pointerType!=='mouse') return;
    openWord(e.currentTarget,'hover',e);
  }

  // The popup is native, while the page remains live below it. A page touch
  // outside a word must dismiss the native popup just like Yomitan; do not
  // prevent the website's own click, navigation, or controls.
  document.addEventListener(window.PointerEvent ? 'pointerdown' : 'touchstart',function(e){
    var t=e.target;
    if(t && t.closest && t.closest('.jpdb-word:not(.unparsed)')) return;
    post('backgroundTap');
  },true);

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

  function applyTokens(fragments, tokens){
    let fi=0, cur=0; let frag=fragments[fi];
    const text=fragments.map(x=>x.node.data).join('');
    for(const token of tokens){
      if(!frag) return;
      while(cur < token.start){
        if(frag.end > token.start) splitFragment(fragments, fi, token.start);
        wrap(frag.node, jsxCreateElement('span',{class:'jpdb-word unparsed'}));
        cur+=frag.length; frag=fragments[++fi]; if(!frag) return;
      }
      while(cur < token.end){
        if(frag.end > token.end) splitFragment(fragments, fi, token.end);
        const className='jpdb-word '+token.card.state.join(' ');
        const wrapper=(token.rubies.length>0 && !frag.hasRuby)
          ? jsxCreateElement('ruby',{class:className})
          : jsxCreateElement('span',{class:className});
        wrapper.addEventListener('click', onWordTap);
        wrapper.addEventListener('pointerenter', onWordHover);
        wrapper.jpdbData={ token, context:text, contextOffset:cur };
        const key=token.card.vid+'/'+token.card.sid;
        wrapper.setAttribute('data-yomibako-card',key);
        const idx=reverseIndex.get(key);
        if(!idx) reverseIndex.set(key,{className, elements:[wrapper]});
        else idx.elements.push(wrapper);
        wrap(frag.node, wrapper);
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
  }
  window.__yomibakoApplyTokens = applyTokens;

  window.__yomibakoSetCardState=function(vid,sid,stateArr){
    try{
      const key=vid+'/'+sid;
      const idx=reverseIndex.get(key);
      if(!idx) return 0;
      const className='jpdb-word '+((stateArr&&stateArr.length)?stateArr.join(' '):'not-in-deck');
      const live=[];
      for(const el of idx.elements){
        if(!el || el.isConnected===false) continue;
        el.className=className;
        if(el.jpdbData && el.jpdbData.token && el.jpdbData.token.card) el.jpdbData.token.card.state=stateArr;
        live.push(el);
      }
      idx.className=className;
      idx.elements=live;
      return live.length;
    }catch(_){ return 0; }
  };

  // Hand the parsed words currently ON SCREEN to the native quiz — the reading
  // equivalent of the manga reader's current page. Quizzing a whole article
  // would test text the reader has not reached yet. Cards already carry their
  // meanings, so this costs no extra JPDB call.
  var COLLECT_MAX=200;
  window.__yomibakoCollectWords=function(){
    var out=[], seen={};
    try{
      var vv=window.visualViewport;
      // getBoundingClientRect is layout-viewport relative, so a pinch-zoomed
      // page needs the visual viewport's offsets to know what is really shown.
      var left=vv?vv.offsetLeft:0, top=vv?vv.offsetTop:0;
      var right=left+(vv?vv.width:window.innerWidth);
      var bottom=top+(vv?vv.height:window.innerHeight);
      var spans=document.querySelectorAll('.jpdb-word');
      for(var i=0;i<spans.length;i++){
        var el=spans[i];
        var data=el.jpdbData;
        var card=data && data.token && data.token.card;
        if(!card || !card.spelling) continue;
        if(!el.getBoundingClientRect) continue;
        var r=el.getBoundingClientRect();
        if(r.width<=0 || r.height<=0) continue;
        if(r.bottom<=top || r.top>=bottom || r.right<=left || r.left>=right) continue;
        var key=card.vid+'/'+card.sid;
        if(seen[key]) continue;
        seen[key]=1;
        var means=[], list=card.meanings||[];
        for(var m=0;m<list.length && means.length<3;m++){
          var g=list[m] && list[m].glosses;
          if(g && g.length) means.push(g.join('; '));
        }
        if(!means.length) continue;
        out.push({ vid:card.vid, sid:card.sid, spelling:card.spelling, reading:card.reading, state:card.state, meanings:means });
        if(out.length>=COLLECT_MAX) break;
      }
    }catch(_){}
    post('words', { words: out });
  };

  // paragraphsInNode port from integrations/common.js
  function paragraphsInNode(node, filter=()=>true){
    let offset=0; const fragments=[]; const paragraphs=[];
    function breakParagraph(){
      let end=fragments.length-1;
      for(; end>=0; end--) if(fragments[end].node.data.trim().length>0) break;
      const trimmed=fragments.slice(0,end+1);
      if(trimmed.length) paragraphs.push(trimmed);
      fragments.splice(0); offset=0;
    }
    function pushText(text, hasRuby){
      if(text.data.length>0 && !(fragments.length===0 && text.data.trim().length===0)){
        fragments.push({ start:offset, length:text.length, end:(offset+=text.length), node:text, hasRuby });
      }
    }
    function recurse(n, hasRuby){
      const display=displayCategory(n);
      if(display==='block') breakParagraph();
      if(display==='none' || display==='ruby-text' || filter(n)===false) return;
      if(display==='text') pushText(n, hasRuby);
      else {
        if(display==='ruby') hasRuby=true;
        for(const child of n.childNodes) recurse(child, hasRuby);
        if(display==='block') breakParagraph();
      }
    }
    recurse(node,false);
    // flush remaining
    if(fragments.length){
      let end=fragments.length-1;
      for(; end>=0; end--) if(fragments[end].node.data.trim().length>0) break;
      const trimmed=fragments.slice(0,end+1);
      if(trimmed.length) paragraphs.push(trimmed);
    }
    return paragraphs;
  }

  // Batch / pending like common.js — with chunking + queue so big pages can't wedge the bridge.
  // Each RN message is capped (~5000 chars) so neither the JPDB request nor the
  // injected token payload can freeze the WebView. Max 4 in flight; failures are
  // reported back to RN and the element stays eligible for retry (no blind unobserve).
  let seqCounter=0;
  const pending=new Map(); // id -> {resolve,reject}

  window.__yomibakoOnTokens=function(id,tokensArray){
    const p=pending.get(id); if(p){ p.resolve(tokensArray); pending.delete(id); }
  };
  window.__yomibakoOnError=function(id,err){ const p=pending.get(id); if(p){ p.reject(err); pending.delete(id);} };
  // Chunked counterpart for large parses (mirrors yomibakoBundle): RN splits
  // payloads >30KB into ~20KB slices; reassemble here before resolving.
  var __tokenChunks={};
  window.__yomibakoOnTokensChunk=function(id,i,total,part){
    try{
      var entry=__tokenChunks[id] || (__tokenChunks[id]={parts:[], received:0, total:total});
      entry.parts[i]=part; entry.received++;
      entry.total=total;
      if(entry.received>=total){
        var payload=entry.parts.join('');
        delete __tokenChunks[id];
        var tokensArray=JSON.parse(payload);
        window.__yomibakoOnTokens(id, tokensArray);
      }
    }catch(e){
      delete __tokenChunks[id];
      window.__yomibakoOnError(id, String((e && e.message) || e));
    }
  };

  const MAX_CHUNK_CHARS = 5000;
  const MAX_CHUNK_PARAS = 20;
  const MAX_INFLIGHT = 4;
  let inflightParse = 0;
  const parseQueue = [];
  function pumpParseQueue(){
    while(inflightParse < MAX_INFLIGHT && parseQueue.length){
      const run = parseQueue.shift();
      run();
    }
  }

  function requestParseForParagraphs(paragraphs, el){
    const usable = paragraphs.filter(frags=>{
      const t = frags.map(f=>f.node.data).join('');
      return t.trim().length > 0;
    });
    const markDone = (ok)=>{
      if(!el) return;
      try{
        if(ok){ el.dataset.yomibakoParsed = '1'; visibleObserver.unobserve(el); }
      }catch(_){}
      pendingBatchesMap.delete(el);
    };
    if(!usable.length){ markDone(true); return; }
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
        // Skipped chunks (scrolled far away) must NOT mark the element parsed —
        // it stays observed and re-queues when scrolled back into view.
        if(anySkip && !anyFail){ try{ pendingBatchesMap.delete(el); }catch(_){} }
        else markDone(!anyFail);
      }
    };
    for(const chunkParts of chunks){
      const batches = chunkParts.map(frags=>{
        const text=frags.map(f=>f.node.data).join('');
        const s=seqCounter++;
        return { frags, text, seq:s };
      });
      const texts=batches.map(b=>[b.seq,b.text]);
      const id=Math.random().toString(36).slice(2);
      const run = ()=>{
        // Skip queued work that scrolled far away — it re-queues on re-entry
        // (settled as skipped so the element is NOT marked parsed).
        try{
          if(el && el.isConnected){
            const r = el.getBoundingClientRect();
            const near = r.bottom > -600 && r.top < (window.innerHeight + 600);
            if(!near){ onChunkSettled(true, true); pumpParseQueue(); return; }
          }
        }catch(_){}
        inflightParse++;
        const promise=new Promise((resolve,reject)=>{
          pending.set(id,{resolve,reject});
        });
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'parse', texts, id}));
        promise.then(tokensArray=>{
          try{
            batches.forEach((b,i)=>{
              const toks=tokensArray[i];
              if(toks) applyTokens(b.frags, toks);
            });
          }catch(err){ console.warn('[yomibako-browser] apply failed', err); }
          onChunkSettled(true);
        }).catch(err=>{
          console.warn('[yomibako-browser] parse failed',err);
          try{ window.ReactNativeWebView.postMessage(JSON.stringify({type:'parseError', error:String((err && err.message) || err).slice(0,160)})); }catch(_){}
          onChunkSettled(false);
        }).finally(()=>{ inflightParse--; pumpParseQueue(); });
      };
      if(inflightParse < MAX_INFLIGHT) run();
      else parseQueue.push(run);
    }
  }

  // Site detection (mirrors manifest content_scripts minus Anki)
  function isTTU(){ return location.hostname.includes('reader.ttsu.app') || location.hostname.includes('ttu-ebook'); }
  function isTexthooker(){ return location.href.includes('texthooker') || location.hostname.includes('exSTATic') || location.hostname.includes('renji-xd'); }
  function isReadwok(){ return location.hostname.includes('readwok.com'); }
  function isWikipedia(){ return location.hostname.includes('wikipedia.org') || location.hostname.includes('ncode.syosetu.com'); }
  function isYoutube(){ return location.hostname.includes('youtube.com'); }
  function isBunpro(){ return location.hostname.includes('bunpro.jp'); }
  function isNHK(){ return location.hostname.includes('nhk.or.jp'); }
  function isJPDB(){ return location.hostname.includes('jpdb.io'); }

  function shouldParse(node){
    if(!(node instanceof HTMLElement)) return true;
    // Never re-parse our own overlays — prevents nested spans + parse loops on scroll
    if(node.closest && node.closest('.jpdb-word')) return false;
    if(node.matches('[data-ttu-spoiler-img]')) return false;
    if(isWikipedia() && node.matches('.p-lang-btn,.vector-menu-heading-label,.vector-toc-toggle,.vector-page-toolbar,.mw-editsection,sup.reference')) return false;
    return true;
  }

  function siteSelector(){
    if(isTTU()) return '.book-content p, .book-content div.calibre1';
    if(isTexthooker()) return '.textline, .line_box, .sentence-entry, .my-2.cursor-pointer';
    if(isReadwok()) return 'div[class*="styles_text_"]';
    if(isWikipedia()) return '#firstHeading, #mw-content-text .mw-parser-output > *, .mwe-popups-extract > *';
    if(isBunpro()) return 'div.bp-quiz-question.relative';
    // generic fallback (NHK, JPDB, youtube transcript, others)
    return 'p, h1, h2, h3, li, td, blockquote, .textBox';
  }

  // Intersection observer like parseVisibleObserver — parses once per element.
  // Elements are unobserved only after tokens apply cleanly; failures stay
  // eligible so scrolling or the retry button picks them up again.
  const pendingBatchesMap=new Map();
  const visibleObserver=new IntersectionObserver((entries)=>{
    const entered=entries.filter(e=>e.isIntersecting).map(e=>e.target);
    for(const el of entered){
      if(!(el instanceof HTMLElement)) continue;
      if(el.dataset && el.dataset.yomibakoParsed === '1'){ try{ visibleObserver.unobserve(el); }catch(_){} continue; }
      if(pendingBatchesMap.has(el)) continue;
      const paragraphs=paragraphsInNode(el, shouldParse);
      if(paragraphs.length===0){
        try{ el.dataset.yomibakoParsed = '1'; visibleObserver.unobserve(el); }catch(_){}
        continue;
      }
      // track in-flight to avoid duplicate requests while scrolling
      pendingBatchesMap.set(el, true);
      requestParseForParagraphs(paragraphs, el);
    }
  },{ rootMargin:'200px', threshold:0 });

  function observeExisting(){
    const sel=siteSelector();
    window.__yomibakoSelector = sel;
    const targetSel = isTexthooker() ? (document.querySelector('#textlog, #entry_holder, main') ?? document.body) : document.body;
    // observe current matches (skip already-parsed)
    document.querySelectorAll(sel).forEach(el=>{
      if(el.dataset && el.dataset.yomibakoParsed === '1') return;
      visibleObserver.observe(el);
    });
    // youtube special: handle transcript? For now generic paragraphs
    // mutation observer for dynamic content (like common.js addedObserver)
    // — ignores our own .jpdb-word overlays so applying tokens never retriggers parsing
    const mo=new MutationObserver(mutations=>{
      for(const m of mutations){
        for(const node of m.addedNodes){
          if(!(node instanceof HTMLElement)) continue;
          if(node.closest && node.closest('.jpdb-word')) continue;
          if(node.matches && node.matches(sel)) visibleObserver.observe(node);
          node.querySelectorAll && node.querySelectorAll(sel).forEach(el=>{ if(!(el.dataset && el.dataset.yomibakoParsed === '1')) visibleObserver.observe(el); });
        }
      }
    });
    try{ mo.observe(targetSel, { childList:true, subtree:true }); }catch(_){}
    console.log('[yomibako-browser] observing', sel, 'on', location.hostname);
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'bridgeReady', site: location.hostname, selector: sel}));
  }

  // Retry hook for the native side (status tap) — re-queues anything unparsed
  window.__yomibakoRetry = function(){
    try{
      const sel = window.__yomibakoSelector || siteSelector();
      document.querySelectorAll(sel).forEach(el=>{
        if(el.dataset && el.dataset.yomibakoParsed === '1') return;
        if(el.closest && el.closest('.jpdb-word')) return;
        if(pendingBatchesMap.has(el)) return;
        try{ visibleObserver.observe(el); }catch(_){}
      });
    }catch(_){}
  };

  // youtube transcript via immersion? handled separately via RN fetch if needed — not blocking generic parse
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', observeExisting);
  else observeExisting();

  // expose nav for unknown words (like content.js navigateUnknownWord)
  window.__yomibakoNavigateUnknown=function(dir){
    const words=Array.from(document.querySelectorAll('.jpdb-word.new, .jpdb-word.not-in-deck, .jpdb-word.learning'));
    if(words.length===0) return;
    const curIdx=window.__yomibakoNavIdx ?? -1;
    let next= dir>0 ? Math.min(curIdx+1, words.length-1) : Math.max(curIdx-1,0);
    if(curIdx===-1) next= dir>0?0:words.length-1;
    window.__yomibakoNavIdx=next;
    const w=words[next];
    window.__yomibakoKeepPopupUntil=Date.now()+400;
    w.scrollIntoView({behavior:'auto', block:'center'});
    document.querySelectorAll('.jpdb-word.nav-highlight').forEach(el=>el.classList.remove('nav-highlight'));
    w.classList.add('nav-highlight');
    requestAnimationFrame(function(){ openWord(w); });
  };

  // A native popup cannot follow arbitrary nested webpage scrollers. Close it
  // as soon as its anchor moves instead of leaving it floating in stale space.
  let viewportTimer=null;
  function reportViewportMove(){
    if(Date.now()<(window.__yomibakoKeepPopupUntil||0)) return;
    if(viewportTimer) return;
    viewportTimer=setTimeout(function(){
      viewportTimer=null;
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'viewportChanged'}));
    },80);
  }
  document.addEventListener('scroll',reportViewportMove,true);
  window.addEventListener('resize',reportViewportMove,{passive:true});

  // Inject style
  let st=document.getElementById('yomibako-browser-css');
  if(!st){ st=document.createElement('style'); st.id='yomibako-browser-css'; st.textContent=\`${BROWSER_CSS}\`; document.head.appendChild(st); }

  window.__yomibakoObserve=observeExisting;
})();
true;
`;
