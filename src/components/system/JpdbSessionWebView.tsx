// Hidden jpdb.io session view — gives the app the login cookies the
// extension gets for free via `credentials: "include"`.
//
// Mounted once in App (1px, invisible). Loads the jpdb.io homepage on
// launch (small, refreshes login status), then idles. Cookie-gated jobs
// (audio hash, review pages, FORQ) run fetch() inside this page through
// session.ts, so cookies attach automatically. Login itself happens in the
// regular Browser tab — this view shares the same cookie jar.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { handleSessionMessage, registerSessionExecutor, subscribeSessionWake } from '../../services/jpdb/session';

const JPDB_HOME = 'https://jpdb.io/';
const CHUNK = 20000;

const SESSION_BRIDGE_JS = `
(function(){
  if (window.__yomibakoSession) { try{ window.ReactNativeWebView.postMessage(JSON.stringify({type:'sessionReady'})); }catch(_){} return; }
  window.__yomibakoSession = true;
  function post(o){ try{ window.ReactNativeWebView.postMessage(JSON.stringify(o)); }catch(_){} }
  window.__yomibakoSessionDo = async function(id, method, url, body, contentType){
    try{
      const headers = { 'Accept': 'text/html,*/*' };
      const init = { method: method || 'GET', credentials: 'include', headers };
      if (body !== null && body !== undefined) {
        init.method = 'POST';
        init.body = body;
        headers['Content-Type'] = contentType || 'application/x-www-form-urlencoded';
      }
      const res = await fetch(url, init);
      const text = await res.text();
      if (!res.ok) { post({type:'sessionError', id, status: res.status, error:'JPDB ' + res.status + ' for ' + url}); return; }
      const total = Math.ceil(text.length / ${CHUNK});
      post({type:'sessionMeta', id, chunks: total});
      for (let i = 0; i < total; i++) {
        post({type:'sessionChunk', id, i, total, part: text.slice(i * ${CHUNK}, (i + 1) * ${CHUNK})});
      }
    }catch(e){ post({type:'sessionError', id, error: String((e && e.message) || e)}); }
  };
  function reportStatus(){
    try{
      const loggedOut = !!document.querySelector('a[href="/login"]');
      post({type:'sessionStatus', value: loggedOut ? 'out' : 'in'});
    }catch(_){}
  }
  post({type:'sessionReady'});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reportStatus);
  else setTimeout(reportStatus, 300);
  true;
})();
true;
`;

export default function JpdbSessionWebView() {
  const webRef = useRef<WebView>(null);
  const urlRef = useRef(JPDB_HOME);
  const [url, setUrl] = useState(JPDB_HOME);

  useEffect(() => {
    registerSessionExecutor((code: string) => {
      webRef.current?.injectJavaScript(code);
    });
    return subscribeSessionWake(() => {
      if (!urlRef.current.includes('jpdb.io')) setUrl(JPDB_HOME);
      else webRef.current?.reload();
    });
  }, []);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      handleSessionMessage(msg);
    } catch {}
  }, []);

  return (
    <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} pointerEvents="none">
      <WebView
        ref={webRef}
        source={{ uri: url }}
        style={{ width: 1, height: 1 }}
        javaScriptEnabled
        domStorageEnabled
        onMessage={onMessage}
        onNavigationStateChange={(nav) => { urlRef.current = nav.url; }}
        injectedJavaScriptBeforeContentLoaded={SESSION_BRIDGE_JS}
      />
    </View>
  );
}
