import { jsxCreateElement } from "../jsx.js";
import { immersionKitApi, isAbortError } from "../integrations/api.js";

export class ImmersionKit {
  constructor(vocabSection) {
    this.examples = [];
    this.currentIndex = 0;
    this.isExpanded = false;
    this.lastWord = null;
    this.vocabSection = vocabSection;
    this.isPlayingAll = false;
    this.currentAudio = null;
    this.currentController = null;
    this.currentRequestId = 0;
    this.currentWord = null;
    this.lastPlayId = 0;
    this.isLoopingAudio = false;
    this.deckTitleMap = null;
  }

  cancelCurrentRequest() {
    this.currentRequestId += 1;
    if (this.currentController) {
      this.currentController.abort();
      this.currentController = null;
    }
  }

  _isCurrentRequest(requestId) {
    return requestId === this.currentRequestId;
  }

  async _ensureMetadata(signal) {
    if (this.deckTitleMap) return this.deckTitleMap;

    try {
      const json = await immersionKitApi.fetchMetadata(signal);
      this.deckTitleMap = json?.data || {};
    } catch (error) {
      if (isAbortError(error)) throw error;
      this.deckTitleMap = {};
    }

    return this.deckTitleMap;
  }

  _mapExamples(rawExamples) {
    const linodeBaseUrl = "https://us-southeast-1.linodeobjects.com/immersionkit/media/";

    return rawExamples.map((example) => {
      const slug = example.title || "";
      const prettyTitle = this.deckTitleMap?.[slug]?.title || slug;
      const mediaType = example.id ? example.id.split("_")[0] : "";
      const basePath = example.image && mediaType && prettyTitle ? `${linodeBaseUrl}${mediaType}/${prettyTitle}/media/` : "";

      return {
        ...example,
        image_url: example.image && basePath ? `${basePath}${example.image}` : "",
        sound_url: example.sound && basePath ? `${basePath}${example.sound}` : "",
      };
    });
  }

  async tryFetchWithAbort(word, signal, requestId) {
    if (signal.aborted || !this._isCurrentRequest(requestId)) {
      return { found: false, stale: true };
    }

    await this._ensureMetadata(signal);

    const data = await immersionKitApi.search(word, signal);
    if (signal.aborted || !this._isCurrentRequest(requestId)) {
      return { found: false, stale: true };
    }

    const rawExamples = data?.examples || [];
    if (rawExamples.length === 0) {
      return { found: false };
    }

    this.examples = this._mapExamples(rawExamples);
    this.currentIndex = 0;
    return { found: true };
  }

  async fetchExamples(word) {
    this.cancelCurrentRequest();

    const controller = new AbortController();
    this.currentController = controller;
    const requestId = ++this.currentRequestId;
    this.currentWord = word;

    try {
      const primaryResult = await this.tryFetchWithAbort(word, controller.signal, requestId);
      if (primaryResult.found || primaryResult.stale) return primaryResult;

      const particles = ["を", "に", "が", "へ", "と", "で"];
      for (const particle of particles) {
        if (!word.includes(particle)) continue;

        const [before, after] = word.split(particle);
        for (const candidate of [before, after].filter(Boolean)) {
          const result = await this.tryFetchWithAbort(candidate, controller.signal, requestId);
          if (result.found || result.stale) return result;
        }
      }

      return { found: false };
    } catch (error) {
      if (isAbortError(error)) {
        return { found: false, stale: true };
      }

      return { found: false, error };
    } finally {
      if (this.currentController === controller) {
        this.currentController = null;
      }
    }
  }

  async _createBufferSource(url) {
    const arrayBuffer = await immersionKitApi.fetchMedia(url);
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    return source;
  }

  _stopCurrent() {
    if (this.currentAudio) {
      try {
        this.currentAudio.stop();
      } catch (e) { console.warn('JPDBreader: ImmersionKit audio error', e); }
      this.currentAudio = null;
    }
  }

  async playAudio(url) {
    if (!url) return;

    const playId = ++this.lastPlayId;
    this._stopCurrent();

    try {
      if (this.audioContext && this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      const source = await this._createBufferSource(url);
      if (playId !== this.lastPlayId) return;

      this.currentAudio = source;
      source.onended = () => {
        if (this.currentAudio === source) this.currentAudio = null;
        if (this.isLoopingAudio) {
          setTimeout(() => {
            if (this.isLoopingAudio && playId === this.lastPlayId) {
              this.playAudio(url);
            }
          }, 150);
        }
      };
      source.start();
    } catch (e) { console.warn('JPDBreader: ImmersionKit audio error', e); }
  }

  async playAudioPromise(url) {
    if (!url) return;

    const playId = ++this.lastPlayId;
    this._stopCurrent();

    try {
      const source = await this._createBufferSource(url);
      if (playId !== this.lastPlayId) return;

      return await new Promise((resolve) => {
        this.currentAudio = source;
        source.onended = () => {
          if (this.currentAudio === source) this.currentAudio = null;
          resolve();
        };
        source.start();
      });
    } catch (e) {
      console.warn('JPDBreader: ImmersionKit audio error', e);
      return Promise.resolve();
    }
  }

  navigate(direction) {
    this.currentIndex = (this.currentIndex + direction + this.examples.length) % this.examples.length;
    this.updateDisplay();
    const example = this.examples[this.currentIndex];
    if (example?.sound_url) {
      this.playAudio(example.sound_url);
    }
  }

  toggleLoop() {
    this.isLoopingAudio = !this.isLoopingAudio;
    if (this.isLoopingAudio) {
      this.isPlayingAll = false;
      const example = this.examples[this.currentIndex];
      if (example?.sound_url) {
        this.playAudio(example.sound_url);
      }
    } else {
      this._stopCurrent();
    }
    this.updateDisplay();
  }

  async playAllSequence() {
    if (!this.examples.length) return;

    this.isPlayingAll = true;
    this.isLoopingAudio = false;
    this.updateDisplay();

    while (this.isPlayingAll) {
      const example = this.examples[this.currentIndex];
      if (example?.sound_url) {
        await this.playAudioPromise(example.sound_url);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      await new Promise((resolve) => setTimeout(resolve, 400));
      if (!this.isPlayingAll) break;

      this.currentIndex += 1;
      if (this.currentIndex >= this.examples.length) {
        this.currentIndex = 0;
        this.isPlayingAll = false;
        break;
      }
      this.updateDisplay();
    }

    this.isPlayingAll = false;
    this.updateDisplay();
  }

  updateDisplay() {
    const example = this.examples[this.currentIndex];
    if (!example) return;

    const newExample = this.renderExample();
    if (!newExample) return;

    const container = this.vocabSection.querySelector(".immersion-example");
    if (container) {
      container.replaceWith(newExample);
    } else {
      this.vocabSection.appendChild(newExample);
    }
  }

  renderExample() {
    if (!this.examples.length) return null;

    const example = this.examples[this.currentIndex];
    if (!example) return null;

    return jsxCreateElement(
      "div",
      { class: "immersion-example" },
      jsxCreateElement(
        "div",
        { class: "example-content" },
        jsxCreateElement(
          "div",
          {
            class: "example-nav",
            style: "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;",
          },
          jsxCreateElement(
            "button",
            {
              class: "ik-btn",
              onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.navigate(-1);
              },
            },
            "◀"
          ),
          jsxCreateElement("span", { class: "example-counter" }, `${this.currentIndex + 1}/${this.examples.length}`),
          jsxCreateElement(
            "button",
            {
              class: "ik-btn",
              onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.navigate(1);
              },
            },
            "▶"
          ),
          jsxCreateElement(
            "button",
            {
              class: `ik-btn ${this.isLoopingAudio ? "is-active" : ""}`,
              style: "margin-left: auto; cursor: pointer;",
              title: "Loop current audio",
              onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleLoop();
              },
            },
            "🔁"
          ),
          jsxCreateElement(
            "button",
            {
              class: `ik-btn ${this.isPlayingAll ? "is-active" : ""}`,
              style: "cursor: pointer;",
              title: "Play all examples",
              onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.isPlayingAll) {
                  this.isPlayingAll = false;
                } else {
                  this.playAllSequence();
                }
              },
            },
            this.isPlayingAll ? "Stop" : "Play All"
          )
        ),
        jsxCreateElement(
          "div",
          { class: "image-container" },
          example.image_url &&
            jsxCreateElement("img", {
              src: example.image_url,
              alt: "Example image",
              class: "example-image",
              onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.playAudio(example.sound_url);
              },
            }),
          jsxCreateElement("div", { class: "image-gradient-overlay" }),
          jsxCreateElement(
            "button",
            {
              class: "ik-btn-overlay",
              onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.playAudio(example.sound_url);
              },
            },
            "🔊"
          )
        ),
        jsxCreateElement("div", { class: "example-sentence" }, example.sentence),
        jsxCreateElement("div", { class: "example-translation" }, example.translation)
      )
    );
  }
}
