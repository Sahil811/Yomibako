import { browser, readExtFile } from '../util.js';

/**
 * A central cache for parsed CSS stylesheets.
 * By using adoptedStyleSheets, the browser only parses the CSS once in memory,
 * and we can instantly apply it to an infinite number of Shadow Roots with zero overhead.
 */
const StyleSheetCache = new Map();

/**
 * Abstract Base Class for all shadow-DOM UI components in the extension.
 * Eliminates boilerplate attachShadow and automatically applies global/themes CSS.
 */
export class ShadowComponent {
  /**
   * @param {HTMLElement} element The host template/element to inject shadow DOM into
   * @param {string[]} styleUrls Array of absolute/relative paths to CSS files (e.g. ['/themes.css', '/content/popup.css'])
   */
  constructor(element, styleUrls = []) {
    this.element = element;
    this.shadow = element.attachShadow({ mode: 'closed' });
    this._styleUrls = styleUrls;
    
    // Fetch and adopt stylesheets; expose promise so consumers can await readiness
    this.stylesReady = this._injectStyles();
  }

  async _injectStyles() {
    const sheets = [];

    for (const urlPath of this._styleUrls) {
      const fullUrl = browser.runtime.getURL(urlPath);
      
      if (!StyleSheetCache.has(fullUrl)) {
        try {
          const cssText = await readExtFile(urlPath);
          
          // Create a constructable stylesheet
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(cssText);
          
          StyleSheetCache.set(fullUrl, sheet);
        } catch (error) {
          console.error(`Failed to load stylesheet: ${fullUrl}`, error);
          continue;
        }
      }
      sheets.push(StyleSheetCache.get(fullUrl));
    }

    // Attempt to adopt them natively (Supported in all modern Chrome/Firefox versions)
    if (this.shadow.adoptedStyleSheets !== undefined) {
      this.shadow.adoptedStyleSheets = [...this.shadow.adoptedStyleSheets, ...sheets];
    } else {
      // Fallback for extremely old browsers: manually inject <style> tags
      for (const sheet of sheets) {
        const style = document.createElement('style');
        style.textContent = Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
        this.shadow.appendChild(style);
      }
    }
  }

  /**
   * Helper to append children to the shadow root
   */
  append(...nodes) {
    this.shadow.append(...nodes);
  }
}
