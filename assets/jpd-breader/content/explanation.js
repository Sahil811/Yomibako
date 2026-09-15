import { jsxCreateElement } from '../jsx.js';
import { config } from './background_comms.js';
import { ShadowComponent } from './shadowbase.js';

export class ExplanationPopup extends ShadowComponent {
  constructor() {
    const hostElement = jsxCreateElement("div", {
      id: "jpdb-explanation-popup",
      style: `all:initial; z-index:2147483647; position:fixed; top:0; left:0; width:100vw; height:100vh; opacity:0; visibility:hidden; transition:opacity 0.2s ease, visibility 0.2s ease; overscroll-behavior:none;`,
    });
    
    super(hostElement, ["/themes.css", "/content/popup.css"]);

    // Close modal when clicking the dark backdrop
    this.element.addEventListener("click", (e) => {
      // With Shadow DOM, e.target is the host element when clicking the backdrop
      if (e.target === this.element) this.hide();
    });

    // Add loading spinner and popup styles
    const styles = jsxCreateElement(
      "style",
      null,
      `
      :host {
        display: block;
      }
      
      .overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        backdrop-filter: blur(6px);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      article::-webkit-scrollbar {
        width: 8px;
      }
      article::-webkit-scrollbar-track {
        background: transparent;
      }
      article::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.15);
        border-radius: 10px;
      }
      article::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .loader {
        width: 44px;
        height: 44px;
        border: 3px solid rgba(135, 206, 250, 0.15);
        border-top-color: lightskyblue;
        border-radius: 50%;
        display: inline-block;
        box-sizing: border-box;
        animation: spin 1s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite;
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
      }

      @keyframes spin {
        0% { transform: translate(-50%, -50%) rotate(0deg); }
        100% { transform: translate(-50%, -50%) rotate(360deg); }
      }

      .loading {
        min-height: 250px;
        position: relative;
        width: 100%;
      }

      .explanation-content {
        font-family: inherit;
        line-height: 1.7;
        padding: 2.5em 2.5em 3em 2.5em;
        background: transparent;
        color: #e0e0e0;
        text-align: left;
        font-size: 1.08em;
        letter-spacing: 0.01em;
      }
      
      .explanation-content h1, 
      .explanation-content h2, 
      .explanation-content h3, 
      .explanation-content h4 {
        margin: 1.4em 0 0.6em 0;
        color: #ffffff;
        line-height: 1.3;
      }
      
      .explanation-content h3 { 
        font-size: 1.35em; 
        border-bottom: 1px solid rgba(255, 255, 255, 0.08); 
        padding-bottom: 0.4em; 
        margin-top: 1.8em;
      }
      
      .explanation-content h4 { 
        font-size: 1.15em; 
        color: lightskyblue; 
      }
      
      .explanation-content p {
        margin: 0 0 1.4em 0;
      }
      
      .explanation-content hr {
        border: none;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        margin: 1.8em 0;
      }
      
      .explanation-content ul, .explanation-content ol {
        margin: 0.5em 0 1.4em 1.5em;
        padding: 0;
      }
      
      .explanation-content li { 
        margin-bottom: 0.5em; 
      }
      
      .explanation-content strong { 
        font-weight: 600; 
        color: #fff;
        background: rgba(135, 206, 250, 0.15);
        padding: 0.1em 0.3em;
        border-radius: 4px;
      }
      
      .explanation-content em {
        color: #b0b0b0;
      }

      .premium-quote {
        margin: 1.5em 0 1.5em 0.5em;
        padding: 1em 1.5em;
        border-left: 4px solid lightskyblue;
        background: rgba(135, 206, 250, 0.06);
        border-radius: 0 8px 8px 0;
        font-style: italic;
        color: #d0d0d0;
      }

      .close-btn {
        position: absolute;
        top: 16px;
        right: 16px;
        width: 32px;
        height: 32px;
        border: none;
        background: rgba(255,255,255,0.05);
        color: #a0a0a0;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        z-index: 10;
        font-size: 14px;
      }
      .close-btn:hover {
        background: rgba(255,255,255,0.15);
        color: #fff;
        transform: scale(1.05);
      }
    `
    );

    const closeBtn = jsxCreateElement("button", {
      class: "close-btn",
      onclick: () => this.hide()
    }, "✕");

    const modalArticle = jsxCreateElement(
      "article",
      {
        id: "explanation-article",
        style: `width: 90vw; max-width: 680px; height: auto; max-height: 85vh; overflow-y: auto; background: linear-gradient(145deg, var(--color-background) 0%, rgba(20,20,20,0.98) 100%); border: 1px solid rgba(255,255,255,0.08); border-top: 1px solid rgba(255,255,255,0.18); border-radius: 16px; box-shadow: 0 25px 65px rgba(0,0,0,0.8); overscroll-behavior: contain; position: relative; transform: scale(0.96) translateY(10px); opacity: 0; transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);`,
      },
      closeBtn,
      (this.content = jsxCreateElement("div", {
        class: "explanation-content",
      }))
    );
    this.article = modalArticle;

    const overlay = jsxCreateElement("div", { class: "overlay" }, modalArticle);
    
    // Also allow clicking the overlay div inside shadow to close
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.hide();
    });

    this.shadow.append(
      styles,
      overlay
    );

    // Stop events from escaping the overlay
    this.element.addEventListener("wheel", (e) => {
      e.stopPropagation();
    }, { passive: false });

    this.element.addEventListener("touchmove", (e) => {
      e.stopPropagation();
    }, { passive: false });

    // Explicit scroll locking for the article to stop manual scroll chaining
    modalArticle.addEventListener("wheel", (e) => {
      e.stopPropagation();
      const el = e.currentTarget;
      const isUp = e.deltaY < 0;
      const isDown = e.deltaY > 0;
      const isAtTop = el.scrollTop <= 0;
      const isAtBottom = el.scrollHeight - Math.ceil(el.scrollTop) <= el.clientHeight;

      if ((isUp && isAtTop) || (isDown && isAtBottom)) {
        e.preventDefault();
      }
    }, { passive: false });
  }

  showLoading() {
    this.content.replaceChildren(
      jsxCreateElement(
        "div",
        { class: "loading" },
        jsxCreateElement("span", { class: "loader" })
      )
    );
    this.element.style.opacity = "1";
    this.element.style.visibility = "visible";
    if (this.article) {
       this.article.style.transform = "scale(1) translateY(0)";
       this.article.style.opacity = "1";
    }
  }

  sanitizeHTML(html) {
    const ALLOWED_TAGS = new Set([
      'b', 'i', 'em', 'strong', 'br', 'p', 'ul', 'ol', 'li',
      'code', 'pre', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'hr',
    ]);
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const walk = (node) => {
      const children = [...node.childNodes];
      for (const child of children) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          if (!ALLOWED_TAGS.has(child.tagName.toLowerCase())) {
            child.remove();
            continue;
          }
          const attrs = [...child.attributes];
          for (const attr of attrs) {
            if (attr.name.startsWith('on')) {
              child.removeAttribute(attr.name);
              continue;
            }
            if (child.tagName.toLowerCase() === 'a') {
              if (attr.name !== 'href') {
                child.removeAttribute(attr.name);
              } else {
                // Validate href protocol — only http/https, block javascript:/data:
                try {
                  const url = new URL(attr.value, window.location.href);
                  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                    child.removeAttribute(attr.name);
                  }
                } catch {
                  child.removeAttribute(attr.name);
                }
              }
            } else {
              // Non-anchor: strip all attributes (prevent style/class injection)
              child.removeAttribute(attr.name);
            }
          }
          walk(child);
        }
      }
    };
    walk(temp);
    return temp.innerHTML;
  }

  formatExplanation(text) {
    let parsed = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^#{4}\s+(.*)$/gm, '<h4>$1</h4>')
      .replace(/^#{3}\s+(.*)$/gm, '<h3>$1</h3>')
      .replace(/^#{2}\s+(.*)$/gm, '<h2>$1</h2>')
      .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>')
      .replace(/^---$/gm, '<hr>');

    const blocks = parsed.split(/\n\s*\n/);
    let htmlBlocks = blocks.map(block => {
      block = block.trim();
      if (!block) return '';
      
      // Blockquotes
      if (block.match(/^>\s+/)) {
          return `<div class="premium-quote">${block.replace(/^>\s+/gm, '').replace(/\n/g, '<br>')}</div>`;
      }
      
      // Pass through structures we explicitly created
      if (block.startsWith('<h') || block.startsWith('<hr')) return block;
      
      // Unordered Lists
      if (block.match(/^[\-\*]\s+/)) {
          return "<ul>" + block.split('\n').filter(l => l.trim()).map(l => `<li>${l.replace(/^[\-\*]\s+/, '')}</li>`).join('') + "</ul>";
      }
      
      // Ordered lists
      if (block.match(/^\d+\.\s+/)) {
          return "<ol>" + block.split('\n').filter(l => l.trim()).map(l => `<li>${l.replace(/^\d+\.\s+/, '')}</li>`).join('') + "</ol>";
      }
      
      // Standard paragraph. Preserve internal single line breaks.
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    });

    return htmlBlocks.join('\n');
  }

  show(explanation) {
    this.content.innerHTML = this.sanitizeHTML(this.formatExplanation(explanation));
    this.element.style.opacity = "1";
    this.element.style.visibility = "visible";
    if (this.article) {
       this.article.style.transform = "scale(1) translateY(0)";
       this.article.style.opacity = "1";
    }
  }

  hide() {
    this.element.style.opacity = "0";
    this.element.style.visibility = "hidden";
    if (this.article) {
       this.article.style.transform = "scale(0.96) translateY(10px)";
       this.article.style.opacity = "0";
    }
  }
}

document.addEventListener("click", (event) => {
  const explanationPopup = document.getElementById("jpdb-explanation-popup");
  const parentPopup = document.getElementById("jpdb-popup");

  if (event.target === parentPopup) {
    if (window.explanationPopup) window.explanationPopup.hide();
    return;
  }

  if (explanationPopup && !explanationPopup.contains(event.target)) {
    if (window.explanationPopup) window.explanationPopup.hide();
  }
});
