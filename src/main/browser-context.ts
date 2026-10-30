import type { WebContents } from "electron";

export interface PageAnchorRect { x: number; y: number; width: number; height: number }
export interface BrowserElementSelection { tag: string; label: string; text: string; rect?: PageAnchorRect }
export interface PageAnchorState { anchorId: string; rect?: PageAnchorRect; unavailable?: string }
export interface PageRegionViewport {
  width: number; height: number; scrollX: number; scrollY: number;
  visualScale: number; visualOffsetX: number; visualOffsetY: number;
}
export interface PageRegionSelection {
  requestId: string; rect: PageAnchorRect; viewport: PageRegionViewport; captureRevision: number;
}
const world = 1001;
const maxAnchors = 1024;
const validId = (id: string) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id);

// This program runs only in the isolated world. No page text, comment bodies, or
// expected selection text is interpolated into it; commands carry opaque IDs/numbers.
const pageRuntime = String.raw`
  if (!globalThis.__ompPageAnchors) {
    const entries = new Map();
    const sensitive = 'input,textarea,select,[contenteditable],[role="textbox"],[role="combobox"]';
    const excluded = sensitive + ',iframe,object,embed,script,style';
    let host, shadow, observer, sizeObserver, frame = 0, clicked, picker;
    let markers = [];
    let regionCapture, regionRevision = 0;
    const regionLayers = new WeakSet();
    const shadowObservers = new Map();
    const regionScroll = event => {
      if (event.target instanceof Element && event.target !== document.scrollingElement) invalidateRegions();
    };
    const regionLoad = event => {
      if (!(event.target instanceof Element) || own(event.target)) return;
      if (regionCapture) regionCapture.invalid = true;
      for (const entry of entries.values()) if (entry.region && entry.contentNodes.includes(event.target)) entry.invalid = 'changed';
      schedule();
    };
    const viewport = () => ({width:innerWidth,height:innerHeight,scrollX,scrollY,
      visualScale:window.visualViewport?.scale ?? 1,visualOffsetX:window.visualViewport?.offsetLeft ?? 0,
      visualOffsetY:window.visualViewport?.offsetTop ?? 0});
    const sameViewport = (a,b) => Object.keys(a).every(key => a[key] === b[key]);
    const overlaps = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
    const box = node => {
      const r = node.getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height};
    };
    // 只检查相交的可见节点；开放 shadow 递归检查，无法审计的自定义宿主保守拒绝。
    const inspectRegion = rect => {
      const nodes = [], contentNodes = [];
      if (!regionCapture?.prepared && markers.some(marker => !marker.button.hidden && overlaps(rect,box(marker.button))))
        throw new Error('选区包含评论标记，请重新框选');
      const visit = root => {
        for (const node of root.children) {
          if (own(node) || node === regionCapture?.layer) continue;
          const r = box(node), style = getComputedStyle(node);
          const visible = r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          if (visible && overlaps(rect,r)) {
            if (!ancestorsSafe(node)) throw new Error('选区包含表单、嵌入内容或不可检查的区域，请重新框选');
            for (let ancestor = node; ancestor; ancestor = ancestor.parentElement || ancestor.getRootNode()?.host) {
              if (ancestor.matches('dialog,[popover]') || (ancestor.localName.includes('-') && !ancestor.shadowRoot))
                throw new Error('选区包含表单、嵌入内容或不可检查的区域，请重新框选');
            }
            // 结构祖先只登记属性依赖；正文身份与几何仅由实际相交的内容承担。
            const contentStart = contentNodes.length;
            for (const child of node.childNodes) if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
              const range = document.createRange(); range.selectNodeContents(child);
              const fragments = range.getClientRects?.();
              if (!fragments || Array.from(fragments).some(fragment => overlaps(rect,fragment))) contentNodes.push(child);
            }
            if ((!node.children.length && !node.shadowRoot?.children.length) || node.matches('img,svg,canvas,video,audio'))
              contentNodes.push(node);
            nodes.push({node,x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,content:contentNodes.length > contentStart});
          }
          visit(node);
          if (node.shadowRoot && !shadowObservers.has(node.shadowRoot)) {
            const watcher = new MutationObserver(regionMutation);
            watcher.observe(node.shadowRoot,{childList:true,subtree:true,characterData:true,attributes:true});
            shadowObservers.set(node.shadowRoot,watcher);
          }
          if (node.shadowRoot) visit(node.shadowRoot);
        }
      };
      visit(document.documentElement);
      return {nodes,contentNodes};
    };
    const regionGeometry = entry => {
      if (entry.invalid) return {anchorId:entry.anchorId,unavailable:entry.invalid};
      for (const saved of entry.nodes) {
        if (!saved.node.isConnected) { entry.invalid = 'detached'; break; }
        const r = box(saved.node);
        if (saved.content && (r.x+scrollX !== saved.x || r.y+scrollY !== saved.y || r.width !== saved.width || r.height !== saved.height)) {
          entry.invalid = 'changed'; break;
        }
      }
      if (entry.invalid) return {anchorId:entry.anchorId,unavailable:entry.invalid};
      const r = entry.region;
      const x = Math.max(0,r.x-scrollX), y = Math.max(0,r.y-scrollY);
      const right = Math.min(viewport().width,r.x-scrollX+r.width), bottom = Math.min(viewport().height,r.y-scrollY+r.height);
      return right > x && bottom > y ? {anchorId:entry.anchorId,rect:{x,y,width:right-x,height:bottom-y}} :
        {anchorId:entry.anchorId,unavailable:'offscreen'};
    };
    const invalidateRegions = () => {
      for (const entry of entries.values()) if (entry.region) entry.invalid = 'changed';
      if (regionCapture) regionCapture.invalid = true;
      schedule();
    };
    const regionMutation = records => {
      const changes = records.filter(record => !own(record.target) && !regionLayers.has(record.target) &&
        !(record.type === 'childList' && [...record.addedNodes,...record.removedNodes].every(node =>
          node === host || regionLayers.has(node))));
      if (!changes.length) return;
      if (regionCapture) regionCapture.invalid = true;
      for (const entry of entries.values()) if (entry.region && changes.some(record => {
        if (document.head?.contains(record.target)) return true;
        if (record.type === 'attributes') return entry.nodes.some(saved => record.target === saved.node);
        if (record.type === 'characterData') return entry.contentNodes.includes(record.target);
        if (entry.contentNodes.includes(record.target) || Array.from(record.removedNodes).some(removed =>
          entry.contentNodes.some(content => removed === content || removed.contains?.(content)))) return true;
        const rect = {...entry.region,x:entry.region.x-scrollX,y:entry.region.y-scrollY};
        const intersects = node => {
          if (own(node) || regionLayers.has(node)) return false;
          if (node.nodeType === Node.TEXT_NODE) {
            if (!node.textContent.trim()) return false;
            const range = document.createRange(); range.selectNodeContents(node);
            return Array.from(range.getClientRects?.() || []).some(fragment => overlaps(rect,fragment));
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return false;
          const bounds = box(node), style = getComputedStyle(node);
          if (bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && overlaps(rect,bounds)) return true;
          return Array.from(node.children).some(intersects) || Boolean(node.shadowRoot && Array.from(node.shadowRoot.children).some(intersects));
        };
        return Array.from(record.addedNodes).some(intersects);
      })) entry.invalid = 'changed';
      schedule();
    };
    const prunePending = () => {
      const cutoff = Date.now() - 60000;
      for (const [id,entry] of entries) if (!entry.confirmed && entry.created < cutoff) entries.delete(id);
    };
    const retain = (anchorId,entry) => {
      prunePending();
      if (entries.size >= 2048 && !entries.has(anchorId)) {
        for (const [id,current] of entries) {
          if (!current.confirmed) { entries.delete(id); break; }
        }
      }
      if (entries.size >= 2048 && !entries.has(anchorId)) throw new Error('页面引用过多');
      entries.set(anchorId,{...entry,created:Date.now(),confirmed:false});
    };
    const html = () => document.contentType === 'text/html' || document.contentType === 'application/xhtml+xml';
    const own = node => node === host || Boolean(host && host.contains(node));
    const ancestorsSafe = element => {
      for (let node = element; node; node = node.parentElement || node.getRootNode()?.host) {
        if (own(node) || node.matches(excluded)) return false;
      }
      return true;
    };
    const allowed = element => Boolean(element?.isConnected && element.ownerDocument === document &&
      ancestorsSafe(element) && !element.querySelector(excluded) && !element.shadowRoot?.querySelector(excluded));
    const elementText = element => {
      const tag = element.tagName.toLowerCase();
      const rawLabel = element.getAttribute('aria-label') || (tag === 'img' ? element.getAttribute('alt') : '') || '';
      let raw = rawLabel.slice(0,4001);
      if (!raw) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {acceptNode(node) {
          const parent = node.parentElement;
          return parent && !own(parent) && ancestorsSafe(parent) && parent.getClientRects().length &&
            getComputedStyle(parent).visibility !== 'hidden' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }});
        let visited = 0;
        while (raw.length <= 4000 && visited++ < 20000 && walker.nextNode()) raw += walker.currentNode.textContent.slice(0,4001-raw.length);
      }
      return {tag,label:rawLabel.slice(0,512),text:raw.length > 4000 ? raw.slice(0,4000) + '（元素文本已截断）' : raw};
    };
    const rangeSafe = range => {
      if (!range.startContainer.isConnected || !range.endContainer.isConnected ||
        range.startContainer.ownerDocument !== document || range.endContainer.ownerDocument !== document) return false;
      for (const endpoint of [range.startContainer, range.endContainer]) {
        const parent = endpoint.nodeType === Node.ELEMENT_NODE ? endpoint : endpoint.parentElement;
        if (!parent || !ancestorsSafe(parent)) return false;
      }
      for (const node of document.querySelectorAll(excluded)) if (range.intersectsNode(node)) return false;
      if (host?.isConnected && range.intersectsNode(host)) return false;
      return true;
    };
    const targetElement = target => target.nodeType === Node.ELEMENT_NODE ? target :
      (target.startContainer.nodeType === Node.ELEMENT_NODE ? target.startContainer : target.startContainer.parentElement);
    const targetRect = target => {
      // 长选区只定位首个真实片段，不能把整段的包围盒当成可见原文。
      const fragments = target.getClientRects?.();
      return fragments?.length ? Array.from(fragments).find(rect => rect.width > 0 && rect.height > 0) : target.getBoundingClientRect();
    };
    const geometry = target => {
      const element = targetElement(target);
      if (!element?.isConnected || !element.getClientRects().length ||
        ['hidden','collapse'].includes(getComputedStyle(element).visibility)) return {};
      const rect = targetRect(target);
      if (!rect || ![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite) ||
        Math.abs(rect.x) > 10000000 || Math.abs(rect.y) > 10000000 || rect.width <= 0 || rect.height <= 0 ||
        rect.width > 10000000 || rect.height > 10000000) return {};
      let x = Math.max(0,rect.x), y = Math.max(0,rect.y);
      let right = Math.min(innerWidth,rect.right), bottom = Math.min(innerHeight,rect.bottom);
      for (let parent = element.parentElement || element.getRootNode()?.host; parent; parent = parent.parentElement || parent.getRootNode()?.host) {
        const style = getComputedStyle(parent);
        const clip = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX || style.overflow)) {
          x = Math.max(x,clip.left + parent.clientLeft);
          right = Math.min(right,clip.left + parent.clientLeft + parent.clientWidth);
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY || style.overflow)) {
          y = Math.max(y,clip.top + parent.clientTop);
          bottom = Math.min(bottom,clip.top + parent.clientTop + parent.clientHeight);
        }
      }
      return right <= x || bottom <= y ? {offscreen:true} : {rect:{x,y,width:right-x,height:bottom-y}};
    };
    const rectOf = target => geometry(target).rect;
    const state = anchorId => {
      const entry = entries.get(anchorId);
      if (!entry) return {anchorId,unavailable:'missing'};
      if (entry.invalid) return {anchorId,unavailable:entry.invalid};
      if (entry.region) return regionGeometry(entry);
      const target = entry.element || entry.range;
      if (entry.element) {
        if (!entry.element.isConnected) entry.invalid = 'detached';
        else if (!allowed(entry.element)) entry.invalid = 'changed';
        else {
          const current = elementText(entry.element);
          if (current.text !== entry.text || current.label !== entry.label || current.tag !== entry.tag) entry.invalid = 'changed';
        }
      } else {
        const range = entry.range;
        if (!range.startContainer.isConnected || !range.endContainer.isConnected) entry.invalid = 'detached';
        else if (range.startContainer !== entry.start || range.endContainer !== entry.end ||
          range.startOffset !== entry.startOffset || range.endOffset !== entry.endOffset ||
          !rangeSafe(range) || range.toString() !== entry.text) entry.invalid = 'changed';
      }
      if (entry.invalid) return {anchorId,unavailable:entry.invalid};
      const measured = geometry(target);
      return measured.rect ? {anchorId,rect:measured.rect} : {anchorId,unavailable:measured.offscreen ? 'offscreen' : 'not-visible'};
    };
    const reveal = anchorId => {
      const before = state(anchorId);
      if (!before.rect && before.unavailable !== 'offscreen') return before;
      const entry = entries.get(anchorId);
      if (entry.region) {
        window.scrollTo({left:entry.region.x-Math.max(0,(innerWidth-entry.region.width)/2),
          top:entry.region.y-Math.max(0,(innerHeight-entry.region.height)/2),behavior:'instant'});
        render();
        return state(anchorId);
      }
      const target = entry.element || entry.range;
      const element = targetElement(target);
      // 从内向外滚动，每层都重新测量 Range；不滚到父段落顶部，不修改原选区。
      for (let parent = element; parent; parent = parent.parentElement || parent.getRootNode()?.host) {
        if (parent === document.scrollingElement) continue;
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        const rect = targetRect(target);
        const dx = rect.left - bounds.left - parent.clientLeft - Math.max(0,(parent.clientWidth - rect.width)/2);
        const dy = rect.top - bounds.top - parent.clientTop - Math.max(0,(parent.clientHeight - rect.height)/2);
        if (/(auto|scroll|hidden)/.test(style.overflowX || style.overflow) && parent.scrollWidth > parent.clientWidth)
          parent.scrollTo({left:parent.scrollLeft + dx,top:parent.scrollTop,behavior:'instant'});
        if (/(auto|scroll|hidden)/.test(style.overflowY || style.overflow) && parent.scrollHeight > parent.clientHeight)
          parent.scrollTo({left:parent.scrollLeft,top:parent.scrollTop + dy,behavior:'instant'});
      }
      const rect = targetRect(target);
      window.scrollTo({left:scrollX + rect.left - Math.max(0,(innerWidth-rect.width)/2),
        top:scrollY + rect.top - Math.max(0,(innerHeight-rect.height)/2),behavior:'instant'});
      render();
      return state(anchorId);
    };
    const render = () => {
      frame = 0;
      if (!host?.isConnected) return;
      const occupied = new Set();
      const columns = Math.max(1,Math.floor(innerWidth/32));
      const rows = Math.max(1,Math.floor(innerHeight/32));
      for (const marker of markers) {
        const result = state(marker.anchorId);
        const button = marker.button;
        button.hidden = !result.rect;
        marker.outline.hidden = !result.rect;
        if (result.rect) {
          const rect = result.rect;
          Object.assign(marker.outline.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});
          const span = Math.min(columns,Math.max(1,Math.ceil((String(marker.number).length*8+14)/32)));
          const start = Math.min(rows-1,Math.floor(rect.y/32))*columns + Math.min(columns-span,Math.floor(rect.x/32));
          let slot = start;
          for (let attempt = 0; attempt < columns*rows; attempt++) {
            const candidate = (start+attempt) % (columns*rows);
            const column = candidate % columns;
            if (column+span > columns) continue;
            let free = true;
            for (let offset = 0; offset < span; offset++) if (occupied.has(candidate+offset)) free = false;
            if (free) { slot = candidate; break; }
          }
          for (let offset = 0; offset < span; offset++) occupied.add(slot+offset);
          button.style.left = (slot % columns)*32 + 'px';
          button.style.top = Math.floor(slot/columns)*32 + 'px';
        }
      }
    };
    const schedule = () => { if (!frame && markers.length) frame = requestAnimationFrame(render); };
    const ensureLayer = () => {
      if (host?.isConnected) return;
      host?.remove();
      host = document.createElement('div');
      host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
      shadow = host.attachShadow({mode:'closed'});
      const style = document.createElement('style');
      style.textContent = ':host{all:initial}.outline{box-sizing:border-box;position:fixed;pointer-events:none;border:2px solid #458cff;border-radius:2px}button{all:initial;box-sizing:border-box;position:fixed;pointer-events:auto;display:flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 5px;border:2px solid white;border-radius:13px;background:#2563eb;color:white;font:bold 12px sans-serif;cursor:pointer;box-shadow:0 1px 5px #0008}[hidden]{display:none!important}';
      shadow.append(style);
      document.documentElement.append(host);
      if (!observer) {
        observer = new MutationObserver(records => {
          if (records.some(record => record.target !== host && !own(record.target))) schedule();
          regionMutation(records);
        });
        observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true});
        if (typeof ResizeObserver !== 'undefined') sizeObserver = new ResizeObserver(schedule);
        window.addEventListener('scroll',schedule,true);
        window.addEventListener('resize',schedule);
        window.visualViewport?.addEventListener('resize',schedule);
        window.visualViewport?.addEventListener('scroll',schedule);
        window.addEventListener('scroll',regionScroll,true);
        document.addEventListener('load',regionLoad,true);
        window.addEventListener('resize',invalidateRegions);
        window.visualViewport?.addEventListener('resize',invalidateRegions);
      }
    };
    const pickRegion = (anchorId,requestId) => {
      if (!html()) throw new Error('此文档不支持框选');
      picker?.();
      regionCapture?.cancel();
      ensureLayer();
      const initial = viewport();
      if (initial.visualScale !== 1 || initial.visualOffsetX !== 0 || initial.visualOffsetY !== 0)
        throw new Error('请恢复页面捏合缩放后框选');
      const {promise,resolve,reject} = Promise.withResolvers();
      let previous = document.activeElement;
      while (previous?.shadowRoot?.activeElement) previous = previous.shadowRoot.activeElement;
      const layer = document.createElement('div');
      regionLayers.add(layer);
      layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;touch-action:none;background:transparent;';
      layer.tabIndex = -1; layer.setAttribute('aria-label','拖动框选可见区域，Esc 取消');
      const root = layer.attachShadow({mode:'closed'});
      const outline = document.createElement('div');
      outline.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #458cff;background:#458cff18;display:none;box-sizing:border-box;';
      root.append(outline);
      const transaction = {anchorId,requestId,layer,initial,revision:++regionRevision,invalid:false};
      regionCapture = transaction;
      document.documentElement.append(layer);
      let done = false, start, rect;
      const listeners = [];
      const on = (target,type,handler) => { target.addEventListener(type,handler,true); listeners.push([target,type,handler]); };
      const captureListeners = [];
      const duringCapture = (target,type,handler) => {
        target.addEventListener(type,handler,true); captureListeners.push([target,type,handler]);
      };
      // pointerup 只结束拖动；授权截图事务到 finish/cancel 才释放取消监听。
      transaction.release = () => {
        clearTimeout(timer); watcher.disconnect();
        for (const [target,type,handler] of captureListeners) target.removeEventListener(type,handler,true);
        captureListeners.length = 0;
      };
      const stop = (value = null,error) => {
        if (done) return;
        done = true;
        for (const [target,type,handler] of listeners) target.removeEventListener(type,handler,true);
        if (picker === cancel) picker = undefined;
        if (!value) {
          transaction.release();
          layer.remove(); entries.delete(anchorId);
          if (regionCapture === transaction) regionCapture = undefined;
        } else layer.style.pointerEvents = 'auto';
        if (previous?.isConnected && ancestorsSafe(previous)) previous.focus?.({preventScroll:true});
        error ? reject(new Error(error)) : resolve(value);
      };
      const cancel = () => {
        if (!done) { stop(); return; }
        if (regionCapture !== transaction) return;
        transaction.invalid = true; transaction.release();
        entries.delete(anchorId); layer.remove(); regionCapture = undefined;
        host?.style.removeProperty('visibility');
      };
      transaction.cancel = cancel;
      picker = cancel;
      const timer = setTimeout(cancel,60000);
      const watcher = new MutationObserver(() => { if (!layer.isConnected) cancel(); });
      watcher.observe(document.documentElement,{childList:true,subtree:true});
      const suppress = event => { event.preventDefault(); event.stopImmediatePropagation(); };
      for (const type of ['click','dblclick','dragstart','drop','wheel']) layer.addEventListener(type,suppress,true);
      on(layer,'contextmenu',event => { suppress(event); cancel(); });
      on(window,'keydown',event => { suppress(event); if (event.key === 'Escape') cancel(); });
      // capture 阶段也会看到元素失焦；只有窗口自身 blur 才表示宿主失焦。
      duringCapture(window,'keydown',event => { if (event.key === 'Escape') { suppress(event); cancel(); } });
      duringCapture(window,'blur',event => { if (event.target === event.currentTarget) cancel(); });
      duringCapture(window,'scroll',cancel);
      duringCapture(window,'resize',cancel);
      if (window.visualViewport) {
        duringCapture(window.visualViewport,'resize',cancel);
        duringCapture(window.visualViewport,'scroll',cancel);
      }
      on(layer,'pointercancel',cancel);
      on(layer,'lostpointercapture',cancel);
      on(layer,'pointerdown',event => {
        suppress(event); if (!event.isTrusted || event.button !== 0) return;
        if (event.clientX < 0 || event.clientY < 0 || event.clientX >= (document.documentElement.clientWidth || initial.width) ||
          event.clientY >= (document.documentElement.clientHeight || initial.height)) return;
        start = {x:event.clientX,y:event.clientY};
        layer.setPointerCapture?.(event.pointerId);
      });
      on(layer,'pointermove',event => {
        suppress(event); if (!event.isTrusted || !start) return;
        const x = Math.max(0,Math.min(document.documentElement.clientWidth || initial.width,event.clientX)),
          y = Math.max(0,Math.min(document.documentElement.clientHeight || initial.height,event.clientY));
        rect = {x:Math.min(start.x,x),y:Math.min(start.y,y),width:Math.abs(start.x-x),height:Math.abs(start.y-y)};
        Object.assign(outline.style,{display:'block',left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});
      });
      on(layer,'pointerup',event => {
        suppress(event); if (!event.isTrusted || !start) return;
        const x = Math.max(0,Math.min(document.documentElement.clientWidth || initial.width,event.clientX)),
          y = Math.max(0,Math.min(document.documentElement.clientHeight || initial.height,event.clientY));
        rect = {x:Math.min(start.x,x),y:Math.min(start.y,y),width:Math.abs(start.x-x),height:Math.abs(start.y-y)};
        if (!rect || rect.width < 4 || rect.height < 4) { cancel(); return; }
        try {
          if (!sameViewport(initial,viewport()) || transaction.invalid) throw new Error('页面已变化，请重新框选');
          const {nodes,contentNodes} = inspectRegion(rect);
          retain(anchorId,{anchorId,region:{...rect,x:rect.x+scrollX,y:rect.y+scrollY},nodes,contentNodes});
          transaction.selection = {requestId,rect,viewport:initial,captureRevision:transaction.revision};
          stop(transaction.selection);
        } catch (error) { stop(null,error.message); }
      });
      layer.focus({preventScroll:true});
      if (document.elementsFromPoint(innerWidth/2,innerHeight/2)[0] !== layer ||
        Array.from(document.querySelectorAll('dialog,[popover]')).some(node => node.matches(':modal,:popover-open')))
        stop(null,'请先关闭网页内对话框');
      return promise;
    };
    const captureMatches = command => regionCapture && regionCapture.requestId === command.requestId &&
      regionCapture.revision === command.captureRevision;
    const captureValid = transaction => !transaction.invalid && transaction.selection &&
      sameViewport(transaction.initial,viewport()) && !state(transaction.anchorId).unavailable;
    const selection = anchorId => {
      if (!html()) return null;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
      const range = selection.getRangeAt(0).cloneRange();
      if (!rangeSafe(range)) return null;
      const text = range.toString();
      if (text.length > 65536) throw new Error('所选内容过长，请缩小范围');
      if (!text.trim()) return null;
      if (anchorId) {
        retain(anchorId,{range,text,start:range.startContainer,end:range.endContainer,startOffset:range.startOffset,endOffset:range.endOffset});
      }
      return {text,rect:rectOf(range)};
    };
    const pick = anchorId => {
      if (!html()) throw new Error('此文档不支持选择页面元素');
      picker?.();
      regionCapture?.cancel();
      const {promise,resolve,reject} = Promise.withResolvers();
      let previous = document.activeElement;
      while (previous?.shadowRoot?.activeElement) previous = previous.shadowRoot.activeElement;
      const layer = document.createElement('div');
      regionLayers.add(layer);
      layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:transparent;';
      const root = layer.attachShadow({mode:'closed'});
      const outline = document.createElement('div');
      outline.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #458cff;display:none;';
      root.append(outline);
      layer.tabIndex = -1;
      layer.setAttribute('aria-label','点击页面元素以评论，Esc 取消');
      document.documentElement.append(layer);
      let done = false;
      const stop = (value = null,error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        watcher.disconnect();
        layer.remove();
        window.removeEventListener('keydown',key,true);
        picker = undefined;
        if (previous?.isConnected && ancestorsSafe(previous)) previous.focus?.({preventScroll:true});
        error ? reject(new Error(error)) : resolve(value);
      };
      picker = () => stop();
      const timer = setTimeout(() => stop(),60000);
      const watcher = new MutationObserver(() => { if (!layer.isConnected) stop(); });
      watcher.observe(document.documentElement,{childList:true,subtree:true});
      const key = event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); stop(); }
        else if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End',' '].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); }
      };
      window.addEventListener('keydown',key,true);
      layer.focus({preventScroll:true});
      if (document.elementsFromPoint(innerWidth/2,innerHeight/2)[0] !== layer ||
        Array.from(document.querySelectorAll('dialog,[popover]')).some(node => node.matches(':modal,:popover-open'))) {
        stop(null,'请先关闭网页内对话框'); return promise;
      }
      const target = event => {
        let element = document.elementsFromPoint(event.clientX,event.clientY).find(node => node !== layer && !own(node));
        while (element?.shadowRoot) {
          const inner = element.shadowRoot.elementFromPoint(event.clientX,event.clientY);
          if (!inner || inner === element) break;
          element = inner;
        }
        return element;
      };
      layer.addEventListener('pointermove',event => {
        const element = target(event);
        const rect = allowed(element) ? rectOf(element) : undefined;
        outline.style.display = rect ? 'block' : 'none';
        if (rect) Object.assign(outline.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});
      });
      layer.addEventListener('click',event => {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.isTrusted || !layer.isConnected) return;
        const element = target(event);
        if (!allowed(element)) return;
        const value = elementText(element);
        if (anchorId) {
          try { retain(anchorId,{element,...value}); }
          catch { stop(null,'页面引用过多'); return; }
        }
        stop({...value,rect:rectOf(element)});
      },true);
      return promise;
    };
    globalThis.__ompPageAnchors = command => {
      prunePending();
      switch (command.op) {
        case 'selection': return selection(command.anchorId);
        case 'discard': entries.delete(command.anchorId); return null;
        case 'pick': return pick(command.anchorId);
        case 'pick-region': return pickRegion(command.anchorId,command.requestId);
        case 'cancel-region':
          if (regionCapture?.requestId !== command.requestId) return null;
          regionCapture.cancel();
          return null;
        case 'prepare-region-capture': {
          if (!captureMatches(command) || regionCapture.prepared || !captureValid(regionCapture)) throw new Error('页面已变化，请重新框选');
          const transaction = regionCapture;
          inspectRegion(transaction.selection.rect);
          transaction.prepared = true;
          transaction.layer.style.visibility = 'hidden';
          if (host) host.style.setProperty('visibility','hidden','important');
          const {promise,resolve} = Promise.withResolvers();
          requestAnimationFrame(() => requestAnimationFrame(() =>
            resolve(regionCapture === transaction && captureValid(transaction) ? transaction.selection : null)));
          return promise;
        }
        case 'finish-region-capture': {
          if (!captureMatches(command)) return false;
          const transaction = regionCapture;
          let valid = Boolean(transaction.prepared && captureValid(transaction));
          try { inspectRegion(transaction.selection.rect); } catch { valid = false; }
          transaction.release();
          transaction.layer.remove(); regionCapture = undefined;
          if (host) host.style.removeProperty('visibility');
          if (!valid || command.discard) entries.delete(transaction.anchorId);
          return valid && !command.discard;
        }
        case 'invalidate-regions': invalidateRegions(); return null;
        case 'reveal': return reveal(command.anchorId);
        case 'cancel':
          picker?.();
          regionCapture?.cancel();
          return null;
        case 'sync': {
          if (!html()) throw new Error('此文档不支持页面引用');
          for (const marker of command.markers) {
            const entry = entries.get(marker.anchorId);
            if (entry) entry.confirmed = true;
          }
          ensureLayer();
          for (const marker of markers) { marker.button.remove(); marker.outline.remove(); }
          sizeObserver?.disconnect();
          sizeObserver?.observe(document.documentElement);
          markers = command.markers.map(marker => {
            const button = document.createElement('button');
            const outline = document.createElement('div');
            outline.className = 'outline';
            outline.setAttribute('aria-hidden','true');
            const entry = entries.get(marker.anchorId);
            const observed = entry?.element || (entry?.start?.nodeType === Node.ELEMENT_NODE ? entry.start : entry?.start?.parentElement);
            if (observed) sizeObserver?.observe(observed);
            button.type = 'button'; button.textContent = String(marker.number);
            button.setAttribute('aria-label','评论 ' + marker.number);
            button.addEventListener('click',event => {
              event.preventDefault(); event.stopImmediatePropagation();
              if (event.isTrusted && host.isConnected && state(marker.anchorId).rect) clicked = marker.anchorId;
            });
            shadow.append(outline,button);
            return {...marker,button,outline};
          });
          render(); return null;
        }
        case 'read': {
          schedule();
          for (const id of command.ids) {
            const entry = entries.get(id);
            if (entry) entry.confirmed = true;
          }
          const anchors = command.ids.map(state);
          const result = {anchors};
          if (clicked && command.ids.includes(clicked)) result.clicked = clicked;
          clicked = undefined;
          return result;
        }
        case 'clear':
          picker?.(); entries.clear(); markers = []; clicked = undefined;
          regionCapture?.cancel();
          if (frame) cancelAnimationFrame(frame);
          frame = 0; observer?.disconnect(); observer = undefined;
          sizeObserver?.disconnect(); sizeObserver = undefined;
          for (const watcher of shadowObservers.values()) watcher.disconnect();
          shadowObservers.clear();
          window.removeEventListener('scroll',regionScroll,true);
          document.removeEventListener('load',regionLoad,true);
          window.removeEventListener('resize',invalidateRegions);
          window.visualViewport?.removeEventListener('resize',invalidateRegions);
          window.removeEventListener('scroll',schedule,true);
          window.removeEventListener('resize',schedule);
          window.visualViewport?.removeEventListener('resize',schedule);
          window.visualViewport?.removeEventListener('scroll',schedule);
          host?.remove(); host = undefined; shadow = undefined;
          return null;
      }
      throw new Error('Invalid page anchor command');
    };
  }
`;

function execute(contents: WebContents, command: object): Promise<unknown> {
  // 所有路径（包括迟到的 finally/cancel）共用此围栏，绝不向 PDF 插件安装 HTML runtime。
  if (contents.isDestroyed()) return Promise.reject(new Error("网页已关闭"));
  const mainFrame = contents.mainFrame;
  if (mainFrame?.frames.some(frame => !frame.detached && frame.parent === mainFrame &&
    frame.url === "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html"))
    return Promise.reject(new Error("PDF 不支持网页区域或元素脚本"));
  return contents.executeJavaScriptInIsolatedWorld(world, [{ code: `(() => {${pageRuntime}\nreturn globalThis.__ompPageAnchors(${JSON.stringify(command)});})()` }]);
}

function readRect(value: unknown): PageAnchorRect | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("网页引用位置无效");
  const rect = value as Record<string, unknown>;
  if (![rect.x, rect.y, rect.width, rect.height].every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 10_000_000) ||
    (rect.x as number) < 0 || (rect.y as number) < 0 || (rect.width as number) <= 0 || (rect.height as number) <= 0) throw new Error("网页引用位置无效");
  return { x: rect.x as number, y: rect.y as number, width: rect.width as number, height: rect.height as number };
}

function readSnapshot(value: unknown): { text: string; rect?: PageAnchorRect } {
  if (!value || typeof value !== "object" || !("text" in value) || typeof value.text !== "string" || value.text.length > 65536) throw new Error("网页选区无效");
  return { text: value.text, rect: readRect("rect" in value ? value.rect : undefined) };
}

/** Read only the live main-document selection, never form values or HTML. */
export async function readPageSelection(contents: WebContents): Promise<string | null> {
  const result = await execute(contents, { op: "selection" });
  return result === null ? null : readSnapshot(result).text;
}

/** Snapshot and retain the very same Range; compare expected text only in main. */
export async function capturePageSelection(contents: WebContents, anchorId: string, expectedText: string): Promise<{ text: string; rect?: PageAnchorRect }> {
  if (!validId(anchorId) || typeof expectedText !== "string" || expectedText.length > 65536) throw new Error("网页选区无效");
  try {
    const result = readSnapshot(await execute(contents, { op: "selection", anchorId }));
    if (result.text !== expectedText) throw new Error("网页选区已变化，请重新选择");
    return result;
  } catch (error) {
    await execute(contents, { op: "discard", anchorId }).catch(() => {});
    throw error;
  }
}

export function beginElementPick(contents: WebContents, anchorId?: string): { result: Promise<BrowserElementSelection | null>; cancel(): void } {
  const { promise: result, resolve: finish, reject: fail } = Promise.withResolvers<BrowserElementSelection | null>();
  let settled = false;
  const settle = (value: BrowserElementSelection | null, error?: unknown) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    if (error) fail(error); else finish(value);
  };
  const cancel = () => {
    settle(null);
    try {
      if (!contents.isDestroyed()) void execute(contents, { op: "cancel" }).catch(() => {});
    } catch { /* Navigation/destruction must not override cancellation. */ }
  };
  const deadline = setTimeout(cancel, 60_000);
  void Promise.resolve().then(() => {
    if (settled) return null;
    if (anchorId !== undefined && !validId(anchorId)) throw new Error("网页引用无效");
    contents.focus();
    return execute(contents, { op: "pick", anchorId });
  }).then(value => {
    if (value === null) { settle(null); return; }
    const snapshot = readSnapshot(value);
    if (!value || typeof value !== "object" || !("tag" in value) || typeof value.tag !== "string" || !/^[a-z][a-z0-9:-]{0,31}$/.test(value.tag) ||
      !("label" in value) || typeof value.label !== "string" || value.label.length > 512) throw new Error("网页元素引用无效");
    settle({ tag: value.tag, label: value.label, ...snapshot });
  }).catch((error: unknown) => { settle(null, error); cancel(); });
  return { result, cancel };
}

export async function syncPageMarkers(contents: WebContents, markers: { anchorId: string; number: number }[]): Promise<void> {
  if (!Array.isArray(markers) || markers.length > maxAnchors || markers.some(marker => !marker || !validId(marker.anchorId) || !Number.isSafeInteger(marker.number) || marker.number < 1 || marker.number > 1_000_000)) throw new Error("网页评论标记无效");
  await execute(contents, { op: "sync", markers: markers.map(({ anchorId, number }) => ({ anchorId, number })) });
}

/** 仅接受主进程已颁发的 opaque ID；滚动后重新校验并读取真实几何。 */
export async function revealPageAnchor(contents: WebContents, anchorId: string): Promise<PageAnchorState> {
  if (!validId(anchorId)) throw new Error("网页引用无效");
  const value = await execute(contents, { op: "reveal", anchorId });
  if (!value || typeof value !== "object" || !("anchorId" in value) || value.anchorId !== anchorId) throw new Error("网页引用无效");
  const rect = readRect("rect" in value ? value.rect : undefined);
  if ("unavailable" in value) {
    if (rect || typeof value.unavailable !== "string" || !["missing", "detached", "changed", "not-visible", "offscreen"].includes(value.unavailable)) throw new Error("网页引用无效");
    return { anchorId, unavailable: value.unavailable };
  }
  if (!rect) throw new Error("网页引用位置无效");
  return { anchorId, rect };
}

export async function readPageAnchors(contents: WebContents, ids: string[]): Promise<{ anchors: PageAnchorState[]; clicked?: string }> {
  if (!Array.isArray(ids) || ids.length > maxAnchors || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) throw new Error("网页引用无效");
  const value = await execute(contents, { op: "read", ids });
  if (!value || typeof value !== "object" || !("anchors" in value) || !Array.isArray(value.anchors) || value.anchors.length !== ids.length) throw new Error("网页引用无效");
  const unavailable: Record<string, true> = { missing: true, detached: true, changed: true, "not-visible": true, offscreen: true };
  const anchors = value.anchors.map((item: unknown, index: number): PageAnchorState => {
    if (!item || typeof item !== "object" || !("anchorId" in item) || item.anchorId !== ids[index]) throw new Error("网页引用无效");
    const rect = readRect("rect" in item ? item.rect : undefined);
    if ("unavailable" in item) {
      if (rect || typeof item.unavailable !== "string" || !Object.hasOwn(unavailable, item.unavailable)) throw new Error("网页引用无效");
      return { anchorId: ids[index]!, unavailable: item.unavailable };
    }
    if (!rect) throw new Error("网页引用位置无效");
    return { anchorId: ids[index]!, rect };
  });
  if ("clicked" in value && (typeof value.clicked !== "string" || !ids.includes(value.clicked))) throw new Error("网页评论标记无效");
  return { anchors, ...("clicked" in value ? { clicked: value.clicked as string } : {}) };
}

export async function clearPageAnchors(contents: WebContents): Promise<void> {
  await execute(contents, { op: "clear" });
}

function readRegionSelection(value: unknown, requestId: string): PageRegionSelection {
  if (!value || typeof value !== "object") throw new Error("网页区域无效");
  const selection = value as Partial<PageRegionSelection>;
  const rect = readRect(selection.rect);
  const viewport = selection.viewport;
  if (selection.requestId !== requestId || !rect || !Number.isSafeInteger(selection.captureRevision) ||
    selection.captureRevision! < 1 || !viewport || ![
      viewport.width, viewport.height, viewport.scrollX, viewport.scrollY, viewport.visualScale,
      viewport.visualOffsetX, viewport.visualOffsetY,
    ].every(number => typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= 10_000_000) ||
    viewport.width <= 0 || viewport.height <= 0 || viewport.visualScale !== 1 ||
    viewport.visualOffsetX !== 0 || viewport.visualOffsetY !== 0 ||
    rect.width < 4 || rect.height < 4 || rect.x + rect.width > viewport.width || rect.y + rect.height > viewport.height)
    throw new Error("网页区域无效，请重新框选");
  return { requestId, rect, viewport: { ...viewport }, captureRevision: selection.captureRevision! };
}

const regionPicks = new WeakMap<WebContents, { cancel(): void }>();

/** 同一 WebContents 的请求互斥；取消只撤销自己的 runtime 事务。 */
export function beginRegionPick(contents: WebContents, anchorId: string, requestId: string): {
  result: Promise<PageRegionSelection | null>; cancel(): void;
} {
  regionPicks.get(contents)?.cancel();
  if (!validId(anchorId) || !validId(requestId)) throw new Error("网页区域请求无效");
  const { promise: result, resolve, reject } = Promise.withResolvers<PageRegionSelection | null>();
  let settled = false;
  const cancel = () => {
    if (!settled) { settled = true; clearTimeout(deadline); resolve(null); }
    if (regionPicks.get(contents) !== transaction) return;
    regionPicks.delete(contents);
    if (!contents.isDestroyed()) void execute(contents, { op: "cancel-region", requestId }).catch(() => {});
  };
  const transaction = { cancel };
  regionPicks.set(contents, transaction);
  const deadline = setTimeout(cancel, 60_000);
  void Promise.resolve().then(() => {
    if (settled) return null;
    contents.focus();
    return execute(contents, { op: "pick-region", anchorId, requestId });
  }).then(value => {
    if (settled) return;
    const selection = value === null ? null : readRegionSelection(value, requestId);
    settled = true; clearTimeout(deadline); resolve(selection);
  }).catch((error: unknown) => {
    if (!settled) { settled = true; clearTimeout(deadline); reject(error); }
    cancel();
  });
  return { result, cancel };
}

/** 两帧隐藏可信绘制层后，返回再次确认过的 CSS viewport。 */
export async function prepareRegionCapture(contents: WebContents, selection: PageRegionSelection): Promise<PageRegionSelection> {
  readRegionSelection(selection, selection.requestId);
  const value = await execute(contents, { op: "prepare-region-capture", requestId: selection.requestId, captureRevision: selection.captureRevision });
  const prepared = readRegionSelection(value, selection.requestId);
  if (JSON.stringify(prepared) !== JSON.stringify(selection)) throw new Error("页面已变化，请重新框选");
  return prepared;
}

/** 最终复核并恢复该事务的层；迟到的旧请求绝不恢复新 picker。 */
export async function finishRegionCapture(contents: WebContents, selection: PageRegionSelection, discard = false): Promise<boolean> {
  return await execute(contents, { op: "finish-region-capture", requestId: selection.requestId, captureRevision: selection.captureRevision, discard }) === true;
}

/** 同文档 URL 变化仅失效区域引用，不改变原有 Range/Element。 */
export async function invalidatePageRegions(contents: WebContents): Promise<void> {
  regionPicks.get(contents)?.cancel();
  await execute(contents, { op: "invalidate-regions" });
}
