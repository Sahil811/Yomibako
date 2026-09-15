(async () => {
  "use strict";

  const $browser = globalThis.browser ?? globalThis.chrome;
  const $import = (path) => import($browser.runtime.getURL(path));
  const { browser } = await $import("/util.js");
  const { paragraphsInNode, parseParagraphs } = await $import(
    "/integrations/common.js"
  );
  const { requestParse } = await $import("/content/background_comms.js");
  const { showError } = await $import("/content/toast.js");

  // --- Constants and Helpers ---
  const SPECIFIC_SITES = [
    "ankiuser.net",
    "ankiweb.net",
    "jpdb.io",
    "mokuro/visual_novel",
  ];
  const isAsbSubtitlesAdded = [
    "miruro.tv/watch",
    "*hianime.to/watch*",
    "youtube.com/watch",
    "animesugetv.to/watch",
    "netflix",
    "anime",
    "youglish.com",
  ];
  const DEBOUNCE_DELAY = 250;
  const PARSE_TIMEOUT = 5000;

  // Subtitle class selectors
  const SUBTITLE_SELECTORS =
    ".asbplayer-subtitles, .asbplayer-fullscreen-subtitles";

  const isSpecificSite = () =>
    SPECIFIC_SITES.some((site) => window.location.href.includes(site));

  const isSubtitleSite = () =>
    isAsbSubtitlesAdded.some((site) => window.location.href.includes(site));

  const debounce = (func, delay) => {
    let debounceTimer;
    return (...args) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => func(...args), delay);
    };
  };

  // --- Parsing Logic ---
  const handleParsing = async () => {
    try {
      const paragraphs = paragraphsInNode(document.body);
      if (paragraphs.length === 0) return;

      const uniqueParagraphs = [...new Set(paragraphs)];
      const [batches, applied] = parseParagraphs(uniqueParagraphs);

      const parseBatch = async () => {
        requestParse(batches);
        await Promise.allSettled(applied);
      };

      await Promise.race([
        parseBatch(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Parsing timeout")), PARSE_TIMEOUT)
        ),
      ]);
    } catch (error) {
      showError(error);
    }
  };

  const parseElement = async (element) => {
    try {
      if (!element || !element.textContent.trim()) return;

      const paragraphs = paragraphsInNode(element);
      if (paragraphs.length === 0) return;

      // Store current text to compare changes
      const currentText = element.textContent.trim();
      if (element.dataset.lastParsedText === currentText) return;

      const uniqueParagraphs = [...new Set(paragraphs)];
      const [batches, applied] = parseParagraphs(uniqueParagraphs);

      requestParse(batches);
      await Promise.allSettled(applied);

      // Update the last parsed text
      element.dataset.lastParsedText = currentText;
    } catch (error) {
      showError(error);
    }
  };

  const debouncedParse = debounce(handleParsing, DEBOUNCE_DELAY);

  // --- Subtitle Observer Setup ---
  const setupSubtitleObserver = () => {
    const observedElements = new WeakSet();

    const perpetualObserver = new MutationObserver(() => {
      document
        .querySelectorAll(SUBTITLE_SELECTORS)
        .forEach((subtitlesElement) => {
          if (!observedElements.has(subtitlesElement)) {
            observedElements.add(subtitlesElement);

            const textObserver = new MutationObserver((mutations) => {
              const currentText = subtitlesElement.textContent.trim();
              if (
                currentText &&
                currentText !== subtitlesElement.dataset.lastParsedText
              ) {
                parseElement(subtitlesElement);
              }
            });

            textObserver.observe(subtitlesElement, {
              characterData: true,
              childList: true,
              subtree: true,
            });

            // Initial parse
            if (subtitlesElement.textContent.trim()) {
              parseElement(subtitlesElement);
            }
          }
        });
    });

    perpetualObserver.observe(document, {
      childList: true,
      subtree: true,
    });
  };

  // --- Event Handling ---
  if (isSubtitleSite()) {
    setupSubtitleObserver();
  }

  if (!isSpecificSite()) {
    debouncedParse();
  } else {
    setTimeout(debouncedParse, 1000);

    const eventHandler = () => debouncedParse();

    document.body.addEventListener("click", eventHandler, { passive: true });
    document.body.addEventListener("touchstart", eventHandler, {
      passive: true,
    });
  }
})();
