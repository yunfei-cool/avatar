type ImageParseType = 'holdings' | 'transactions';

interface TesseractRecognizeResult {
  data?: {
    text?: string;
  };
}

interface TesseractGlobal {
  recognize(
    image: string,
    langs?: string,
    options?: Record<string, unknown>
  ): Promise<TesseractRecognizeResult>;
}

declare global {
  interface Window {
    Tesseract?: TesseractGlobal;
  }
}

const DEFAULT_TESSERACT_SCRIPT_URLS = [
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js',
];
const TESSERACT_SCRIPT_URL = (import.meta.env.VITE_TESSERACT_SCRIPT_URL as string | undefined)?.trim();
const TESSERACT_WORKER_URL = (import.meta.env.VITE_TESSERACT_WORKER_URL as string | undefined)?.trim();
const TESSERACT_CORE_URL = (import.meta.env.VITE_TESSERACT_CORE_URL as string | undefined)?.trim();
const TESSERACT_LANG_URL = (import.meta.env.VITE_TESSERACT_LANG_URL as string | undefined)?.trim();
const TESSERACT_LANGS = (import.meta.env.VITE_OCR_LANGS as string | undefined)?.trim() || 'chi_sim+eng';

let tesseractLoadPromise: Promise<void> | null = null;

function getTesseractScriptCandidates(): string[] {
  const envCandidates = (import.meta.env.VITE_TESSERACT_SCRIPT_URLS as string | undefined)
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const combined = [
    ...(TESSERACT_SCRIPT_URL ? [TESSERACT_SCRIPT_URL] : []),
    ...(envCandidates || []),
    ...DEFAULT_TESSERACT_SCRIPT_URLS,
  ];

  return Array.from(new Set(combined));
}

function loadTesseractScript(): Promise<void> {
  if (window.Tesseract) {
    return Promise.resolve();
  }

  if (tesseractLoadPromise) {
    return tesseractLoadPromise;
  }

  tesseractLoadPromise = new Promise<void>((resolve, reject) => {
    const candidates = getTesseractScriptCandidates();

    const tryLoad = (index: number) => {
      if (index >= candidates.length) {
        reject(new Error('OCR 引擎脚本加载失败（所有 CDN 均不可用）'));
        return;
      }

      const src = candidates[index];
      const existing = Array.from(
        document.querySelectorAll<HTMLScriptElement>('script[data-ocr-engine="tesseract"]')
      ).find((script) => script.src === src);

      if (existing) {
        if (window.Tesseract) {
          resolve();
          return;
        }
        existing.addEventListener(
          'load',
          () => {
            if (window.Tesseract) {
              resolve();
            } else {
              tryLoad(index + 1);
            }
          },
          { once: true }
        );
        existing.addEventListener('error', () => tryLoad(index + 1), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.ocrEngine = 'tesseract';
      script.onload = () => {
        if (window.Tesseract) {
          resolve();
        } else {
          script.remove();
          tryLoad(index + 1);
        }
      };
      script.onerror = () => {
        script.remove();
        tryLoad(index + 1);
      };
      document.head.appendChild(script);
    };

    tryLoad(0);
  }).catch((error) => {
    tesseractLoadPromise = null;
    throw error;
  });

  if (!tesseractLoadPromise) {
    throw new Error('OCR 引擎加载状态异常');
  }

  return tesseractLoadPromise;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('OCR 图片加载失败'));
    image.src = dataUrl;
  });
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, value));
}

async function preprocessImageForOcr(imageDataUrl: string, type: ImageParseType): Promise<string> {
  const image = await loadImage(imageDataUrl);
  const maxSide = 2400;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('OCR 图像预处理失败');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const contrast = type === 'transactions' ? 1.48 : 1.42;
  const brightness = type === 'transactions' ? 8 : 12;
  const threshold = type === 'transactions' ? 150 : 145;

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const enhanced = clampColor((gray - 128) * contrast + 128 + brightness);
    const leveled = enhanced > threshold ? 255 : clampColor(enhanced * 0.7);
    data[i] = leveled;
    data[i + 1] = leveled;
    data[i + 2] = leveled;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

function scoreOcrText(text: string, type: ImageParseType): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  const lineCount = trimmed.split('\n').filter((line) => line.trim()).length;
  const chineseChars = (trimmed.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const numberTokens = (trimmed.match(/[-+]?\d[\d,]*(\.\d+)?/g) ?? []).length;
  const percentTokens = (trimmed.match(/[-+]?\d[\d,]*(\.\d+)?\s*%/g) ?? []).length;
  const keywordHit =
    type === 'holdings'
      ? (trimmed.match(/(持有|收益|基金|混合|指数|ETF|金额)/g) ?? []).length
      : (trimmed.match(/(买入|卖出|成交|委托|撤单|日期)/g) ?? []).length;

  return lineCount * 1.8 + chineseChars * 0.08 + numberTokens * 1.6 + percentTokens * 2 + keywordHit * 3;
}

function isOcrQualitySufficient(text: string, type: ImageParseType): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const score = scoreOcrText(trimmed, type);
  const lineCount = trimmed.split('\n').filter((line) => line.trim()).length;
  const minScore = type === 'holdings' ? 56 : 40;
  const minLines = type === 'holdings' ? 6 : 4;
  return score >= minScore && lineCount >= minLines;
}

export async function runIndependentOcr(imageBase64: string, type: ImageParseType): Promise<string> {
  await loadTesseractScript();

  if (!window.Tesseract) {
    throw new Error('OCR 引擎不可用');
  }

  const preprocessedImage = await preprocessImageForOcr(imageBase64, type);
  const options: Record<string, unknown> = {};
  if (TESSERACT_WORKER_URL) options.workerPath = TESSERACT_WORKER_URL;
  if (TESSERACT_CORE_URL) options.corePath = TESSERACT_CORE_URL;
  if (TESSERACT_LANG_URL) options.langPath = TESSERACT_LANG_URL;
  if (import.meta.env.DEV) {
    options.logger = () => {};
  }

  const processedResult = await window.Tesseract.recognize(preprocessedImage, TESSERACT_LANGS, options);
  const processedText = processedResult.data?.text?.trim() ?? '';
  let text = processedText;

  // 仅在预处理结果质量不足时，再跑原图 OCR 兜底，避免每张图都双倍耗时。
  if (!isOcrQualitySufficient(processedText, type)) {
    const originalResult = await window.Tesseract.recognize(imageBase64, TESSERACT_LANGS, options);
    const originalText = originalResult.data?.text?.trim() ?? '';
    text =
      scoreOcrText(processedText, type) >= scoreOcrText(originalText, type) ? processedText : originalText;
  }

  if (!text) {
    throw new Error('独立 OCR 未识别出文本');
  }

  return text;
}
