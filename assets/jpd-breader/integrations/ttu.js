(async () => {
    "use strict";
    const $browser = globalThis.browser ?? globalThis.chrome, $import = path => import($browser.runtime.getURL(path));
    const { showError } = await $import("/content/toast.js");
    const { addedObserver, parseVisibleObserver } = await $import("/integrations/common.js");
    function shouldParse(node) {
        if (node instanceof HTMLElement) {
            return !node.matches(`[data-ttu-spoiler-img]`);
        }
        else {
            return true;
        }
    }
    try {
        const PRIMARY_SELECTOR = '.book-content p, .book-content div.calibre1';
        const FALLBACK_SELECTOR = '[class*="book"] p, [class*="book"] div';
        let selector = PRIMARY_SELECTOR;
        if (!document.querySelector(PRIMARY_SELECTOR) && document.querySelector(FALLBACK_SELECTOR)) {
            console.warn('JPDBreader: primary selector not found, using fallback');
            selector = FALLBACK_SELECTOR;
        }
        const visible = parseVisibleObserver(shouldParse);
        const added = addedObserver(selector, elements => {
            for (const element of elements) {
                visible.observe(element);
            }
        });
        added.observe(document.body, {
            subtree: true,
            childList: true,
        });
    }
    catch (error) {
        showError(error);
    }
})();
