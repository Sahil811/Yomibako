import { jsxCreateElement } from "../jsx.js";
import { nonNull } from "../util.js";

export const PARTS_OF_SPEECH = {
  n: "Noun",
  pn: "Pronoun",
  pref: "Prefix",
  suf: "Suffix",
  name: "Name",
  "name-fem": "Name (Feminine)",
  "name-male": "Name (Masculine)",
  "name-surname": "Surname",
  "name-person": "Personal Name",
  "name-place": "Place Name",
  "name-company": "Company Name",
  "name-product": "Product Name",
  "adj-i": "Adjective",
  "adj-na": "na-Adjective",
  "adj-no": "no-Adjective",
  "adj-pn": "Adjectival",
  "adj-nari": "nari-Adjective (Archaic/Formal)",
  "adj-ku": "ku-Adjective (Archaic)",
  "adj-shiku": "shiku-Adjective (Archaic)",
  adv: "Adverb",
  aux: "Auxiliary",
  "aux-v": "Auxiliary Verb",
  "aux-adj": "Auxiliary Adjective",
  conj: "Conjunction",
  cop: "Copula",
  ctr: "Counter",
  exp: "Expression",
  int: "Interjection",
  num: "Numeric",
  prt: "Particle",
  vt: "Transitive Verb",
  vi: "Intransitive Verb",
  v1: "Ichidan Verb",
  "v1-s": "Ichidan Verb (Irregular)",
  v5: "Godan Verb",
  v5u: "u Godan Verb",
  "v5u-s": "u Godan Verb (Irregular)",
  v5k: "ku Godan Verb",
  "v5k-s": "ku/iku Godan Verb (Irregular)",
  v5g: "gu Godan Verb",
  v5s: "su Godan Verb",
  v5t: "tsu Godan Verb",
  v5n: "nu Godan Verb",
  v5b: "bu Godan Verb",
  v5m: "mu Godan Verb",
  v5r: "ru Godan Verb",
  "v5r-i": "ru Godan Verb (Irregular)",
  v5aru: "aru Godan Verb (Irregular)",
  vk: "Irregular Verb (kuru)",
  vs: "suru Verb",
  vz: "zuru Verb",
  "vs-c": "Verb (Archaic)",
  v2: "Nidan Verb (Archaic)",
  v4: "Yodan Verb (Archaic)",
  v4k: "",
  v4g: "",
  v4s: "",
  v4t: "",
  v4h: "",
  v4b: "",
  v4m: "",
  v4r: "",
  va: "Archaic",
};

export function renderPitch(reading, pitch) {
  if (reading.length !== pitch.length - 1) {
    return jsxCreateElement("span", null, "Error: invalid pitch");
  }

  try {
    const parts = [];
    let lastBorder = 0;
    const borders = Array.from(
      pitch.matchAll(/L(?=H)|H(?=L)/g),
      (x) => nonNull(x.index) + 1,
    );
    let low = pitch[0] === "L";

    for (const border of borders) {
      parts.push(
        jsxCreateElement(
          "span",
          { class: low ? "low" : "high" },
          reading.slice(lastBorder, border),
        ),
      );
      lastBorder = border;
      low = !low;
    }

    if (lastBorder !== reading.length) {
      parts.push(
        jsxCreateElement(
          "span",
          { class: low ? "low-final" : "high-final" },
          reading.slice(lastBorder),
        ),
      );
    }

    return jsxCreateElement("span", { class: "pitch" }, parts);
  } catch (error) {
    console.error(error);
    return jsxCreateElement("span", null, "Error: invalid pitch");
  }
}

export function groupMeanings(card) {
  const groupedMeanings = [];
  let lastPOS = [];

  for (const [index, meaning] of card.meanings.entries()) {
    const samePartOfSpeech =
      meaning.partOfSpeech.length === lastPOS.length &&
      meaning.partOfSpeech.every((part, i) => part === lastPOS[i]);

    if (samePartOfSpeech) {
      groupedMeanings[groupedMeanings.length - 1].glosses.push(meaning.glosses);
      continue;
    }

    groupedMeanings.push({
      partOfSpeech: meaning.partOfSpeech,
      glosses: [meaning.glosses],
      startIndex: index,
    });
    lastPOS = meaning.partOfSpeech;
  }

  return groupedMeanings;
}

function createKanjiBreakdown(characterDetails, kanjiComponents, kanjiUrl) {
  if (!characterDetails || !characterDetails.length) return "";

  // Deduplicate by kanji char (preserves order) — critical for long words like 朝鮮民主主義人民共和国
  const seen = new Set();
  const unique = [];
  for (const d of characterDetails) {
    if (!d || !d.kanji || !d.meanings) continue;
    if (seen.has(d.kanji)) continue;
    seen.add(d.kanji);
    unique.push(d);
  }
  if (!unique.length) return "";

  const chipRow = jsxCreateElement("div", { class: "kanji-chip-row" });
  const detailPanel = jsxCreateElement("div", { class: "kanji-detail" });
  const detailInner = jsxCreateElement("div", { class: "kanji-detail-inner" });
  detailPanel.append(detailInner);

  // Hidden by default
  detailPanel.style.maxHeight = "0";
  detailPanel.style.opacity = "0";

  function collapseDetail() {
    detailPanel.style.maxHeight = "0";
    detailPanel.style.opacity = "0";
    detailPanel.classList.remove("is-expanded");
    chipRow.querySelectorAll(".kanji-chip.is-active").forEach((c) => {
      c.classList.remove("is-active");
      c.setAttribute("aria-expanded", "false");
      const ar = c.querySelector(".kanji-chip-arrow");
      if (ar) ar.textContent = "▾";
    });
  }

  function createRtkNode(rtkText) {
    if (!rtkText) return null;
    const detailsEl = jsxCreateElement(
      "details",
      { class: "kanji-rtk" },
      jsxCreateElement(
        "summary",
        { class: "kanji-rtk-summary" },
        jsxCreateElement("span", { class: "kanji-rtk-icon", "aria-hidden": "true" }, "✦"),
        " Mnemonic",
        jsxCreateElement("span", { class: "kanji-rtk-chevron", "aria-hidden": "true" }, "▾"),
      ),
      jsxCreateElement(
        "div",
        { class: "kanji-rtk-body" },
        jsxCreateElement("p", { class: "kanji-rtk-text" }, rtkText),
      ),
    );
    detailsEl.addEventListener("toggle", () => {
      requestAnimationFrame(() => {
        if (detailPanel.classList.contains("is-expanded")) {
          detailPanel.style.maxHeight = detailPanel.scrollHeight + "px";
        }
      });
    });
    return detailsEl;
  }

  function expandDetailFor(details, chipEl) {
    const comps =
      details.components ||
      (kanjiComponents instanceof Map
        ? kanjiComponents.get(details.kanji) || []
        : []) ||
      [];

    // Build inner content
    if (!comps.length) {
      detailInner.replaceChildren(
        jsxCreateElement(
          "div",
          { class: "kanji-detail-header" },
          jsxCreateElement("span", { class: "kanji-detail-kanji" }, details.kanji),
          jsxCreateElement("span", { class: "kanji-detail-sep" }, "·"),
          jsxCreateElement("span", { class: "kanji-detail-mean" }, details.meanings),
          jsxCreateElement(
            "button",
            {
              class: "kanji-detail-close",
              "aria-label": "Close",
              onclick: (e) => {
                e.stopPropagation();
                collapseDetail();
              },
            },
            "×",
          ),
        ),
        jsxCreateElement("div", { class: "kanji-detail-empty" }, "No decomposition available"),
      );
    } else {
      detailInner.replaceChildren(
        jsxCreateElement(
          "div",
          { class: "kanji-detail-header" },
          jsxCreateElement("span", { class: "kanji-detail-kanji" }, details.kanji),
          jsxCreateElement("span", { class: "kanji-detail-sep" }, "·"),
          jsxCreateElement("span", { class: "kanji-detail-mean" }, details.meanings),
          jsxCreateElement(
            "button",
            {
              class: "kanji-detail-close",
              "aria-label": "Close",
              onclick: (e) => {
                e.stopPropagation();
                collapseDetail();
              },
            },
            "×",
          ),
        ),
        jsxCreateElement(
          "div",
          { class: "kanji-detail-grid" },
          comps.map(({ component, meaning }) =>
            jsxCreateElement(
              "div",
              { class: "component-card" },
              jsxCreateElement(
                "a",
                {
                  lang: "ja",
                  href: kanjiUrl(component),
                  target: "_blank",
                  class: "component-card-char",
                  title: meaning ? `${component}: ${meaning}` : component,
                  onclick: (e) => e.stopPropagation(),
                },
                component,
              ),
              jsxCreateElement(
                "span",
                { class: "component-card-mean" },
                meaning || "—",
              ),
            ),
          ),
        ),
      );
    }

    // RTK mnemonic — Google-level progressive disclosure: collapsed <details>, only if showRtk enabled (details.rtk exists)
    if (details.rtk) {
      const rtkNode = createRtkNode(details.rtk);
      if (rtkNode) detailInner.append(rtkNode);
    }

    detailPanel.classList.add("is-expanded");
    // Measure after paint for smooth height transition
    requestAnimationFrame(() => {
      // Need scrollHeight of inner; use panel's scrollHeight
      const h = detailPanel.scrollHeight;
      detailPanel.style.maxHeight = h + "px";
      detailPanel.style.opacity = "1";
    });
  }

  for (const details of unique) {
    const comps =
      details.components ||
      (kanjiComponents instanceof Map
        ? kanjiComponents.get(details.kanji) || []
        : []) ||
      [];
    const hasComps = comps.length > 0;

    const chip = jsxCreateElement(
      "div",
      {
        class: hasComps ? "kanji-chip kanji-chip--interactive" : "kanji-chip",
        role: hasComps ? "button" : undefined,
        tabindex: hasComps ? "0" : undefined,
        "aria-expanded": "false",
        "data-kanji": details.kanji,
        title: hasComps ? `Tap to see components of ${details.kanji}` : details.meanings,
        onclick: hasComps
          ? (e) => {
              if (e.target.closest("a")) return;
              const isActive = chip.classList.contains("is-active");
              // deactivate others
              chipRow.querySelectorAll(".kanji-chip.is-active").forEach((c) => {
                if (c !== chip) {
                  c.classList.remove("is-active");
                  c.setAttribute("aria-expanded", "false");
                  const ar = c.querySelector(".kanji-chip-arrow");
                  if (ar) ar.textContent = "▾";
                }
              });
              if (isActive) {
                collapseDetail();
                return;
              }
              // activate this
              chip.classList.add("is-active");
              chip.setAttribute("aria-expanded", "true");
              const ar = chip.querySelector(".kanji-chip-arrow");
              if (ar) ar.textContent = "▴";
              expandDetailFor(details, chip);
            }
          : undefined,
        onkeydown: hasComps
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                chip.click();
              }
            }
          : undefined,
      },
      jsxCreateElement(
        "a",
        {
          lang: "ja",
          href: kanjiUrl(details.kanji),
          target: "_blank",
          class: "kanji-chip-kanji",
          onclick: (e) => e.stopPropagation(),
        },
        details.kanji,
      ),
      jsxCreateElement("span", { class: "kanji-chip-colon" }, ":"),
      jsxCreateElement("span", { class: "kanji-chip-mean" }, details.meanings),
      hasComps
        ? jsxCreateElement("span", { class: "kanji-chip-arrow", "aria-hidden": "true" }, "▾")
        : null,
    );

    chipRow.append(chip);
  }

  // Optional header with count for many kanji (Google-style subtle section title)
  const header = unique.length > 3
    ? jsxCreateElement(
        "div",
        { class: "kanji-breakdown-header" },
        jsxCreateElement("span", null, "Kanji"),
        jsxCreateElement("span", { class: "kanji-breakdown-count" }, `${unique.length}`),
      )
    : null;

  return jsxCreateElement(
    "div",
    { class: "kanji-breakdown" },
    header,
    chipRow,
    detailPanel,
  );
}

export function createWordDetailsContent({
  card,
  characterDetails,
  kanjiComponents,
  onPlayAudio,
  onExplainWord,
}) {
  const url = `https://jpdb.io/vocabulary/${card.vid}/${encodeURIComponent(card.spelling)}/${encodeURIComponent(card.reading)}`;
  const kanjiUrl = (kanji) =>
    `https://jpdb.io/kanji/${encodeURIComponent(kanji)}`;
  const groupedMeanings = groupMeanings(card);

  return [
    jsxCreateElement(
      "div",
      { id: "header" },
      jsxCreateElement(
        "div",
        { class: "header-main-info" },
        jsxCreateElement(
          "a",
          { lang: "ja", href: url, target: "_blank", class: "word-link" },
          jsxCreateElement("span", { class: "spelling" }, card.spelling),
          card.spelling !== card.reading && card.pitchAccent.length === 0
            ? jsxCreateElement("span", { class: "reading" }, `(${card.reading})`)
            : null,
        ),
        jsxCreateElement(
          "div",
          { class: "metainfo" },
          jsxCreateElement(
            "span",
            { class: "freq" },
            card.frequencyRank ? `Top ${card.frequencyRank}` : "",
          ),
          card.pitchAccent.map((pitch) => renderPitch(card.reading, pitch)),
        ),
      ),
      jsxCreateElement(
        "div",
        { class: "header-actions" },
        jsxCreateElement(
          "div",
          { class: "state" },
          card.state.map((state) =>
            jsxCreateElement("span", { class: state }, state),
          ),
        ),
        jsxCreateElement(
          "div",
          { class: "utility-icons" },
          jsxCreateElement(
            "button",
            {
              class: "util-btn audio-btn",
              title: "Play pronunciation (A)",
              "aria-label": "Play pronunciation",
              onclick: (event) => {
                event.preventDefault();
                event.stopPropagation();
                onPlayAudio();
              },
            },
            jsxCreateElement("span", { "aria-hidden": "true", style: "font-size:15px;line-height:1;" }, "♪"),
          ),
          jsxCreateElement(
            "button",
            {
              class: "util-btn",
              title: "Explain word (AI)",
              "aria-label": "Explain word",
              onclick: (event) => {
                event.preventDefault();
                event.stopPropagation();
                onExplainWord();
              },
            },
            jsxCreateElement("span", { "aria-hidden": "true", style: "font-size:12px;font-weight:800;line-height:1;" }, "AI"),
          ),
        ),
      ),
    ),
    createKanjiBreakdown(characterDetails, kanjiComponents, kanjiUrl),
    ...groupedMeanings.flatMap((meanings) => [
      jsxCreateElement(
        "h2",
        null,
        meanings.partOfSpeech
          .map(
            (pos) =>
              PARTS_OF_SPEECH[pos] ??
              `(Unknown part of speech #${pos}, please report)`,
          )
          .filter((value) => value.length > 0)
          .join(", "),
      ),
      jsxCreateElement(
        "ol",
        { start: meanings.startIndex + 1 },
        meanings.glosses.map((glosses) =>
          jsxCreateElement("li", null, glosses.join("; ")),
        ),
      ),
    ]),
  ];
}
