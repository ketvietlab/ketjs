// User code runs only in an opaque-origin iframe, never in the documentation window.
export function previewDocument(code, { runtimeUrl, colors, nonce }) {
  const literal = (value) =>
    JSON.stringify(value)
      .replaceAll('<', '\\u003c')
      .replaceAll('\u2028', '\\u2028')
      .replaceAll('\u2029', '\\u2029')
  const safeUrl = new URL(runtimeUrl)
  if (!['http:', 'https:'].includes(safeUrl.protocol)) throw new Error('Invalid runtime URL')
  const cssColors = colors.map((color) => {
    if (!/^[#(),.%\w\s-]+$/.test(color)) throw new Error('Invalid preview color')
    return color
  })
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${safeUrl.origin} 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; base-uri 'none'; form-action 'none'"><style>
  :root{--preview-bg:${cssColors[0]};--preview-text:${cssColors[1]};--preview-border:${cssColors[2]};--preview-accent:${cssColors[3]}}*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--preview-bg);color:var(--preview-text);font:14px/1.6 system-ui,sans-serif}h1{font-size:24px;line-height:1.3}label{display:block}button,input{font:inherit;border:1px solid var(--preview-border);border-radius:6px;padding:8px 12px;background:var(--preview-bg);color:inherit}button{cursor:pointer;margin:8px 0}button:hover{border-color:var(--preview-accent)}input:not([type=checkbox]){display:block;width:100%;max-width:400px;margin:8px 0}input[type=checkbox]{margin-right:8px}a{color:var(--preview-accent)}li{margin:8px 0}ul{padding-left:24px}
  </style></head><body><div id="app"></div><script src="${safeUrl.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></script><script>
  const send=(type,message)=>parent.postMessage({source:'ketjs-playground',nonce:${literal(nonce)},type,message},'*');
  addEventListener('error',e=>send('error',e.message));
  addEventListener('unhandledrejection',e=>send('error',String(e.reason)));
  addEventListener('message',e=>{
    if(e.source!==parent||e.data?.source!=='ketjs-playground-theme'||e.data.nonce!==${literal(nonce)}||!Array.isArray(e.data.colors)||e.data.colors.length!==4)return;
    e.data.colors.forEach((value,i)=>{if(typeof value==='string'&&CSS.supports('color',value))document.documentElement.style.setProperty(['--preview-bg','--preview-text','--preview-border','--preview-accent'][i],value);});
  });
  try {
    const module={exports:{}};
    const require=(name)=>{if(name==='@ketvietlab/ketjs-view')return KetPlayground.view;if(name==='@ketvietlab/ketjs-view/jsx-runtime'||name==='@ketvietlab/ketjs-view/jsx-dev-runtime')return KetPlayground.jsx;throw new Error('This browser playground supports ketjs-view imports only. Use the Node lab for server packages.');};
    new Function('require','module','exports',${literal(code)})(require,module,module.exports);
    if(typeof module.exports.default!=='function')throw new Error('Export a default factory returning a view function.');
    const instance=module.exports.default();
    const render=typeof instance==='function'?instance:instance.view;
    if(typeof render!=='function')throw new Error('The factory must return a view function or an island controller.');
    const lifetime=new AbortController();
    const mounted=KetPlayground.view.mount(KetPlayground.view.domHost(),document.getElementById('app'),render);
    instance.mount?.({root:document.getElementById('app'),lifetime:lifetime.signal});
    addEventListener('pagehide',()=>{lifetime.abort();instance.dispose?.();mounted.dispose();},{once:true});
    if(!document.getElementById('app').childNodes.length)throw new Error('The view rendered no content. Return a TSX element from your view.');
    send('ready','Preview is running.');
  }catch(error){send('error',String(error.message||error));}
  </script></body></html>`
}
