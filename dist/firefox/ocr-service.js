(function() {
  "use strict";

  var OCR_STATE = {};
  var tesseractWorker = null;
  var tesseractReady = false;
  var tesseractInitializing = false;

  var CONFIG = {
    provider: "tesseract",
    visionLlmEndpoint: "",
    visionLlmApiKey: "",
    visionLlmModel: "manga-ocr",
    fallbackEnabled: true,
    ocrLang: "jpn",
    tesseractLangs: {
      ja: "jpn",
      "zh-CN": "chi_sim",
      "zh-TW": "chi_tra",
      ko: "kor",
      en: "eng",
    },
  };

  function loadConfig() {
    try {
      if (
        typeof browser !== "undefined" &&
        browser.storage &&
        browser.storage.local
      ) {
        browser.storage.local.get("imt_ocr_config").then(function(result) {
          if (result.imt_ocr_config) {
            Object.assign(CONFIG, result.imt_ocr_config);
            console.log("[OCR-Service] Config loaded:", CONFIG.provider);
          }
        });
      }
    } catch (e) {}
  }

  function getTesseractLang(targetLang) {
    if (CONFIG.tesseractLangs[targetLang])
      return CONFIG.tesseractLangs[targetLang];
    for (var key in CONFIG.tesseractLangs) {
      if (targetLang.startsWith(key)) return CONFIG.tesseractLangs[key];
    }
    return "jpn";
  }

  function getExtensionUrl(path) {
    if (
      typeof browser !== "undefined" &&
      browser.runtime &&
      browser.runtime.getURL
    ) {
      return browser.runtime.getURL(path);
    }
    if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.getURL
    ) {
      return chrome.runtime.getURL(path);
    }
    return path;
  }

  async function initTesseract(lang) {
    if (tesseractReady && tesseractWorker) return tesseractWorker;
    if (tesseractInitializing) {
      while (tesseractInitializing) {
        await new Promise(function(r) {
          setTimeout(r, 100);
        });
      }
      return tesseractWorker;
    }

    tesseractInitializing = true;
    try {
      if (typeof Tesseract === "undefined") {
        console.error("[OCR-Service] Tesseract.js not loaded");
        throw new Error("Tesseract.js not loaded");
      }

      var workerPath = getExtensionUrl("tesseract/worker.min.js");
      var corePath = getExtensionUrl(
        "tesseract/tesseract-core-simd-lstm.wasm.js",
      );
      var langPath = getExtensionUrl("tesseract/lang-data");

      console.log("[OCR-Service] Initializing Tesseract with lang:", lang);
      tesseractWorker = await Tesseract.createWorker(lang, 1, {
        workerPath: workerPath,
        corePath: corePath,
        langPath: langPath,
        gzip: true,
      });

      tesseractReady = true;
      console.log("[OCR-Service] Tesseract initialized successfully");
      return tesseractWorker;
    } catch (e) {
      console.error("[OCR-Service] Tesseract init failed:", e);
      tesseractInitializing = false;
      throw e;
    } finally {
      tesseractInitializing = false;
    }
  }

  async function ocrWithTesseract(imageData, lang) {
    var worker = await initTesseract(lang);
    var result = await worker.recognize(imageData);
    return parseTesseractResult(result);
  }

  function parseTesseractResult(result) {
    var boxes = [];
    if (!result || !result.data) return boxes;

    var words = result.data.words || [];
    var lines = {};

    words.forEach(function(word) {
      if (!word.text || !word.text.trim()) return;
      var lineId = word.line ? word.line.baseline.y0 : word.bbox.y0;
      var key = Math.round(lineId / 10) * 10;
      if (!lines[key]) {
        lines[key] = {
          text: "",
          x0: Infinity,
          y0: Infinity,
          x1: -Infinity,
          y1: -Infinity,
        };
      }
      lines[key].text += (lines[key].text ? " " : "") + word.text;
      lines[key].x0 = Math.min(lines[key].x0, word.bbox.x0);
      lines[key].y0 = Math.min(lines[key].y0, word.bbox.y0);
      lines[key].x1 = Math.max(lines[key].x1, word.bbox.x1);
      lines[key].y1 = Math.max(lines[key].y1, word.bbox.y1);
    });

    Object.keys(lines).forEach(function(key) {
      var line = lines[key];
      if (line.text.trim()) {
        boxes.push({
          originalText: line.text.trim(),
          translatedText: "",
          x: line.x0,
          y: line.y0,
          width: line.x1 - line.x0,
          height: line.y1 - line.y0,
        });
      }
    });

    return boxes;
  }

  async function ocrWithVisionLlm(imageData, lang) {
    if (!CONFIG.visionLlmEndpoint) {
      throw new Error("Vision LLM endpoint not configured");
    }

    var base64;
    if (typeof imageData === "string" && imageData.startsWith("data:")) {
      base64 = imageData;
    } else if (imageData instanceof Blob) {
      base64 = await blobToBase64(imageData);
    } else if (
      imageData instanceof ArrayBuffer ||
      imageData instanceof Uint8Array
    ) {
      var blob = new Blob([imageData]);
      base64 = await blobToBase64(blob);
    } else {
      throw new Error("Unsupported image data type for vision LLM");
    }

    var langName = {
      jpn: "Japanese",
      chi_sim: "Simplified Chinese",
      chi_tra: "Traditional Chinese",
      kor: "Korean",
      eng: "English",
    } [lang] || "Japanese";

    var payload = {
      model: CONFIG.visionLlmModel,
      messages: [{
        role: "user",
        content: [{
            type: "text",
            text: "Extract all text from this manga/comic image. For each text bubble or region, output a JSON array of objects with fields: text (the extracted " +
              langName +
              " text), x, y, width, height (bounding box coordinates as percentages 0-100 of the image dimensions). Only output the JSON array, no other text.",
          },
          {
            type: "image_url",
            image_url: {
              url: base64
            },
          },
        ],
      }, ],
      max_tokens: 4096,
    };

    var headers = {
      "Content-Type": "application/json"
    };
    if (CONFIG.visionLlmApiKey) {
      headers["Authorization"] = "Bearer " + CONFIG.visionLlmApiKey;
    }

    var response = await fetch(CONFIG.visionLlmEndpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error("Vision LLM request failed: " + response.status);
    }

    var data = await response.json();
    var content =
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;
    if (!content) throw new Error("Vision LLM returned empty response");

    return parseVisionLlmResult(content, imageData);
  }

  function parseVisionLlmResult(content, imageData) {
    var jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    try {
      var items = JSON.parse(jsonMatch[0]);
      return items
        .map(function(item) {
          return {
            originalText: item.text || "",
            translatedText: "",
            x: item.x || 0,
            y: item.y || 0,
            width: item.width || 100,
            height: item.height || 20,
          };
        })
        .filter(function(item) {
          return item.originalText.trim();
        });
    } catch (e) {
      console.error("[OCR-Service] Failed to parse vision LLM response:", e);
      return [];
    }
  }

  function blobToBase64(blob) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onloadend = function() {
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function startOCR(urlHash, imageData, options) {
    options = options || {};
    var lang = options.lang || CONFIG.ocrLang;
    var provider = options.provider || CONFIG.provider;

    OCR_STATE[urlHash] = {
      state: "processing",
      result: null,
      error: null
    };

    try {
      var boxes;

      if (provider === "vision_llm") {
        try {
          boxes = await ocrWithVisionLlm(imageData, lang);
        } catch (e) {
          console.warn("[OCR-Service] Vision LLM failed:", e.message);
          if (CONFIG.fallbackEnabled) {
            console.log("[OCR-Service] Falling back to Tesseract");
            boxes = await ocrWithTesseract(imageData, lang);
          } else {
            throw e;
          }
        }
      } else {
        try {
          boxes = await ocrWithTesseract(imageData, lang);
        } catch (e) {
          console.warn("[OCR-Service] Tesseract failed:", e.message);
          if (CONFIG.fallbackEnabled && CONFIG.visionLlmEndpoint) {
            console.log("[OCR-Service] Falling back to Vision LLM");
            boxes = await ocrWithVisionLlm(imageData, lang);
          } else {
            throw e;
          }
        }
      }

      OCR_STATE[urlHash] = {
        state: "done",
        result: {
          boxesWithText: boxes
        },
        error: null,
      };
    } catch (e) {
      console.error("[OCR-Service] OCR failed for", urlHash, ":", e.message);
      OCR_STATE[urlHash] = {
        state: "error",
        result: null,
        errorMsg: e.message,
      };
    }
  }

  function queryOCR(urlHash) {
    return OCR_STATE[urlHash] || {
      state: "unknown",
      result: null
    };
  }

  function clearOCR(urlHash) {
    delete OCR_STATE[urlHash];
  }

  function updateConfig(newConfig) {
    Object.assign(CONFIG, newConfig);
    if (
      typeof browser !== "undefined" &&
      browser.storage &&
      browser.storage.local
    ) {
      browser.storage.local.set({
        imt_ocr_config: CONFIG
      });
    }
    console.log("[OCR-Service] Config updated:", CONFIG.provider);
    if (tesseractWorker && tesseractReady) {
      tesseractWorker.terminate();
      tesseractWorker = null;
      tesseractReady = false;
    }
  }

  function getConfig() {
    return Object.assign({}, CONFIG);
  }

  loadConfig();

  window.__IMT_OCR = {
    startOCR: startOCR,
    queryOCR: queryOCR,
    clearOCR: clearOCR,
    updateConfig: updateConfig,
    getConfig: getConfig,
    STATE: OCR_STATE,
  };

  console.log("[OCR-Service] Loaded. Provider:", CONFIG.provider);
})();
