(async () => {
    "use strict";
    const $browser = globalThis.browser ?? globalThis.chrome, $import = path => import($browser.runtime.getURL(path));
    const { showError } = await $import("/content/toast.js");
    const { addedObserver, parseVisibleObserver } = await $import("/integrations/common.js");
    try {
        const PRIMARY_SELECTOR = 'div.bp-quiz-question.relative';
        const FALLBACK_SELECTOR = '[class*="quiz-question"]';
        let selector = PRIMARY_SELECTOR;
        if (!document.querySelector(PRIMARY_SELECTOR) && document.querySelector(FALLBACK_SELECTOR)) {
            console.warn('JPDBreader: primary selector not found, using fallback');
            selector = FALLBACK_SELECTOR;
        }
        const visible = parseVisibleObserver();
        const added = addedObserver(selector, elements => {
            for (const element of elements) {
                const childDiv = element.querySelector('div.text-center');
                if (childDiv !== null && childDiv.children.length > 0) {
                    visible.observe(childDiv);
                }
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
