// Full Yomibako bundle - injects word.css + parse.js applyTokens + mokuro observer
// Copy of D:\Projects\Yomibako\assets\jpd-breader\content\parse.js + jsx.js adapted for RN WebView (no imports)
// Surpasses Google/Apple: calm color-only states, furigana <rt>, tap→RN bridge
//
// Chunked pipeline (mirrors browserBundle.ts): each page's textBoxes are split
// into bounded chunks (<= MAX_CHUNK_CHARS / MAX_CHUNK_PARAS) so neither the
// JPDB request nor the injected token reply can freeze the WebView. Max
// MAX_INFLIGHT round-trips at once; failures stay eligible for retry.

// injectedJavaScriptBeforeContentLoaded only runs on document load, so editing
// the strings below does nothing to an already-mounted WebView. Bump this when
// changing them and the reader remounts instead of running the previous build.
export const YOMIBAKO_BUNDLE_VERSION = '2026-09-20.quiz-current-page';

export const YOMIBAKO_CSS = `
/* Mobile reading baseline — kill the blue tap flash, the 300ms click delay and
   Android's automatic font boosting (which shreds mokuro's absolute textBoxes). */
/* Real specificity + !important here on purpose: mokuro paints the backdrop a
   light grey from body{background-color:var(--colorBackground)} and sets that
   variable as an inline style on :root. A :where() rule has zero specificity
   and lost, leaving a bright surround around every page. */
html,body{background-color:#0b0b0c!important}
:where(html,body){-webkit-tap-highlight-color:transparent}
:where(html,body,.textBox,.textBox *){-webkit-text-size-adjust:100%;text-size-adjust:100%}
:where(.jpdb-word,.textBox){touch-action:manipulation}
:where(#pagesContainer img){-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
/* mokuro ships its own fixed toolbar, menu hotspot, dim overlay and edge-nav
   anchors. Yomibako provides all of that as native chrome, so on a phone they
  just overlap the page and swallow taps. Keep them permanently hidden. */
:where(#topMenu,#showMenuA,#dimOverlay,#popupAbout){display:none!important}
:where(#leftAPage,#rightAPage,#leftAScreen,#rightAScreen){display:none!important}
/* Some mobile exports ship a full-size preloader node that warms the next scan
   while staying in normal flow. It then extends the document below the reader
   and reads as a second, ghost manga page. It is never content, so zero it.
   Real specificity + !important on purpose: this must also beat any plain
   inline style mokuro's own preloading code writes onto the node later. */
html #preload-image,html .preload-image,html #preloadImage{
  display:none!important;visibility:hidden!important;content-visibility:hidden!important;
  position:absolute!important;width:0!important;height:0!important;
  min-width:0!important;min-height:0!important;max-width:0!important;max-height:0!important;
  margin:0!important;padding:0!important;border:0!important;background:none!important;
  pointer-events:none!important;contain:strict!important
}
/* One stable full-screen reading surface. The document never scrolls; page
   movement belongs to the transform below, which keeps image and OCR aligned. */
html.yomibako-owned-layout,html.yomibako-owned-layout body{
  width:100%!important;height:100%!important;min-width:100%!important;min-height:100%!important;
  margin:0!important;overflow:hidden!important;overscroll-behavior:none
}
html.yomibako-owned-layout body{display:block!important;margin:0!important}
html.yomibako-owned-layout #pagesContainer{
  position:fixed!important;inset:0!important;display:block!important;
  width:100vw!important;height:100vh!important;transform:none!important;
  overflow:hidden!important;box-sizing:border-box!important;touch-action:none!important
}
/* One transformed element for the whole visible spread, sized in the page's own
   natural pixels. Panning and pinching move this and nothing else, so image and
   OCR boxes can never drift apart. */
html.yomibako-owned-layout #pagesContainer>.yomibako-spread{
  position:absolute!important;left:0!important;top:0!important;
  display:block!important;float:none!important;margin:0!important;
  transform-origin:0 0!important;overflow:visible!important;
  box-sizing:border-box!important;will-change:transform
}
html.yomibako-owned-layout .yomibako-spread>.yomibako-page-slot{
  position:absolute!important;display:block!important;float:none!important;
  margin:0!important;padding:0!important;overflow:hidden!important;box-sizing:border-box!important
}
html.yomibako-owned-layout #pagesContainer>div:not(.yomibako-spread){
  display:none!important;visibility:hidden!important;content-visibility:hidden!important
}
html.yomibako-owned-layout .yomibako-page-surface{
  position:absolute!important;left:0!important;top:0!important;
  transform:none!important;transform-origin:0 0!important;margin:0!important
}
html.yomibako-owned-layout .yomibako-page-enter{animation:yomibako-page-enter 130ms ease-out both}
html.yomibako-reduce-motion .yomibako-page-enter{animation:none!important}
@keyframes yomibako-page-enter{from{opacity:.45}to{opacity:1}}
/* mokuro's own menu is position:fixed at top:0 and would sit under Yomibako's
   floating header when the user opens it from the options bar. */
html.yomibako-mokuro-menu #topMenu,html.yomibako-mokuro-menu #showMenuA{
  display:block!important;top:var(--yomibako-chrome-top,0px)!important;z-index:2!important
}
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
/* OCR geometry is an implementation detail, not reading chrome. Mokuro's own
   hover variable and .hovered class can paint red boxes; suppress every path. */
html .textBox,html .pageContainer:hover .textBox,html .textBox.hovered{
  position:absolute;border-color:transparent!important;outline:none!important;box-shadow:none!important
}
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

  // Send one parsed word to the native lookup. Kept separate from the event
  // handler so a tap made while parsing can be replayed when its spans arrive.
  function openWord(t,type,ev){
    if(!t.jpdbData) return;
    clearPendingTextTap();
    type=type||'lookup';
    const d=t.jpdbData.token.card;
    var anchor=anchorFor(t,ev);
    activeWord = t;
    post(type, {
      vid:d.vid, sid:d.sid, spelling:d.spelling, reading:d.reading,
      state:d.state, meanings:d.meanings, frequencyRank:d.frequencyRank, pitchAccent:d.pitchAccent, partOfSpeech:d.partOfSpeech,
      context:t.jpdbData.context, contextOffset:t.jpdbData.contextOffset,
      rect:anchor.rect, rects:anchor.rects, boxRect:anchor.boxRect,
      point:anchor.point, pointerType:anchor.pointerType,
      vertical:anchor.vertical, vw:window.innerWidth, vh:window.innerHeight
    });
  }

  // Everything the native popup needs to place itself next to this word.
  //   rects    - one entry per line fragment. A word wrapping across two manga
  //              columns has a useless union rect, so the native side picks the
  //              fragment nearest the pointer instead.
  //   boxRect  - the owning OCR bubble. Covering the rest of the bubble costs
  //              the reader the sentence they are mid-way through, so the popup
  //              avoids the whole bubble, not just the glyph.
  //   point    - where the finger actually landed, so the popup can clear it.
  function anchorFor(t,ev){
    var out={ rect:null, rects:null, boxRect:null, point:null, pointerType:'touch', vertical:false };
    try{
      var r=t.getBoundingClientRect();
      out.rect={ x:r.left, y:r.top, w:r.width, h:r.height };
      var list=t.getClientRects(), rects=[];
      for(var i=0;i<list.length;i++){
        var c=list[i];
        if(c.width>0&&c.height>0) rects.push({ x:c.left, y:c.top, w:c.width, h:c.height });
      }
      if(rects.length) out.rects=rects;
      var box=t.closest? t.closest('.textBox') : null;
      if(box){
        var b=box.getBoundingClientRect();
        if(b.width>0&&b.height>0) out.boxRect={ x:b.left, y:b.top, w:b.width, h:b.height };
      }
      // Writing mode decides which way it flips: horizontal text pushes the
      // popup above/below, vertical text (manga) prefers a side so the column
      // being read is never covered.
      var wm=(window.getComputedStyle(t).writingMode||'');
      out.vertical = wm.indexOf('vertical') === 0 || wm === 'tb' || wm === 'tb-rl';
    }catch(_){}
    if(ev){
      if(typeof ev.x==='number'&&typeof ev.y==='number') out.point={ x:ev.x, y:ev.y };
      else if(typeof ev.clientX==='number'&&typeof ev.clientY==='number') out.point={ x:ev.clientX, y:ev.clientY };
      if(ev.pointerType) out.pointerType = ev.pointerType==='mouse' ? 'mouse' : 'touch';
    }
    return out;
  }

  // The word the native popup is currently anchored to. Pan and zoom move the
  // page under an open popup, so the anchor has to be re-sent.
  var activeWord=null;
  var anchorTimer=0;
  function clearActiveWord(){ activeWord=null; }
  function scheduleAnchorUpdate(){
    if(!activeWord) return;
    // Trailing debounce, deliberately not per-frame and not a throttle. The
    // popup holds still for the whole gesture and then moves once, which reads
    // far calmer than a card sliding around under a drag, and costs one native
    // re-render instead of one per frame.
    if(anchorTimer) clearTimeout(anchorTimer);
    anchorTimer=setTimeout(function(){
      anchorTimer=0;
      var t=activeWord;
      if(!t) return;
      if(t.isConnected===false){ activeWord=null; post('anchorLost'); return; }
      var a=anchorFor(t,null);
      if(!a.rect){ activeWord=null; post('anchorLost'); return; }
      post('anchor',{
        rect:a.rect, rects:a.rects, boxRect:a.boxRect,
        vertical:a.vertical, vw:window.innerWidth, vh:window.innerHeight
      });
    },120);
  }

  // tap handler -> RN WordSheet (replaces onWordHoverStart)
  function onWordTap(e){
    try { e.preventDefault(); e.stopPropagation(); } catch(_){}
    openWord(e.currentTarget,'lookup',e);
  }

  function onWordHover(e){
    if(e.pointerType && e.pointerType!=='mouse') return;
    openWord(e.currentTarget,'hover',e);
  }

  // Find the page containing an OCR box across mokuro HTML variants.
  function owningPage(el){
    if(!el || !el.closest) return null;
    var p=el.closest('.pageContainer,.page');
    if(p) return p;
    var n=el;
    while(n && n.parentElement){
      if(n.parentElement.id==='pagesContainer') return n;
      n=n.parentElement;
    }
    return null;
  }

  function pointDistanceToRect(x,y,r){
    var dx=x<r.left?r.left-x:(x>r.right?x-r.right:0);
    var dy=y<r.top?r.top-y:(y>r.bottom?y-r.bottom:0);
    return dx*dx+dy*dy;
  }

  // The OCR overlay can use pointer-events:none, and an imprecise finger may
  // land just outside it. In both cases event.target is the manga image. Test
  // the visible page's box geometry with a small touch allowance instead.
  function textBoxAtPoint(target,x,y,pad){
    try{
      var direct=target && target.closest ? target.closest('.textBox') : null;
      if(direct) return direct;
      var page=owningPage(target);
      if(!page){
        var pages=pageEls().els;
        for(var i=0;i<pages.length;i++){
          var pr=pages[i].getBoundingClientRect();
          if(x>=pr.left && x<=pr.right && y>=pr.top && y<=pr.bottom){ page=pages[i]; break; }
        }
      }
      if(!page || !page.querySelectorAll) return null;
      var boxes=page.querySelectorAll('.textBox');
      var best=null, bestD=Infinity, limit=pad*pad;
      for(var j=0;j<boxes.length;j++){
        var r=boxes[j].getBoundingClientRect();
        if(r.width<=0 || r.height<=0 || r.bottom<0 || r.top>window.innerHeight) continue;
        var d=pointDistanceToRect(x,y,r);
        if(d<=limit && d<bestD){ best=boxes[j]; bestD=d; }
      }
      return best;
    }catch(_){ return null; }
  }

  // Prefer the exact parsed span under the finger, with only a tiny fallback
  // tolerance for ruby and glyph hit-test gaps.
  function parsedWordAtPoint(box,x,y){
    try{
      var stack=document.elementsFromPoint ? document.elementsFromPoint(x,y) : [];
      for(var i=0;i<stack.length;i++){
        var hit=stack[i].closest ? stack[i].closest('.jpdb-word:not(.unparsed)') : null;
        if(hit && hit.jpdbData && (!box || box.contains(hit))) return hit;
      }
      if(!box) return null;
      var words=box.querySelectorAll('.jpdb-word:not(.unparsed)');
      var best=null, bestD=Infinity;
      for(var j=0;j<words.length;j++){
        if(!words[j].jpdbData) continue;
        var r=words[j].getBoundingClientRect();
        var d=pointDistanceToRect(x,y,r);
        if(d<=36 && d<bestD){ best=words[j]; bestD=d; }
      }
      return best;
    }catch(_){ return null; }
  }

  var pendingTextTap=null;
  function clearPendingTextTap(){ pendingTextTap=null; }
  function resolvePendingTextTap(){
    var p=pendingTextTap;
    if(!p) return false;
    if(Date.now()>p.expires || !p.box || p.box.isConnected===false){ clearPendingTextTap(); return false; }
    var word=parsedWordAtPoint(p.box,p.x,p.y);
    if(!word) return false;
    openWord(word,'lookup',{ x:p.x, y:p.y, pointerType:p.pointerType||'touch' });
    return true;
  }
  function deferTextLookup(box,x,y,pointerType){
    var p={ box:box, x:x, y:y, pointerType:pointerType, expires:Date.now()+8000 };
    pendingTextTap=p;
    post('textGuard',{ pending:true });
    var page=owningPage(box);
    if(page) prioritizeTextPage(page);
    setTimeout(function(){ if(pendingTextTap===p) clearPendingTextTap(); },8100);
  }

  // Remember where the gesture began. Parsing can replace text nodes between
  // pointerdown and click; the down-time guard survives that DOM mutation.
  var pointerTextStart=null;
  document.addEventListener('pointerdown',function(e){
    var x=typeof e.clientX==='number'?e.clientX:0;
    var y=typeof e.clientY==='number'?e.clientY:0;
    var box=textBoxAtPoint(e.target,x,y,14);
    pointerTextStart=box?{ box:box, x:x, y:y, at:Date.now(), id:e.pointerId }:null;
  },true);

  // Narrow edge strips are dedicated page-turn zones; the centre toggles native
  // controls or opens OCR words. A drag is suppressed before this handler.
  var EDGE_FRAC = 0.18;
  var suppressTapUntil=0;
  // A touch drag can synthesize a click afterwards. Capture it before a
  // .jpdb-word target listener opens a lookup or an edge click turns a page.
  document.addEventListener('click',function(e){
    if(Date.now()>=suppressTapUntil) return;
    try{ e.preventDefault(); e.stopImmediatePropagation(); }catch(_){}
  },true);
  document.addEventListener('click', (e)=>{
    if(Date.now()<suppressTapUntil){
      try{ e.preventDefault(); e.stopImmediatePropagation(); }catch(_){}
      return;
    }
    const t=e.target;
    if(!t || !t.closest) { post('tap'); return; }
    // Internal controls are hidden, but leave form semantics intact for unusual
    // exports that retain an accessible element.
    if(t.closest('#menu, #topMenu, #popupAbout, .menu, input, select, textarea, button, a')) return;
    var w = window.innerWidth || 1;
    var x = (typeof e.clientX === 'number') ? e.clientX : w / 2;
    var y = (typeof e.clientY === 'number') ? e.clientY : (window.innerHeight||1)/2;
    var frac = x / w;
    var now=Date.now();
    if(frac>0.2&&frac<0.8&&now-lastTap.at<300&&Math.hypot(x-lastTap.x,y-lastTap.y)<36){
      lastTap.at=0;
      suppressTapUntil=now+350;
      try{ e.preventDefault(); e.stopImmediatePropagation(); }catch(_){}
      resetView();
      post('viewReset');
      return;
    }
    if(frac>0.2&&frac<0.8) lastTap={at:now,x:x,y:y};
    // OCR always wins over page-turn zones, including at either page edge.
    // Parsed words continue to their target listener. Still-parsing text is
    // consumed here and replayed after its token spans arrive.
    var wrapped=t.closest('.jpdb-word');
    if(wrapped){
      if(wrapped.jpdbData) return;
      try{ e.preventDefault(); e.stopPropagation(); }catch(_){}
      post('textGuard',{ pending:false });
      return;
    }
    var guarded=pointerTextStart && Date.now()-pointerTextStart.at<1200 &&
      (e.pointerId==null || pointerTextStart.id==null || e.pointerId===pointerTextStart.id);
    var box=textBoxAtPoint(t,x,y,14) || (guarded ? pointerTextStart.box : null);
    pointerTextStart=null;
    if(box){
      try{ e.preventDefault(); e.stopPropagation(); }catch(_){}
      var parsed=parsedWordAtPoint(box,x,y);
      if(parsed) openWord(parsed,'lookup',{ x:x, y:y, pointerType:e.pointerType });
      else deferTextLookup(box,x,y,e.pointerType);
      return;
    }
    if(fallbackControls.tapToTurn && (frac < EDGE_FRAC || frac > 1 - EDGE_FRAC) && navTotal() > 1){
      try{ e.preventDefault(); e.stopImmediatePropagation(); }catch(_){}
      clearPendingTextTap();
      clearActiveWord();
      var right = frac > 0.5;
      navStep(navRtl() ? (right ? -1 : 1) : (right ? 1 : -1));
      return;
    }
    clearPendingTextTap();
    clearActiveWord();
    try{ e.preventDefault(); e.stopPropagation(); }catch(_){}
    post('tap');
  },true);

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
        wrapper.addEventListener('pointerenter', onWordHover);
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

  // Repaint every occurrence of a word after its card state changes. The
  // reverse index has always been built for this but nothing ever called it,
  // so a reviewed/mined word kept its old colour until the page was reloaded.
  window.__yomibakoSetCardState = function(vid, sid, stateArr){
    try{
      var idx = reverseIndex.get(vid + '/' + sid);
      if(!idx) return 0;
      var cls = 'jpdb-word ' + ((stateArr && stateArr.length) ? stateArr.join(' ') : 'not-in-deck');
      idx.className = cls;
      var live = [], n = 0;
      for(var i=0;i<idx.elements.length;i++){
        var el = idx.elements[i];
        if(!el) continue;
        // Drop spans from pages that have since been torn down.
        if(el.isConnected === false) continue;
        el.className = cls;
        if(el.jpdbData && el.jpdbData.token && el.jpdbData.token.card) el.jpdbData.token.card.state = stateArr;
        live.push(el); n++;
      }
      idx.elements = live;
      return n;
    }catch(_){ return 0; }
  };

  // Hand the parsed words on the CURRENT page to the native quiz. Quizzing the
  // whole volume is a different feature; what is on screen is what was just
  // read. Cards already carry their meanings, so this costs no extra JPDB call.
  //
  // When Yomibako owns paging, viewState.pages IS the mounted spread. Otherwise
  // fall back to whichever of mokuro's own pages is still displayed.
  function displayedPages(){
    var live=[];
    try{
      var mounted=(viewState && viewState.pages) ? viewState.pages : null;
      if(mounted && mounted.length){
        for(var i=0;i<mounted.length;i++){
          if(mounted[i] && mounted[i].isConnected!==false) live.push(mounted[i]);
        }
        if(live.length) return live;
      }
      var all=pageEls().els||[];
      for(var j=0;j<all.length;j++){
        var page=all[j];
        if(!page || page.isConnected===false || !page.getBoundingClientRect) continue;
        var display='';
        try{ display=window.getComputedStyle(page).display; }
        catch(_){ display=(page.style && page.style.display) || ''; }
        if(display==='none') continue;
        var r=page.getBoundingClientRect();
        if(r.width<=0 && r.height<=0) continue;
        live.push(page);
      }
    }catch(_){}
    return live;
  }

  var COLLECT_MAX = 200;
  window.__yomibakoCollectWords = function(){
    var out=[], seen={}, full=false;
    try{
      var pages=displayedPages();
      for(var i=0;i<pages.length && !full;i++){
        var page=pages[i];
        var spans=page && page.querySelectorAll ? page.querySelectorAll('.jpdb-word') : [];
        for(var j=0;j<spans.length;j++){
          var data=spans[j].jpdbData;
          var card=data && data.token && data.token.card;
          if(!card || !card.spelling) continue;
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
          if(out.length>=COLLECT_MAX){ full=true; break; }
        }
      }
    }catch(_){}
    post('words', { words: out });
  };

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
  var reparseRun=0;
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
    if(ok) resolvePendingTextTap();
  }

  function requestParseForPage(page, paragraphs){
    const generation=reparseRun;
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
          if(generation!==reparseRun) return;
          let spans=0;
          try{
            batches.forEach((b,i)=>{
              const toks=tokensArray && tokensArray[i];
              if(toks) spans+=applyTokens(b.frags, toks);
            });
            post('applied', { id, spans });
            resolvePendingTextTap();
          }catch(err){ console.warn('[yomibako] apply failed', err); post('applyError', { id, error: String((err && err.message) || err).slice(0,200) }); }
          onChunkSettled(true);
        }).catch(err=>{
          if(generation!==reparseRun) return;
          console.warn('[yomibako] parse failed', err);
          try{ post('parseError', { id, error: String((err && err.message) || err).slice(0,200) }); }catch(_){}
          onChunkSettled(false);
        }).finally(()=>{ inflightParse--; pumpParseQueue(); });
      };
      run.yomibakoPage=page;
      if(inflightParse < MAX_INFLIGHT) run();
      else parseQueue.push(run);
    }
  }

  // --- mokuro observer ---
  // Page containers differ across mokuro versions — try known selectors.
  var ownedPages=null;
  var ownedPagesContainer=null;
  function pageEls(){
    // Once Yomibako owns paging, inactive pages are deliberately detached from
    // the document. Keep returning the original ordered registry so navigation,
    // parsing and re-parse still address every page by its stable index.
    if(ownedPages) return {els:ownedPages, sel:'owned page registry'};
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
  function captureOwnedPages(pages){
    if(ownedPages) return ownedPages;
    ownedPages=[].slice.call(pages);
    if(!ownedPages.length) return ownedPages;
    ownedPagesContainer=document.getElementById('pagesContainer') || ownedPages[0].parentElement;
    return ownedPages;
  }
  function registerOwnedPage(page){
    // The spread wrapper is Yomibako's own node, not a late-arriving mokuro page.
    if(page && page.classList && page.classList.contains('yomibako-spread')) return;
    if(!ownedPages || !page || ownedPages.indexOf(page)>=0) return;
    var match=String(page.id||'').match(/^page(\d+)$/);
    var at=match?Number(match[1]):-1;
    if(at>=0 && at<=ownedPages.length) ownedPages.splice(at,0,page);
    else ownedPages.push(page);
    try{ observer.observe(page); }catch(_){}
    // A progressive export may append the page after takeover. Register it for
    // navigation, but keep it detached until it is the selected page.
    if(fallbackControls && fallbackControls.active && page.parentNode){
      try{ page.parentNode.removeChild(page); }catch(_){}
    }
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
      // Successful chunks already wrapped every fragment, including gaps.
      // A retry should parse only remaining raw text, never nest jpdb-word
      // spans or include generated ruby text a second time.
      if(t.parentElement && t.parentElement.closest('.jpdb-word')) continue;
      const start=off; off+=data.length;
      frags.push({ node:t, start, end:off, length:data.length, hasRuby:false });
    }
    return frags;
  }

  function queuePageForParse(page){
    if(!(page instanceof HTMLElement)) return;
    if(page.dataset && page.dataset.yomibakoParsed==='1'){
      try{ observer.unobserve(page); }catch(_){}
      resolvePendingTextTap();
      return;
    }
    if(pendingBatchesMap.has(page)) return;
    const paragraphs=[...page.querySelectorAll('.textBox')].map(boxFrags).filter(f=>f.length>0);
    // Fallback: page itself holds text but no .textBox (variant markup).
    if(paragraphs.length===0){
      const direct=boxFrags(page);
      if(direct.length>0) paragraphs.push(direct);
    }
    if(paragraphs.length===0){
      try{ page.dataset.yomibakoParsed='1'; observer.unobserve(page); }catch(_){}
      return;
    }
    pendingBatchesMap.set(page,true);
    requestParseForPage(page,paragraphs);
  }

  // Move queued chunks for the page the user actually touched ahead of
  // prefetch work. If it was not observed yet, enqueue it immediately.
  function prioritizeTextPage(page){
    try{
      if(!pendingBatchesMap.has(page)) queuePageForParse(page);
      if(parseQueue.length){
        const own=[], other=[];
        while(parseQueue.length){
          const run=parseQueue.shift();
          (run && run.yomibakoPage===page ? own : other).push(run);
        }
        parseQueue.push(...own,...other);
      }
      pumpParseQueue();
    }catch(e){ console.warn('[yomibako] text parse priority failed',e); }
  }

  const observer=new IntersectionObserver((entries)=>{
    const visible=entries.filter(e=>e.isIntersecting).map(e=>e.target);
    for(const page of visible) queuePageForParse(page);
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

  // --- page navigation + progress bridge ---------------------------------
  // mokuro's generated HTML declares updatePage/nextPage/prevPage/state/num_pages
  // as top-level bindings of a classic script. Lexical declarations there land in
  // the *global lexical* environment, which is NOT window.* — a global-scope
  // Function() body is the only way to reach them from an injected script.
  // Only this fixed allowlist of mokuro symbols is ever looked up.
  var MOKURO_SYMBOLS = ['state','num_pages','updatePage','nextPage','prevPage','pz'];
  var globalRefCache = {};
  function globalRef(name){
    if(MOKURO_SYMBOLS.indexOf(name) < 0) return undefined;
    try{
      var get = globalRefCache[name];
      if(!get){ get = globalRefCache[name] = new Function('return typeof '+name+'!=="undefined"?'+name+':undefined'); }
      return get();
    }catch(_){ return undefined; }
  }
  function globalFn(name){
    var f = globalRef(name);
    return (typeof f === 'function') ? f : null;
  }
  function mokuroState(){
    var st = globalRef('state');
    if(st && typeof st === 'object' && typeof st.page_idx === 'number') return st;
    return null;
  }
  function navRtl(){
    if(fallbackControls && fallbackControls.active) return fallbackControls.rtl;
    try{
      var cb=document.getElementById('menuR2l');
      if(cb && typeof cb.checked==='boolean') return cb.checked;
    }catch(_){}
    var st=mokuroState();
    if(st && typeof st.r2l === 'boolean') return st.r2l;
    if(fallbackControls) return fallbackControls.rtl;
    return true; // manga default
  }
  function navTotal(){
    var n = globalRef('num_pages');
    if(typeof n === 'number' && n > 0) return n;
    try{
      var input=document.getElementById('pageIdxInput');
      var max=Number(input && input.max);
      if(max>0) return max;
    }catch(_){}
    try{ return pageEls().els.length; }catch(_){ return 0; }
  }
  function navIndex(){
    if(fallbackControls && fallbackControls.active && typeof fallbackControls.index==='number') return fallbackControls.index;
    var st = mokuroState();
    if(st) return st.page_idx;
    try{
      var input=document.getElementById('pageIdxInput');
      var value=Number(input && input.value);
      if(value>0) return value-1;
    }catch(_){}
    // No mokuro state (long-strip / plain html): the most visible page wins.
    var els; try{ els = pageEls().els; }catch(_){ return -1; }
    var vh = window.innerHeight, vw = window.innerWidth;
    var best = -1, bestArea = 0;
    for(var i=0;i<els.length;i++){
      var r = els[i].getBoundingClientRect();
      var h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      var w = Math.min(r.right, vw) - Math.max(r.left, 0);
      var a = Math.max(0,h) * Math.max(0,w);
      if(a > bestArea){ bestArea = a; best = i; }
    }
    return best;
  }
  var lastIdx=-1, lastTotal=-1, lastP=-1;
  function navReport(force){
    try{
      var total = navTotal();
      var idx = navIndex();
      var scrollable = document.documentElement.scrollHeight - window.innerHeight;
      var scrollP = scrollable > 8 ? (window.scrollY / scrollable) : -1;
      var value;
      if((mokuroState() || fallbackControls.active) && total > 1) value = idx / (total - 1); // paged mokuro/fallback
      else if(scrollP >= 0) value = scrollP;                            // long strip
      else if(total > 1 && idx >= 0) value = idx / (total - 1);
      else value = 0;
      value = Math.max(0, Math.min(1, value));
      if(!force && idx===lastIdx && total===lastTotal && Math.abs(value-lastP) < 0.004) return;
      lastIdx=idx; lastTotal=total; lastP=value;
      var st = mokuroState();
      var hasPager=!!document.getElementById('pageIdxInput') && total>1;
      post('page', {
        index: idx, total: total, value: value, paged: !!st || hasPager || fallbackControls.active,
        rtl: navRtl(), twoPage: !!fallbackControls.twoPage,
        zoomMode: fallbackControls.zoomMode || 'screen', menuOpen: !!mokuroMenuOpen
      });
    }catch(_){}
  }
  function navGo(idx){
    var total = navTotal();
    if(total <= 0) return;
    // The anchored word is about to be detached, so stop tracking it and let
    // the native popup close rather than hover over an unrelated page.
    clearActiveWord();
    idx = Math.max(0, Math.min(total - 1, Math.round(Number(idx) || 0)));
    if(fallbackControls && fallbackControls.active){
      // Keep spreads on their starting index so turning stays in phase.
      if(fallbackControls.twoPage && idx%2===1 && idx>0) idx-=1;
      applyFallbackLayout(idx);
      navReport(true);
      return;
    }
    // The number input's real change listener reaches Mokuro even when WebView
    // injection and page scripts live in different JavaScript worlds.
    try{
      var input=document.getElementById('pageIdxInput');
      if(input){
        input.value=String(idx+1);
        input.dispatchEvent(new Event('change',{bubbles:true}));
        setTimeout(function(){ navReport(true); },80);
        return;
      }
    }catch(_){}
    var update = globalFn('updatePage');
    if(update){ try{ update(idx); navReport(true); return; }catch(_){} }
    try{
      var els = pageEls().els;
      if(els[idx] && els[idx].scrollIntoView) els[idx].scrollIntoView({ behavior:'auto', block:'start' });
    }catch(_){}
    navReport(true);
  }
  function navStep(delta){
    // Once Yomibako owns the layout, mokuro's own buttons would re-show the
    // pages the fallback deliberately hid — drive our own pager instead.
    if(fallbackControls && fallbackControls.active){
      var at=navIndex();
      navGo((at<0?0:at)+delta*spreadSize());
      return;
    }
    // buttonLeft means next in RTL and previous in LTR; buttonRight is the
    // inverse. Clicking the generated control invokes Mokuro's own logic.
    try{
      var next=delta>0, rtl=navRtl();
      var id=(next===rtl)?'buttonLeft':'buttonRight';
      var button=document.getElementById(id);
      if(button && typeof button.click==='function'){
        button.click();
        setTimeout(function(){ navReport(true); },80);
        return;
      }
    }catch(_){}
    var f = delta > 0 ? globalFn('nextPage') : globalFn('prevPage');
    if(f){ try{ f(); navReport(true); return; }catch(_){} }
    var idx = navIndex();
    if(idx < 0) idx = 0;
    navGo(idx + delta);
  }
  window.__yomibakoGoTo = navGo;
  window.__yomibakoStep = navStep;
  window.__yomibakoClearAnchor = clearActiveWord;
  window.__yomibakoReport = function(){ navReport(true); };

  // --- single-page mobile reader ------------------------------------------
  var fallbackControls = { rtl:true, active:false, index:0, tapToTurn:true, preloadNextPage:true, reduceMotion:false, twoPage:false, zoomMode:'screen' };
  var ownedPageMetrics = new WeakMap();
  var ownedTouch=null;
  var lastTap={at:0,x:0,y:0};
  var mokuroMenuOpen=false;
  // One transformed surface (the spread) in viewport pixels. width/height are
  // the spread's natural size; fitScale is "whole spread on screen", minScale
  // is the floor the current zoom mode allows.
  var viewState={pages:[],spread:null,width:1,height:1,fitScale:1,minScale:1,scale:1,x:0,y:0};

  // How many pages one turn advances. Two-page spreads move two at a time.
  function spreadSize(){
    return (fallbackControls.twoPage && fallbackControls.active) ? 2 : 1;
  }

  function panzoomApi(){
    var panzoom=globalRef('pz');
    return panzoom && typeof panzoom.getTransform==='function' &&
      typeof panzoom.moveTo==='function' && typeof panzoom.zoomTo==='function'
      ? panzoom : null;
  }

  function blockedGestureTarget(target){
    try{
      return !!(target && target.closest && target.closest('#topMenu,#popupAbout,input,select,textarea,button,a'));
    }catch(_){ return false; }
  }

  function touchById(list,id){
    for(var i=0;i<list.length;i++) if(list[i].identifier===id) return list[i];
    return null;
  }

  function viewportSize(){
    return {
      w:Math.max(1,window.innerWidth||document.documentElement.clientWidth),
      h:Math.max(1,window.innerHeight||document.documentElement.clientHeight)
    };
  }

  // The three zoom modes are just three target scales over the same surface.
  // Fit screen shows the whole spread; fit width fills the viewport width and
  // lets the reader pan down; 1:1 renders at the scan's own pixel size.
  function scaleForMode(mode){
    var vp=viewportSize();
    if(mode==='width') return vp.w/viewState.width;
    if(mode==='original') return 1;
    return Math.min(vp.w/viewState.width,vp.h/viewState.height);
  }

  function clampView(x,y,scale){
    var floor=Math.max(0.02,viewState.minScale);
    scale=Math.max(floor,Math.min(Math.max(4,floor*8),Number(scale)||floor));
    var width=viewState.width*scale;
    var height=viewState.height*scale;
    var vp=viewportSize();
    var vw=vp.w, vh=vp.h;
    var minX=width<=vw?(vw-width)/2:vw-width;
    var maxX=width<=vw?minX:0;
    var minY=height<=vh?(vh-height)/2:vh-height;
    var maxY=height<=vh?minY:0;
    return {
      x:Math.max(minX,Math.min(maxX,x)),
      y:Math.max(minY,Math.min(maxY,y)),
      scale:scale
    };
  }

  function applyView(x,y,scale){
    if(!viewState.spread) return false;
    var next=clampView(x,y,scale);
    viewState.x=next.x; viewState.y=next.y; viewState.scale=next.scale;
    viewState.spread.style.setProperty(
      'transform',
      'translate3d('+next.x+'px,'+next.y+'px,0) scale('+next.scale+')',
      'important'
    );
    // Single choke point for every pan, pinch and reset, so an open popup can
    // follow the word instead of pointing at empty page.
    scheduleAnchorUpdate();
    return true;
  }

  function resetView(){
    if(!viewState.spread) return false;
    var vp=viewportSize();
    viewState.fitScale=Math.min(vp.w/viewState.width,vp.h/viewState.height);
    var mode=fallbackControls.zoomMode||'screen';
    var target=scaleForMode(mode);
    // Never clamp the reader above its own mode (1:1 on a huge display can be
    // smaller than fit-screen), and never below fit-screen.
    viewState.minScale=Math.min(viewState.fitScale,target);
    var width=viewState.width*target;
    var height=viewState.height*target;
    var x=(vp.w-width)/2;
    // Fit-screen centres. The other modes overflow vertically, and a manga page
    // is read from the top, so start there instead of mid-page.
    var y=height<=vp.h?(vp.h-height)/2:0;
    return applyView(x,y,target);
  }

  function touchDistance(a,b){
    var dx=b.clientX-a.clientX,dy=b.clientY-a.clientY;
    return Math.max(1,Math.hypot(dx,dy));
  }

  // One gesture owner, in viewport coordinates. This avoids mokuro bounds,
  // browser scrolling and a second transform fighting over the same page.
  document.addEventListener('touchstart',function(e){
    if(!fallbackControls.active || blockedGestureTarget(e.target)){
      ownedTouch=null;
      return;
    }
    if(e.touches.length===2){
      var a=e.touches[0],b=e.touches[1];
      var midX=(a.clientX+b.clientX)/2,midY=(a.clientY+b.clientY)/2;
      ownedTouch={
        mode:'pinch',id1:a.identifier,id2:b.identifier,distance:touchDistance(a,b),
        scale:viewState.scale,sourceX:(midX-viewState.x)/viewState.scale,
        sourceY:(midY-viewState.y)/viewState.scale
      };
      try{
        if(e.cancelable) e.preventDefault();
        e.stopImmediatePropagation();
      }catch(_){}
      return;
    }
    if(e.touches.length!==1){ ownedTouch=null; return; }
    var t=e.touches[0];
    ownedTouch={
      mode:'pan',id:t.identifier,x:t.clientX,y:t.clientY,moved:false,
      panX:viewState.x,panY:viewState.y
    };
    // Do not preventDefault yet: an unmoved touch must still synthesize the
    // click used for word lookup, edge turning, and center chrome. touch-action
    // prevents native scrolling; touchmove takes ownership once it is a drag.
    try{ e.stopImmediatePropagation(); }catch(_){}
  },{capture:true,passive:false});

  document.addEventListener('touchmove',function(e){
    var g=ownedTouch;
    if(!g) return;
    if(g.mode==='pinch'){
      if(e.touches.length!==2){ ownedTouch=null; return; }
      var pa=touchById(e.touches,g.id1),pb=touchById(e.touches,g.id2);
      if(!pa || !pb){ ownedTouch=null; return; }
      var midX=(pa.clientX+pb.clientX)/2,midY=(pa.clientY+pb.clientY)/2;
      var targetScale=g.scale*(touchDistance(pa,pb)/g.distance);
      try{
        if(e.cancelable) e.preventDefault();
        e.stopImmediatePropagation();
        applyView(midX-g.sourceX*targetScale,midY-g.sourceY*targetScale,targetScale);
        suppressTapUntil=Date.now()+350;
      }catch(_){}
      return;
    }
    if(e.touches.length!==1){ ownedTouch=null; return; }
    var t=touchById(e.touches,g.id);
    if(!t){ ownedTouch=null; return; }
    var dx=t.clientX-g.x, dy=t.clientY-g.y;
    if(!g.moved && Math.hypot(dx,dy)<6) return;
    g.moved=true;
    pointerTextStart=null;
    suppressTapUntil=Date.now()+350;
    try{
      if(e.cancelable) e.preventDefault();
      e.stopImmediatePropagation();
    }catch(_){}
    applyView(g.panX+dx,g.panY+dy,viewState.scale);
  },{capture:true,passive:false});

  var finishOwnedTouch=function(e){
    var g=ownedTouch;
    if(!g) return;
    var stillActive=g.mode==='pinch'
      ? e.touches&&e.touches.length===2&&touchById(e.touches,g.id1)&&touchById(e.touches,g.id2)
      : e.touches&&e.touches.length>0&&touchById(e.touches,g.id);
    if(stillActive) return;
    if(g.mode==='pinch' || g.moved){
      suppressTapUntil=Date.now()+350;
      try{
        if(e.cancelable) e.preventDefault();
        e.stopImmediatePropagation();
      }catch(_){}
    }
    ownedTouch=null;
  };
  document.addEventListener('touchend',finishOwnedTouch,{capture:true,passive:false});
  document.addEventListener('touchcancel',function(){ ownedTouch=null; },{capture:true,passive:true});
  window.__yomibakoGestureDebug=function(){
    return {active:!!fallbackControls.active,tracking:!!ownedTouch,suppressFor:Math.max(0,suppressTapUntil-Date.now()),scale:viewState.scale,fit:viewState.fitScale,x:viewState.x,y:viewState.y};
  };
  document.addEventListener('dblclick',function(e){
    if(!fallbackControls.active)return;
    try{e.preventDefault();e.stopImmediatePropagation();}catch(_){}
    suppressTapUntil=Date.now()+350;
    resetView();
    post('viewReset');
  },true);

  function pageSurface(page){
    var children=page.children||[];
    for(var i=0;i<children.length;i++){
      if(children[i].classList && children[i].classList.contains('pageContainer')) return children[i];
    }
    var nested=page.querySelector&&page.querySelector('.pageContainer');
    if(nested) return nested;
    // Plain overlays put the image and OCR boxes directly in the page. Wrap
    // them once so image and text always share one transform origin.
    var existing=null;
    for(var n=0;n<children.length;n++){
      if(children[n].classList && children[n].classList.contains('yomibako-page-surface')){ existing=children[n]; break; }
    }
    if(existing) return existing;
    var wrapper=document.createElement('div');
    wrapper.className='yomibako-page-surface';
    while(page.firstChild) wrapper.appendChild(page.firstChild);
    page.appendChild(wrapper);
    return wrapper;
  }
  function positiveSize(el, axis){
    var offset=axis==='width'?el.offsetWidth:el.offsetHeight;
    if(offset>1) return offset;
    var scroll=axis==='width'?el.scrollWidth:el.scrollHeight;
    if(scroll>1) return scroll;
    try{
      var value=parseFloat(window.getComputedStyle(el)[axis]);
      if(value>1) return value;
    }catch(_){}
    return 0;
  }
  function ownedPageMetric(page){
    var cached=ownedPageMetrics.get(page);
    if(cached) return cached;
    var surface=pageSurface(page);
    var img=surface.matches&&surface.matches('img')?surface:(surface.querySelector&&surface.querySelector('img'));
    var width=(img&&img.naturalWidth) || positiveSize(surface,'width') || positiveSize(page,'width');
    var height=(img&&img.naturalHeight) || positiveSize(surface,'height') || positiveSize(page,'height');
    if((!width || !height) && img && img.naturalWidth && img.naturalHeight){
      width=width||img.naturalWidth;
      height=height||img.naturalHeight;
    }
    width=Math.max(1,width||1);
    height=Math.max(1,height||1);
    cached={surface:surface,width:width,height:height};
    ownedPageMetrics.set(page,cached);
    return cached;
  }
  // Kept, never removed: mokuro's own preloading code dereferences this node
  // and would throw if it disappeared. The stylesheet rule is the durable
  // layer (an author !important rule beats any plain inline style the script
  // writes back); these inline properties just close the gap before it loads.
  var PRELOADER_SEL='#preload-image,.preload-image,#preloadImage';
  function neutralizeMokuroPreloader(){
    try{
      var nodes=document.querySelectorAll(PRELOADER_SEL);
      for(var i=0;i<nodes.length;i++){
        var el=nodes[i], s=el.style;
        el.setAttribute('aria-hidden','true');
        s.setProperty('display','none','important');
        s.setProperty('visibility','hidden','important');
        s.setProperty('content-visibility','hidden','important');
        s.setProperty('width','0','important');
        s.setProperty('height','0','important');
        s.setProperty('max-width','0','important');
        s.setProperty('max-height','0','important');
        s.setProperty('margin','0','important');
        s.setProperty('padding','0','important');
        s.setProperty('border','0','important');
        s.setProperty('background','none','important');
        s.setProperty('pointer-events','none','important');
      }
    }catch(_){}
  }
  var warmedAssets=[];
  function preloadNextPage(index){
    if(!fallbackControls.preloadNextPage||!ownedPages||index+1>=ownedPages.length) return;
    try{
      var next=ownedPages[index+1],urls=[];
      var images=next.querySelectorAll?next.querySelectorAll('img'):[];
      for(var i=0;i<images.length;i++){
        var src=images[i].currentSrc||images[i].src||images[i].getAttribute('src');
        if(src) urls.push(src);
      }
      var surface=pageSurface(next);
      var background=(surface.style&&surface.style.backgroundImage)||'';
      var match=background.match(/url\(["']?([^"')]+)["']?\)/);
      if(match&&match[1]) urls.push(match[1]);
      warmedAssets.length=0;
      for(i=0;i<urls.length&&i<3;i++){
        var image=new Image(); image.src=urls[i]; warmedAssets.push(image);
      }
    }catch(_){}
  }
  function enterOwnedLayout(){
    document.documentElement.classList.add('yomibako-owned-layout');
    neutralizeMokuroPreloader();
    var container=document.getElementById('pagesContainer');
    var panzoom=panzoomApi();
    if(container){
      container.style.removeProperty('zoom');
      container.style.setProperty('transform','none','important');
    }
    // Yomibako owns every gesture and one surface transform. Pausing mokuro
    // prevents a second matrix, loose bounds and double-tap behavior from
    // fighting the reader without removing any of mokuro's DOM.
    if(panzoom && typeof panzoom.pause==='function'){ try{ panzoom.pause(); }catch(_){} }
  }
  // The spread wrapper is Yomibako's own node: mokuro's pages are moved into it
  // rather than cloned, so OCR listeners and parse state survive every turn.
  function ensureSpread(container){
    var kids=container.children||[];
    for(var i=0;i<kids.length;i++){
      if(kids[i].classList && kids[i].classList.contains('yomibako-spread')) return kids[i];
    }
    var spread=document.createElement('div');
    spread.className='yomibako-spread';
    container.appendChild(spread);
    return spread;
  }
  function directZoom(){
    try{
      var pages=viewState.pages;
      if(!pages || !pages.length) return false;
      enterOwnedLayout();
      var container=document.getElementById('pagesContainer') || pages[0].parentElement;
      if(!container) return false;
      var spread=ensureSpread(container);
      var vp=viewportSize();
      container.style.setProperty('width',vp.w+'px','important');
      container.style.setProperty('height',vp.h+'px','important');
      if(document.body){ document.body.style.width=vp.w+'px'; document.body.style.height=vp.h+'px'; }

      // Lay the pages out edge to edge in natural scan pixels. RTL reverses the
      // visual order so the earlier page sits on the right, as in print.
      var metrics=[],totalW=0,maxH=0,i;
      for(i=0;i<pages.length;i++){
        var m=ownedPageMetric(pages[i]);
        metrics.push(m);
        totalW+=m.width;
        if(m.height>maxH) maxH=m.height;
      }
      if(!totalW || !maxH) return false;
      var order=[];
      for(i=0;i<pages.length;i++) order.push(i);
      if(fallbackControls.rtl) order.reverse();

      var offsetX=0;
      for(i=0;i<order.length;i++){
        var idx=order[i], page=pages[idx], metric=metrics[idx];
        page.classList.add('yomibako-page-slot');
        page.style.removeProperty('zoom');
        page.style.setProperty('left',offsetX+'px','important');
        page.style.setProperty('top',((maxH-metric.height)/2)+'px','important');
        page.style.setProperty('width',metric.width+'px','important');
        page.style.setProperty('height',metric.height+'px','important');
        metric.surface.classList.add('yomibako-page-surface');
        metric.surface.style.removeProperty('transform');
        metric.surface.style.setProperty('width',metric.width+'px','important');
        metric.surface.style.setProperty('height',metric.height+'px','important');
        offsetX+=metric.width;
      }

      spread.style.setProperty('width',totalW+'px','important');
      spread.style.setProperty('height',maxH+'px','important');
      viewState.spread=spread;
      viewState.width=totalW;
      viewState.height=maxH;
      return resetView();
    }catch(e){
      post('layoutError',{error:String((e&&e.message)||e),stack:String((e&&e.stack)||'').slice(0,500)});
      return false;
    }
  }
  window.__yomibakoResetView = function(){
    resetView();
    post('viewReset');
  };
  function applyFallbackLayout(index){
    try{
      var pages=captureOwnedPages(pageEls().els);
      if(!pages.length) return false;
      index=Math.max(0,Math.min(pages.length-1,Math.round(Number(index)||0)));
      fallbackControls.active=true;
      fallbackControls.index=index;
      var container=ownedPagesContainer;
      if(!container) return false;
      container.style.setProperty('display','block','important');
      container.style.removeProperty('gap');
      container.style.removeProperty('width');
      container.style.removeProperty('height');
      container.style.removeProperty('justify-content');
      container.style.removeProperty('align-items');
      if(document.body){
        document.body.style.removeProperty('width');
        document.body.style.removeProperty('height');
      }
      for(var i=0;i<pages.length;i++){
        var oldMetric=ownedPageMetrics.get(pages[i]);
        pages[i].classList.remove('yomibako-page-slot');
        pages[i].style.removeProperty('left');
        pages[i].style.removeProperty('top');
        pages[i].style.removeProperty('width');
        pages[i].style.removeProperty('height');
        pages[i].style.setProperty('visibility','hidden','important');
        pages[i].style.setProperty('opacity','0','important');
        pages[i].style.setProperty('pointer-events','none','important');
        pages[i].style.setProperty('content-visibility','hidden','important');
        pages[i].style.setProperty('display','none','important');
        pages[i].style.order='2';
        if(oldMetric){
          oldMetric.surface.style.removeProperty('transform');
          oldMetric.surface.style.removeProperty('width');
          oldMetric.surface.style.removeProperty('height');
        }
      }
      var mounted=[pages[index]];
      if(fallbackControls.twoPage && index+1<pages.length) mounted.push(pages[index+1]);
      var spread=ensureSpread(container);
      spread.replaceChildren.apply(spread,mounted);
      container.replaceChildren(spread);
      for(i=0;i<mounted.length;i++){
        mounted[i].style.setProperty('display','block','important');
        mounted[i].style.setProperty('visibility','visible','important');
        mounted[i].style.setProperty('opacity','1','important');
        mounted[i].style.setProperty('pointer-events','auto','important');
        mounted[i].style.setProperty('content-visibility','visible','important');
      }
      viewState.pages=mounted;
      void container.offsetHeight;
      var ok=directZoom();
      if(ok&&!fallbackControls.reduceMotion&&viewState.spread){
        var entering=viewState.spread;
        entering.classList.remove('yomibako-page-enter');
        void entering.offsetWidth;
        entering.classList.add('yomibako-page-enter');
        setTimeout(function(){ entering.classList.remove('yomibako-page-enter'); },180);
      }
      preloadNextPage(index+mounted.length-1);
      return ok;
    }catch(_){ return false; }
  }

  // --- reader options bar --------------------------------------------------
  // Every control below drives Yomibako's own layout and reports back whether
  // it actually took effect. Nothing here writes a property onto mokuro's own
  // state object and calls that success - partial exports silently ignore
  // properties their renderer does not read.
  window.__yomibakoSetZoom = function(mode){
    if(mode!=='screen'&&mode!=='width'&&mode!=='original') mode='screen';
    fallbackControls.zoomMode=mode;
    var ok=fallbackControls.active ? resetView() : false;
    post('control',{key:'zoom',ok:!!ok,mode:mode});
    navReport(true);
    return ok;
  };
  window.__yomibakoToggle = function(key){
    if(key==='twoPage'){
      if(!fallbackControls.active){ post('control',{key:key,ok:false}); return false; }
      fallbackControls.twoPage=!fallbackControls.twoPage;
      // Spreads start on even indices, otherwise turning drifts out of phase.
      var at=fallbackControls.index;
      if(fallbackControls.twoPage && at%2===1) at-=1;
      var ok=applyFallbackLayout(at);
      post('control',{key:key,ok:!!ok,value:fallbackControls.twoPage});
      navReport(true);
      return ok;
    }
    if(key==='rtl'){
      fallbackControls.rtl=!fallbackControls.rtl;
      try{
        var rtlInput=document.getElementById('menuR2l');
        if(rtlInput && typeof rtlInput.checked==='boolean' && rtlInput.checked!==fallbackControls.rtl) rtlInput.click();
      }catch(_){}
      var okRtl=fallbackControls.active ? directZoom() : true;
      post('control',{key:key,ok:!!okRtl,value:fallbackControls.rtl});
      navReport(true);
      return okRtl;
    }
    post('control',{key:key,ok:false});
    return false;
  };
  // mokuro's own menu stays hidden by default because Yomibako replaces it,
  // but exports carry settings we do not mirror, so keep it reachable.
  window.__yomibakoMokuroMenu = function(show){
    mokuroMenuOpen=!!show;
    document.documentElement.classList.toggle('yomibako-mokuro-menu',mokuroMenuOpen);
    var ok=!!document.getElementById('topMenu');
    post('control',{key:'menu',ok:ok,value:mokuroMenuOpen});
    navReport(true);
    return ok;
  };
  // The native header floats over the page; tell mokuro's fixed menu where the
  // chrome ends so the two do not overlap.
  window.__yomibakoChromeTop = function(px){
    var top=Math.max(0,Math.round(Number(px)||0));
    try{ document.documentElement.style.setProperty('--yomibako-chrome-top',top+'px'); }catch(_){}
  };
  window.__yomibakoApplyPrefs = function(prefs,index){
    var p=prefs||{};
    if(p.zoomMode==='width'||p.zoomMode==='original'||p.zoomMode==='screen') fallbackControls.zoomMode=p.zoomMode;
    if(typeof p.twoPage==='boolean') fallbackControls.twoPage=p.twoPage;
    if(typeof p.rtl==='boolean') fallbackControls.rtl=p.rtl;
    if(typeof p.reduceMotion==='boolean'){
      fallbackControls.reduceMotion=p.reduceMotion;
      document.documentElement.classList.toggle('yomibako-reduce-motion',fallbackControls.reduceMotion);
    }
    var rtlInput=document.getElementById('menuR2l');
    if(rtlInput && typeof rtlInput.checked==='boolean') rtlInput.checked=fallbackControls.rtl;
    var target=arguments.length>1?Math.max(0,Math.round(Number(index)||0)):navIndex();
    if(fallbackControls.twoPage && target%2===1) target-=1;
    applyFallbackLayout(target<0?0:target);
    navReport(true);
  };
  window.__yomibakoRelayout = function(){
    if(fallbackControls.active) directZoom();
  };

  var navStarted=false;
  function navInit(){
    // Local HTML without a viewport meta renders at 980px CSS px in a WebView:
    // every page comes out shrunken and the text boxes land off-target.
    try{
      var mv=document.querySelector('meta[name="viewport"]');
      if(!mv){
        mv=document.createElement('meta');
        mv.name='viewport';
        (document.head || document.documentElement).appendChild(mv);
      }
      mv.content='width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
    }catch(_){}
    if(navStarted) return; navStarted=true;
    // Long-strip exports never take over the layout, so assert this here too.
    neutralizeMokuroPreloader();
    // Keep OCR itself enabled, but persist Mokuro's border option as off and
    // reinforce the transparent CSS variable after its own loadState runs.
    [120,500,1500].forEach(function(delay){
      setTimeout(function(){
        try{
          document.documentElement.style.setProperty('--textBoxBorderHoverColor','transparent','important');
          var borders=document.getElementById('menuTextBoxBorders');
          if(borders && borders.checked) borders.click();
        }catch(_){}
      },delay);
    });
    var ticking=false;
    var onScroll=function(){
      if(ticking) return; ticking=true;
      requestAnimationFrame(function(){ ticking=false; navReport(false); });
    };
    window.addEventListener('scroll', onScroll, { passive:true });
    window.addEventListener('resize', onScroll, { passive:true });
    var ownedResizeTimer=0;
    window.addEventListener('resize',function(){
      if(!fallbackControls.active) return;
      clearTimeout(ownedResizeTimer);
      ownedResizeTimer=setTimeout(function(){ applyFallbackLayout(navIndex()); },60);
    },{passive:true});
    document.addEventListener('keyup', onScroll, { passive:true });
    // mokuro mutates page visibility instead of scrolling, so poll as a floor.
    setInterval(function(){ navReport(false); }, 500);
    // mokuro's inline script may still be booting when we run.
    [0, 250, 800, 2000].forEach(function(d){ setTimeout(function(){ navReport(true); }, d); });
  }

  function observePages(){
    const {els: pages, sel} = pageEls();
    pages.forEach(p=>{
      if(p.dataset && p.dataset.yomibakoParsed==='1') return;
      try{ observer.observe(p); }catch(_){}
    });
    const boxes=document.querySelectorAll('.textBox').length;
    console.log('[yomibako] observing', pages.length, 'pages via', sel, boxes, 'textBoxes');
    setupImages();
    navInit();
    post('bridgeReady', { pages: pages.length, sel, boxes });
  }

  // Retry hook for the native side — re-queues anything unparsed.
  // observe() on an already-observed element is a no-op and fires no callback,
  // so a page whose parse failed while it stayed on screen was stuck forever.
  // unobserve-then-observe forces a fresh initial intersection record.
  window.__yomibakoRetry = function(){
    try{
      const {els: pages} = pageEls();
      pages.forEach(p=>{
        if(p.dataset && p.dataset.yomibakoParsed==='1') return;
        if(pendingBatchesMap.has(p)) return;
        try{ observer.unobserve(p); observer.observe(p); }catch(_){}
      });
    }catch(_){}
  };

  // An explicit native "Re-parse" is different from the automatic retry:
  // unwrap generated JPDB spans, invalidate old parse replies, and parse the
  // visible page from clean OCR text again.
  window.__yomibakoReparse = function(){
    try{
      reparseRun++;
      parseQueue.length=0;
      try{
        pending.forEach(function(p){ try{ p.reject(new Error('__yomibako_reparse__')); }catch(_){} });
        pending.clear();
      }catch(_){}
      pendingBatchesMap.clear();
      reverseIndex.clear();
      var wrappers=[];
      var allPages=pageEls().els;
      if(ownedPages){
        for(var p=0;p<allPages.length;p++){
          wrappers.push.apply(wrappers,[].slice.call(allPages[p].querySelectorAll('.jpdb-word')));
        }
      }else{
        wrappers=[].slice.call(document.querySelectorAll('.jpdb-word'));
      }
      for(var i=0;i<wrappers.length;i++){
        var wrapper=wrappers[i];
        if(!wrapper.parentNode) continue;
        var copy=wrapper.cloneNode(true);
        var ruby=copy.querySelectorAll?copy.querySelectorAll('rt'):[];
        for(var j=0;j<ruby.length;j++) ruby[j].remove();
        wrapper.parentNode.replaceChild(document.createTextNode(copy.textContent||''),wrapper);
      }
      var pages=allPages;
      for(var n=0;n<pages.length;n++){
        try{
          delete pages[n].dataset.yomibakoParsed;
          pages[n].normalize();
          observer.unobserve(pages[n]);
          observer.observe(pages[n]);
        }catch(_){}
      }
      post('control',{key:'reparse',ok:true,value:true});
      setTimeout(function(){
        try{
          var idx=navIndex();
          if(idx>=0 && pages[idx]) queuePageForParse(pages[idx]);
        }catch(_){}
      },0);
    }catch(e){ post('control',{key:'reparse',ok:false,error:String((e&&e.message)||e)}); }
  };

  // Late-added pages (large volumes / slow image layout) — observe on arrival.
  try{
    const mo=new MutationObserver((mutations)=>{
      for(const m of mutations){
        for(const node of m.addedNodes){
          if(!(node instanceof HTMLElement)) continue;
          if(node.classList && node.classList.contains('yomibako-spread')) continue;
          if(node.matches && (node.matches('#pagesContainer > div') || node.matches('#pagesContainer .page') || node.matches('.page'))){
            registerOwnedPage(node);
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
