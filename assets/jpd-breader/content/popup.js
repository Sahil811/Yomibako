import { ImmersionKit } from './immersionkit.js';
import { ExplanationPopup } from './explanation.js';
import { JpdbAudio as PopupJpdbAudio } from './popup_audio.js';
import { loadPopupSupplementalData } from './popup_resources.js';
import { ShadowComponent } from './shadowbase.js';
import { browser, clamp } from "../util.js";
import { createWordDetailsContent } from './popup_word_view.js';
import { jsxCreateElement } from "../jsx.js";
import {
  config,
  requestMine,
  requestFetchAudioBytes,
  requestFetchAudioHash,
  requestReview,
  requestSetFlag,
} from "./background_comms.js";
import { Dialog } from "./dialog.js";
import { getSentences } from "./word.js";
import {
  geminiApi,
  showRequestErrorToast,
} from "../integrations/api.js";
function getClosestClientRect(elem, x, y) {
  const rects = elem.getClientRects();
  if (rects.length === 1) return rects[0];
  // Merge client rects that are adjacent
  // This works around a Chrome issue, where sometimes, non-deterministically,
  // inline child elements will get separate client rects, even if they are on the same line.
  const { writingMode } = getComputedStyle(elem);
  const horizontal = writingMode.startsWith("horizontal");
  const mergedRects = [];
  for (const rect of rects) {
    if (mergedRects.length === 0) {
      mergedRects.push(rect);
      continue;
    }
    const prevRect = mergedRects[mergedRects.length - 1];
    if (horizontal) {
      if (rect.bottom === prevRect.bottom && rect.left === prevRect.right) {
        mergedRects[mergedRects.length - 1] = new DOMRect(
          prevRect.x,
          prevRect.y,
          rect.right - prevRect.left,
          prevRect.height
        );
      } else {
        mergedRects.push(rect);
      }
    } else {
      if (rect.right === prevRect.right && rect.top === prevRect.bottom) {
        mergedRects[mergedRects.length - 1] = new DOMRect(
          prevRect.x,
          prevRect.y,
          prevRect.width,
          rect.bottom - prevRect.top
        );
      } else {
        mergedRects.push(rect);
      }
    }
  }
  return mergedRects
    .map((rect) => ({
      rect,
      distance:
        Math.max(rect.left - x, 0, x - rect.right) ** 2 +
        Math.max(rect.top - y, 0, y - rect.bottom) ** 2,
    }))
    .reduce((a, b) => (a.distance <= b.distance ? a : b)).rect;
}
export class Popup extends ShadowComponent {
  #demoMode;
  #element;
  #customStyle;
  #outerStyle;
  #vocabSection;
  #mineButtons;
  #data;
  #renderVersion = 0;
  #explanationRequestId = 0;
  #configOverride = null;
  static #popup;
  static get() {
    if (!this.#popup) {
      this.#popup = new this();
      document.body.append(this.#popup.element);
    }
    return this.#popup;
  }
  static exists() {
    return !!this.#popup;
  }
  static getDemoMode(parent) {
    const popup = new this(true);
    parent.append(popup.element);
    return popup;
  }
  get #cfg() {
    return this.#configOverride ?? config;
  }
    constructor(demoMode = false) {
    const hostElement = jsxCreateElement("div", {
      id: "jpdb-popup",
      role: "dialog",
      "aria-label": "Word details",
      onmousedown: (event) => {
        event.stopPropagation();
      },
      onclick: (event) => {
        event.stopPropagation();
      },
      onwheel: (event) => {
        event.stopPropagation();
      },
      ontouchstart: (event) => {
        // Don't prevent default here to allow scrolling inside popup
        event.stopPropagation();
      },
      ontouchmove: (event) => {
        // Check if we're scrolling inside the popup
        let target = event.target;
        let scrollableParentFound = false;

        // Look for scrollable parent elements
        while (target && target !== this.#element) {
          const style = window.getComputedStyle(target);
          const isScrollable =
            (target.scrollHeight > target.clientHeight &&
              (style.overflowY === "auto" || style.overflowY === "scroll")) ||
            (target.scrollWidth > target.clientWidth &&
              (style.overflowX === "auto" || style.overflowX === "scroll"));

          if (isScrollable) {
            scrollableParentFound = true;
            break;
          }
          target = target.parentElement;
        }

        // If we're inside the popup, allow scrolling
        if (target && (target === this.#element || scrollableParentFound)) {
          event.stopPropagation();
          return;
        }

        // Prevent background page scroll
        event.preventDefault();
        event.stopPropagation();
      },
      ontouchend: (event) => {
        event.stopPropagation();
      },
      style: `all:initial;z-index:2147483647;${
        demoMode
          ? ""
          : "position:absolute;top:0;left:0;opacity:0;visibility:hidden;"
      };`,
    });
    super(hostElement, ["/themes.css", "/content/popup.css"]);
    this.#demoMode = demoMode;
    this.#element = hostElement;
    this.shadow.append(
      (this.#customStyle = jsxCreateElement("style", null)),
      jsxCreateElement(
        "article",
        { lang: "ja" },
        (this.#mineButtons = jsxCreateElement("section", {
          id: "mine-buttons",
        })),
        jsxCreateElement(
          "section",
          { id: "review-buttons" },
          // SRS review buttons
          jsxCreateElement(
            "button",
            {
              class: "nothing",
              tabindex: "0",
              "aria-label": "Review: Nothing (1)",
              onclick: demoMode ? undefined : async (e) => { const btn = e.currentTarget; btn.disabled = true; try { await requestReview(this.#data.token.card, "nothing"); } finally { btn.disabled = false; } },
            },
            "Nothing",
          ),
          jsxCreateElement(
            "button",
            {
              class: "something",
              tabindex: "0",
              "aria-label": "Review: Something (2)",
              onclick: demoMode ? undefined : async (e) => { const btn = e.currentTarget; btn.disabled = true; try { await requestReview(this.#data.token.card, "something"); } finally { btn.disabled = false; } },
            },
            "Something",
          ),
          jsxCreateElement(
            "button",
            {
              class: "hard",
              tabindex: "0",
              "aria-label": "Review: Hard (3)",
              onclick: demoMode ? undefined : async (e) => { const btn = e.currentTarget; btn.disabled = true; try { await requestReview(this.#data.token.card, "hard"); } finally { btn.disabled = false; } },
            },
            "Hard",
          ),
          jsxCreateElement(
            "button",
            {
              class: "good",
              tabindex: "0",
              "aria-label": "Review: Good (4)",
              onclick: demoMode ? undefined : async (e) => { const btn = e.currentTarget; btn.disabled = true; try { await requestReview(this.#data.token.card, "good"); } finally { btn.disabled = false; } },
            },
            "Good",
          ),
          jsxCreateElement(
            "button",
            {
              class: "easy",
              tabindex: "0",
              "aria-label": "Review: Easy (5)",
              onclick: demoMode ? undefined : async (e) => { const btn = e.currentTarget; btn.disabled = true; try { await requestReview(this.#data.token.card, "easy"); } finally { btn.disabled = false; } },
            },
            "Easy",
          )
        ),
        (this.#vocabSection = jsxCreateElement("section", {
          id: "vocab-content",
        }))
      )
    );
    this.#outerStyle = this.#element.style;
    this.immersionKit = new ImmersionKit(this.#vocabSection);

    // Apply initial style/scale/theme as soon as the popup is created.
    // Without this, --popup-scale is only set when the user changes settings,
    // so the real popup (not the demo) would never pick up the saved scale.
    this.updateStyle();

    // Close popup on Escape key; number keys 1-5 activate review buttons — scoped + focus trap
    if (!demoMode) {
      const reviewRatings = ['nothing', 'something', 'hard', 'good', 'easy'];
      document.addEventListener('keydown', (event) => {
        if (!this.isVisible()) return;
        // Ignore typing in inputs/textareas outside popup (allow Escape to close even there)
        const active = document.activeElement;
        const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable || active.tagName === 'SELECT');
        const activeInPopup = active && (this.element.contains(active) || this.shadow.contains(active));
        if (isTyping && !activeInPopup && event.key !== 'Escape') return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;

        if (event.key === 'Escape') {
          event.preventDefault();
          this.fadeOut();
          return;
        }
        // Focus trap for Tab — only when focus is inside popup
        if (event.key === 'Tab') {
          if (!activeInPopup) return;
          const focusable = [...this.shadow.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled);
          if (!focusable.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          const current = this.shadow.activeElement || document.activeElement;
          if (!event.shiftKey && current === last) {
            event.preventDefault();
            first.focus();
          } else if (event.shiftKey && current === first) {
            event.preventDefault();
            last.focus();
          }
          return;
        }
        const num = parseInt(event.key);
        if (num >= 1 && num <= 5 && this.#data) {
          event.preventDefault();
          requestReview(this.#data.token.card, reviewRatings[num - 1]);
        }
      });
    }
  }

  // Add debouncer property
  #pendingExampleLoad = null;

  async toggleImmersionKit() {
    const currentWord = this.#data.token.card.spelling;

    // Toggle off: hide examples if already showing for this word
    const existing = this.#vocabSection.querySelector(".immersion-example");
    if (existing && this.immersionKit.lastWord === currentWord) {
      existing.remove();
      return;
    }

    // Remove stale examples from a previous word
    this.#vocabSection.querySelectorAll(".immersion-example")
      .forEach((el) => el.remove());

    // Stop any playing audio using the refactored helper
    this.immersionKit._stopCurrent();
    this.immersionKit.isPlayingAll = false;
    this.immersionKit.isLoopingAudio = false;

    // Fetch only if this is a new word
    if (this.immersionKit.lastWord !== currentWord) {
      this.immersionKit.examples = [];
      this.immersionKit.currentIndex = 0;
      this.immersionKit.currentWord = null;
      const result = await this.immersionKit.fetchExamples(currentWord);
      if (result?.stale) return;
      if (!result?.found) {
        if (result?.error) {
          await showRequestErrorToast(result.error, {
            message: "ImmersionKit is currently unavailable. Please try again.",
            timeout: 3500,
          });
        } else {
          const { showToast } = await import(browser.runtime.getURL("/content/toast.js"));
          showToast("Info", "No examples found for this word.", { timeout: 3000 });
        }
        return;
      }
      this.immersionKit.lastWord = currentWord;
    }

    const example = this.immersionKit.renderExample();
    if (example) {
      this.#vocabSection.appendChild(example);
      if (this.immersionKit.examples[0]?.sound_url) {
        await this.immersionKit.playAudio(this.immersionKit.examples[0].sound_url);
      }
    }
  }

  fadeIn() {
    // Necessary because in settings page, config is undefined
    // TODO is this still true? ~hmry(2023-08-08)
    if (config && !config.disableFadeAnimation) {
      this.#outerStyle.transition = "opacity 60ms ease-in, visibility 60ms";
    }
    this.#outerStyle.opacity = "1";
    this.#outerStyle.visibility = "visible";
  }
  isVisible() {
    return this.#outerStyle.visibility === 'visible';
  }
  fadeOut() {
    // Stop immersion kit audio if it's currently looping or playing sequences
    if (this.immersionKit) {
      this.immersionKit._stopCurrent();
      this.immersionKit.isPlayingAll = false;
      this.immersionKit.isLoopingAudio = false;
    }

    // Necessary because in settings page, config is undefined
    // TODO is this still true? ~hmry(2023-08-08)
    if (config && !config.disableFadeAnimation) {
      this.#outerStyle.transition = "opacity 200ms ease-in, visibility 200ms";
    }
    this.#outerStyle.opacity = "0";
    this.#outerStyle.visibility = "hidden";
  }
  disablePointer() {
    this.#outerStyle.pointerEvents = "none";
    this.#outerStyle.userSelect = "none";
  }
  enablePointer() {
    this.#outerStyle.pointerEvents = "";
    this.#outerStyle.userSelect = "";
  }
   async render(renderVersion = this.#renderVersion) {
    if (this.#data === undefined) return;
    const data = this.#data;
    const card = data.token.card;
    const c = this.#cfg;
    let popupCharacterDetails = null;
    let popupKanjiComponents = null;
    try {
      const result = await loadPopupSupplementalData(card, {
        showKanji: c?.showKanji,
        showRtk: c?.showRtk,
      });
      popupCharacterDetails = result.characterDetails;
      popupKanjiComponents = result.kanjiComponents;
    } catch (e) {
      console.warn('JPDBreader: failed to load supplemental data', e);
    }
    if (renderVersion !== this.#renderVersion || this.#data !== data) return;

    this.#vocabSection.replaceChildren(
      ...createWordDetailsContent({
        card,
        characterDetails: popupCharacterDetails,
        kanjiComponents: popupKanjiComponents,
        onPlayAudio: () => PopupJpdbAudio.speak(card.vid, card.spelling),
        onExplainWord: () => this.explainWord(card.spelling, card.meanings),
      })
    );

    const popupBlacklisted = card.state.includes("blacklisted");
    const popupNeverForget = card.state.includes("never-forget");
    const minimal = c?.minimalMineButtons === true;

    const allButtons = [];
    if (!minimal) {
      allButtons.push(
        jsxCreateElement(
          "button",
          {
            class: "add",
            onclick: this.#demoMode
              ? undefined
              : async (e) => {
                  const btn = e.currentTarget;
                  btn.disabled = true;
                  const originalText = btn.textContent;
                  btn.textContent = "Adding...";
                  try {
                    await requestMine(
                      data.token.card,
                      config.forqOnMine,
                      getSentences(data, config.contextWidth).trim() || undefined,
                      undefined
                    );
                  } finally {
                    btn.disabled = false;
                    btn.textContent = originalText;
                  }
                },
          },
          "Add"
        ),
        jsxCreateElement(
          "button",
          {
            class: "edit-add-review",
            onclick: this.#demoMode ? undefined : () => Dialog.get().showForWord(data),
          },
          "Edit, Add and Review..."
        ),
        jsxCreateElement(
          "button",
          {
            class: "blacklist",
            onclick: this.#demoMode
              ? undefined
              : async (e) => {
                  const btn = e.currentTarget;
                  btn.disabled = true;
                  try {
                    await requestSetFlag(
                      this.#data.token.card,
                      "blacklist",
                      !popupBlacklisted
                    );
                  } finally {
                    btn.disabled = false;
                  }
                },
          },
          !popupBlacklisted ? "Blacklist" : "Unblacklist"
        )
      );
    }
    allButtons.push(
      jsxCreateElement(
        "button",
        {
          class: "never-forget",
          onclick: this.#demoMode
            ? undefined
            : async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try {
                  await requestSetFlag(
                    this.#data.token.card,
                    "never-forget",
                    !popupNeverForget
                  );
                } finally {
                  btn.disabled = false;
                }
              },
        },
        !popupNeverForget ? "Never forget" : "Unmark"
      ),
      jsxCreateElement(
        "button",
        {
          class: "show-examples",
          onclick: this.#demoMode ? undefined : async () => await this.toggleImmersionKit(),
        },
        "Examples"
      )
    );

    this.#mineButtons.className = minimal ? 'minimal' : '';
    this.#mineButtons.id = 'mine-buttons';
    this.#mineButtons.replaceChildren(...allButtons);

    // Toggle review buttons visibility based on config
    this.#updateReviewButtonsVisibility();
  }
   setData(data) {
    this.#data = data;
    // P0: Skeleton shimmer prevents layout shift vs "Loading…" text
    const skeleton = jsxCreateElement("div", { class: "skeleton-wrap", style: "padding:0.92em;display:flex;flex-direction:column;gap:0.6em;min-width:280px;" },
      jsxCreateElement("div", { style: "height:1.6em;width:42%;background:var(--c-hover);border-radius:6px;animation:skeleton-pulse 1.2s ease-in-out infinite;" }),
      jsxCreateElement("div", { style: "height:0.9em;width:68%;background:var(--c-hover);border-radius:6px;animation:skeleton-pulse 1.2s ease-in-out infinite 0.15s;" }),
      jsxCreateElement("div", { style: "height:0.9em;width:88%;background:var(--c-hover);border-radius:6px;animation:skeleton-pulse 1.2s ease-in-out infinite 0.3s;" }),
      jsxCreateElement("div", { style: "height:0.9em;width:76%;background:var(--c-hover);border-radius:6px;animation:skeleton-pulse 1.2s ease-in-out infinite 0.45s;" }),
    );
    this.#vocabSection.replaceChildren(skeleton);
    this.#mineButtons.replaceChildren();
    const renderVersion = ++this.#renderVersion;
    void this.render(renderVersion);
  }
  containsMouse(event) {
    const targetElement = event.target;
    if (targetElement) {
      return this.#element.contains(targetElement);
    }
    return false;
  }
  async showExamplesAutomatically() {
    // Cancel any pending loads
    if (this.#pendingExampleLoad) {
      clearTimeout(this.#pendingExampleLoad);
    }

    // Cancel any pending requests
    if (this.immersionKit) {
      this.immersionKit.cancelCurrentRequest();
    }

    if (config.showExamplesAutomatically) {
      // Debounce the example loading by 300ms
      this.#pendingExampleLoad = setTimeout(async () => {
        // Remove any existing examples before loading new ones
        const existingExamples =
          this.#vocabSection.querySelectorAll(".immersion-example");
        existingExamples.forEach((example) => example.remove());

        await this.toggleImmersionKit();
      }, 300);
    }
  }

  async showForWord(word, mouseX = 0, mouseY = 0) {
    const data = word.jpdbData;
    // P1: Dedup — hovering different char of same word (same vid/sid) shouldn't re-render skeleton / re-fetch kanji
    const isSameWord = this.#data
      && this.#data.token.card.vid === data.token.card.vid
      && this.#data.token.card.sid === data.token.card.sid;
    if (isSameWord && this.isVisible()) {
      // Just reposition without re-processing — keep current card, avoid flicker
      await this.stylesReady;
      await new Promise(r => requestAnimationFrame(r));
      const bbox = getClosestClientRect(word, mouseX, mouseY);
      const wordLeft = window.scrollX + bbox.left;
      const wordTop = window.scrollY + bbox.top;
      const wordRight = window.scrollX + bbox.right;
      const wordBottom = window.scrollY + bbox.bottom;
      const leftSpace = bbox.left;
      const topSpace = bbox.top;
      const rightSpace = window.innerWidth - bbox.right;
      const bottomSpace = window.innerHeight - bbox.bottom;
      const popupHeight = this.#element.offsetHeight;
      const popupWidth = this.#element.offsetWidth;
      const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
      const minLeft = window.scrollX;
      const maxLeft = window.scrollX + window.innerWidth - popupWidth - scrollbarW;
      const minTop = window.scrollY;
      const maxTop = window.scrollY + window.innerHeight - popupHeight;
      const _wmCache2 = Popup._wmCache ?? (Popup._wmCache = new WeakMap());
      let writingMode2 = _wmCache2.get(word);
      if (!writingMode2) { writingMode2 = getComputedStyle(word).writingMode; _wmCache2.set(word, writingMode2); }
      const gap = 8;
      let popupLeft, popupTop;
      if (writingMode2.startsWith("horizontal")) {
        popupTop = clamp(bottomSpace > topSpace ? wordBottom + gap : wordTop - popupHeight - gap, minTop, maxTop);
        popupLeft = clamp(rightSpace > leftSpace ? wordLeft : wordRight - popupWidth, minLeft, maxLeft);
      } else {
        popupTop = clamp(bottomSpace > topSpace ? wordTop : wordBottom - popupHeight, minTop, maxTop);
        popupLeft = clamp(rightSpace > leftSpace ? wordRight + gap : wordLeft - popupWidth - gap, minLeft, maxLeft);
      }
      this.#outerStyle.transform = `translate(${popupLeft}px,${popupTop}px)`;
      return;
    }
    this.setData(data); // Because we need the dimensions of the popup with the new data
    // Ensure stylesheets are loaded before measuring dimensions
    await this.stylesReady;
    await new Promise(r => requestAnimationFrame(r));
    const bbox = getClosestClientRect(word, mouseX, mouseY);
    const wordLeft = window.scrollX + bbox.left;
    const wordTop = window.scrollY + bbox.top;
    const wordRight = window.scrollX + bbox.right;
    const wordBottom = window.scrollY + bbox.bottom;
    // window.innerWidth/Height technically contains the scrollbar, so it's not 100% accurate
    // Good enough for this though
    const leftSpace = bbox.left;
    const topSpace = bbox.top;
    const rightSpace = window.innerWidth - bbox.right;
    const bottomSpace = window.innerHeight - bbox.bottom;
    const popupHeight = this.#element.offsetHeight;
    const popupWidth = this.#element.offsetWidth;
    // P0: Account for scrollbar width (was window.innerWidth includes scrollbar)
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    const minLeft = window.scrollX;
    const maxLeft = window.scrollX + window.innerWidth - popupWidth - scrollbarW;
    const minTop = window.scrollY;
    const maxTop = window.scrollY + window.innerHeight - popupHeight;
    let popupLeft;
    let popupTop;
    // P0: Cache writingMode per element (getComputedStyle forces reflow)
    const _wmCache = Popup._wmCache ?? (Popup._wmCache = new WeakMap());
    let writingMode = _wmCache.get(word);
    if (!writingMode) { writingMode = getComputedStyle(word).writingMode; _wmCache.set(word, writingMode); }
    const gap = 8; // Spacing to prevent obscuring the word

    if (writingMode.startsWith("horizontal")) {
      popupTop = clamp(
        bottomSpace > topSpace ? wordBottom + gap : wordTop - popupHeight - gap,
        minTop,
        maxTop
      );
      popupLeft = clamp(
        rightSpace > leftSpace ? wordLeft : wordRight - popupWidth,
        minLeft,
        maxLeft
      );
    } else {
      popupTop = clamp(
        bottomSpace > topSpace ? wordTop : wordBottom - popupHeight,
        minTop,
        maxTop
      );
      popupLeft = clamp(
        rightSpace > leftSpace ? wordRight + gap : wordLeft - popupWidth - gap,
        minLeft,
        maxLeft
      );
    }
    this.#outerStyle.transform = `translate(${popupLeft}px,${popupTop}px)`;
    this.fadeIn();
    this.showExamplesAutomatically();
  }
  updateStyle(newCSS, theme, cfgOverride) {
    if (cfgOverride) this.#configOverride = cfgOverride;
    const c = this.#cfg;

    // Inject scale directly into the shadow DOM style element.
    // CSS variables set on the outer host don't reliably cascade in here,
    // so we write the zoom rule into #customStyle which lives inside the shadow root.
    const scale = ((c?.popupScale ?? 100) / 100).toFixed(4);
    const zoomCSS = `article { zoom: ${scale}; }\n`;
    this.#customStyle.textContent = zoomCSS + (newCSS ?? c?.customPopupCSS ?? '');

    // Apply theme to popup host element
    const t = theme ?? c?.theme;
    if (t && t !== 'auto') {
      this.#element.setAttribute('data-theme', t);
    } else {
      this.#element.removeAttribute('data-theme');
    }
    // Update review buttons visibility
    this.#updateReviewButtonsVisibility();
  }

  #updateReviewButtonsVisibility() {
    const reviewSection = this.shadow.querySelector('#review-buttons');
    if (reviewSection) {
      reviewSection.style.display = this.#cfg?.showReviewButtons === false ? 'none' : '';
    }
  }

  async explainWord(word, meanings) {
    if (!config.geminiApiKey) {
      const { showToast } = await import(browser.runtime.getURL("/content/toast.js"));
      showToast("Info", "Please set your Gemini API key in the extension settings first.", {
        timeout: 3500,
      });
      return;
    }

    if (!window.explanationPopup) {
      window.explanationPopup = new ExplanationPopup();
      document.body.append(window.explanationPopup.element);
    }

    // Show loading state
    window.explanationPopup.showLoading();
    const requestId = ++this.#explanationRequestId;

    const definition = meanings
      .map((meaning) => meaning.glosses.join("; "))
      .join("; ");
    const prompt = `You are an expert teacher and communicator. Explain why the Japanese word ${word} is defined as "${definition}" so a complete beginner can genuinely understand it, not just read it.

Provide an etymological breakdown of its individual kanji components and how these meanings logically combine to form the overall definition.

Write in natural flowing, deeply engaging, and *visually scannable* paragraphs. Keep the tone conversational, clear, and thoughtful. Break up the formatting cleanly with bullet points, bold emphasis, and short paragraphs so it isn't an exhausting wall of text. Never sound robotic or academic.

Apply these principles naturally where they fit:
- Start from the most basic truth and build upward.
- Break the idea into small logical parts.
- Connect unfamiliar ideas to familiar ones (analogies) or link to what a beginner likely knows.
- Make the main point clear early, then support it.
- Keep it simple without losing accuracy.
- Never use technical linguistic jargon without immediately explaining it in plain language.
- Make each idea flow naturally into the next.
- Prioritize clarity and understanding over sounding impressive.

End with one short sentence that captures the core meaning plainly.`;

    try {
      const explanation = await geminiApi.explainWord({
        apiKey: config.geminiApiKey,
        prompt,
      });
      if (requestId !== this.#explanationRequestId) return;
      window.explanationPopup.show(explanation);
    } catch (error) {
      if (requestId !== this.#explanationRequestId) return;
      console.error("Error fetching explanation:", error);
      
      let errorMessage = "Failed to get explanation. Please check your API key and try again.";
      if (error?.status === 429) {
        errorMessage = "Rate limit exceeded. Please wait a few minutes before trying again.";
      } else if (error?.status === 401 || error?.status === 403) {
        errorMessage = "Invalid API key. Please check your Gemini API key in settings.";
      }
      
      await showRequestErrorToast(error, {
        message: errorMessage,
      });
      window.explanationPopup.hide();
    }
  }
}

