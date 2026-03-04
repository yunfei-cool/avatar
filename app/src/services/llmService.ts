import type { TradeData, AnalysisReport } from '@/types';
import { runIndependentOcr } from '@/services/ocrService';

// ===== API Key Management =====
const SERVER_MANAGED_API_KEY_PLACEHOLDER = '__server_managed_deepseek_key__';
const FIXED_PROVIDER = 'deepseek' as const;

export type ApiProvider = 'gemini' | 'deepseek';

export function getStoredApiKey(): string | null {
  return SERVER_MANAGED_API_KEY_PLACEHOLDER;
}

export function setStoredApiKey(_key: string) {
  // noop: API Key is managed by backend only.
}

export function clearStoredApiKey() {
  // noop: API Key is managed by backend only.
}

export function getStoredProvider(): ApiProvider {
  return FIXED_PROVIDER;
}

export function setStoredProvider(_provider: ApiProvider) {
  // noop: provider is fixed to deepseek.
}

// ===== Gemini API Implementation =====

const DEFAULT_GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_MODEL = (import.meta.env.VITE_GEMINI_MODEL as string | undefined)?.trim() || DEFAULT_GEMINI_MODEL;
const GEMINI_DEFAULT_TIMEOUT_MS = 45000;
const GEMINI_IMAGE_TIMEOUT_MS = 90000;
const GEMINI_ANALYSIS_TIMEOUT_MS = 70000;
const GEMINI_DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const GEMINI_ANALYSIS_MAX_OUTPUT_TOKENS = 8192;
const GEMINI_DEFAULT_TEMPERATURE = 0.3;
const GEMINI_MAX_RETRIES = 2;
const DEFAULT_DEEPSEEK_PROXY_ENDPOINT = '/api/deepseek/chat/completions';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const DEEPSEEK_PROXY_ENDPOINT =
  ((import.meta.env.VITE_DEEPSEEK_PROXY_ENDPOINT as string | undefined) || DEFAULT_DEEPSEEK_PROXY_ENDPOINT)
    .trim();
const DEEPSEEK_MODEL = (import.meta.env.VITE_DEEPSEEK_MODEL as string | undefined)?.trim() || DEFAULT_DEEPSEEK_MODEL;
const DEEPSEEK_DEFAULT_TIMEOUT_MS = 45000;
const DEEPSEEK_DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEEPSEEK_ANALYSIS_MAX_OUTPUT_TOKENS = 4096;
const DEEPSEEK_MAX_RETRIES = 2;

function normalizeGeminiApiBase(base: string): string {
  const cleaned = base.trim().replace(/\/+$/, '');
  return cleaned.endsWith('/models') ? cleaned : `${cleaned}/models`;
}

const GEMINI_API_BASE = normalizeGeminiApiBase(
  (import.meta.env.VITE_GEMINI_API_BASE as string | undefined) || DEFAULT_GEMINI_API_BASE
);

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message: string;
    code: number;
  };
}

interface DeepSeekResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
    code?: string | number;
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLikelyNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('load failed')
  );
}

function toUserFriendlyErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return '请求超时，请稍后重试';
  }

  if (error instanceof Error && error.message.toLowerCase().includes('token')) {
    return '模型输出过长（达到 token 上限），请重试';
  }

  if (isLikelyNetworkError(error)) {
    return '网络请求失败（可能是 DNS、代理或网络切换问题），请检查网络后重试';
  }

  if (error instanceof SyntaxError) {
    return '模型返回了非标准 JSON 格式，请重试';
  }

  return error instanceof Error ? error.message : '未知错误';
}

function isJsonStructureError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('json') ||
    message.includes('结构不完整') ||
    message.includes('unexpected end') ||
    message.includes('unexpected token')
  );
}

function isTokenLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('token') ||
    message.includes('max_tokens') ||
    message.includes('达到 token 上限') ||
    message.includes('输出过长')
  );
}

async function fetchGeminiWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  for (let attempt = 1; attempt <= GEMINI_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (response.status >= 500 && attempt < GEMINI_MAX_RETRIES) {
        await delay(500 * attempt);
        continue;
      }

      return response;
    } catch (error) {
      const shouldRetry = attempt < GEMINI_MAX_RETRIES && isLikelyNetworkError(error);
      if (shouldRetry) {
        await delay(500 * attempt);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error('请求失败，请稍后重试');
}

function extractJsonObjectFromText(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const source = codeBlockMatch?.[1] ?? text;
  const firstBraceIndex = source.indexOf('{');

  if (firstBraceIndex === -1) {
    throw new Error('响应中未找到 JSON 对象');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = firstBraceIndex; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(firstBraceIndex, i + 1);
      }
    }
  }

  throw new Error('响应中的 JSON 结构不完整');
}

function extractJsonTailFromText(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const source = codeBlockMatch?.[1] ?? text;
  const firstBraceIndex = source.indexOf('{');
  if (firstBraceIndex === -1) {
    throw new Error('响应中未找到 JSON 对象');
  }
  return source.slice(firstBraceIndex).trim();
}

function repairPossiblyTruncatedJson(jsonTail: string): string {
  let input = jsonTail.trim();
  if (!input) {
    return input;
  }

  // Remove trailing markdown fence if model output is partially wrapped.
  input = input.replace(/```+$/g, '').trim();
  input = input.replace(/```(?:json)?/gi, '').trim();

  let output = '';
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    output += ch;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      stack.push('}');
      continue;
    }
    if (ch === '[') {
      stack.push(']');
      continue;
    }
    if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
  }

  if (inString) {
    if (output.endsWith('\\')) {
      output += ' ';
    }
    output += '"';
  }

  while (stack.length > 0) {
    output = output.replace(/,\s*$/, '');
    output += stack.pop();
  }

  output = output.replace(/,\s*([}\]])/g, '$1');
  return output;
}

function parseJsonObjectFromText(text: string): unknown {
  try {
    return JSON.parse(extractJsonObjectFromText(text));
  } catch (strictError) {
    try {
      const repaired = repairPossiblyTruncatedJson(extractJsonTailFromText(text));
      return JSON.parse(repaired);
    } catch (repairError) {
      const strictMessage = strictError instanceof Error ? strictError.message : '严格解析失败';
      const repairMessage = repairError instanceof Error ? repairError.message : '修复解析失败';
      throw new Error(`${strictMessage}；自动修复失败：${repairMessage}`);
    }
  }
}

interface GeminiCallOptions {
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  responseSchema?: Record<string, unknown>;
  responseMimeType?: 'application/json' | 'text/plain';
}

interface DeepSeekCallOptions {
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

async function callGeminiAPI(
  apiKey: string,
  prompt: string,
  imageBase64?: string,
  options: GeminiCallOptions = {}
): Promise<string> {
  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: prompt }
  ];
  
  if (imageBase64) {
    const mimeTypeMatch = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
    const mimeType = mimeTypeMatch?.[1] || 'image/jpeg';
    const base64Data = imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
    parts.push({
      inlineData: {
        mimeType,
        data: base64Data,
      },
    });
  }

  let response: Response;
  try {
    const timeoutMs = options.timeoutMs ?? (imageBase64 ? GEMINI_IMAGE_TIMEOUT_MS : GEMINI_DEFAULT_TIMEOUT_MS);
    const responseMimeType = options.responseMimeType ?? 'application/json';
    const generationConfig: Record<string, unknown> = {
      temperature: options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
      maxOutputTokens: options.maxOutputTokens ?? GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
      responseMimeType,
    };
    if (options.responseSchema && responseMimeType === 'application/json') {
      generationConfig.responseSchema = options.responseSchema;
    }

    response = await fetchGeminiWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
        {
          parts,
        },
      ],
      generationConfig,
      }),
    }, timeoutMs);
  } catch (error) {
    throw new Error(toUserFriendlyErrorMessage(error));
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
  }

  const data: GeminiResponse = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message);
  }

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) {
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new Error('模型输出过长（达到 token 上限），请重试');
    }
    throw new Error('No response from API');
  }

  return text;
}

async function fetchDeepSeekWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  for (let attempt = 1; attempt <= DEEPSEEK_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (response.status >= 500 && attempt < DEEPSEEK_MAX_RETRIES) {
        await delay(500 * attempt);
        continue;
      }

      return response;
    } catch (error) {
      const shouldRetry = attempt < DEEPSEEK_MAX_RETRIES && isLikelyNetworkError(error);
      if (shouldRetry) {
        await delay(500 * attempt);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error('请求失败，请稍后重试');
}

async function callDeepSeekAPI(
  _apiKey: string,
  prompt: string,
  options: DeepSeekCallOptions = {}
): Promise<string> {
  const url = DEEPSEEK_PROXY_ENDPOINT;

  let response: Response;
  try {
    response = await fetchDeepSeekWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: options.temperature ?? GEMINI_DEFAULT_TEMPERATURE,
          max_tokens: options.maxOutputTokens ?? DEEPSEEK_DEFAULT_MAX_OUTPUT_TOKENS,
        }),
      },
      options.timeoutMs ?? DEEPSEEK_DEFAULT_TIMEOUT_MS
    );
  } catch (error) {
    throw new Error(toUserFriendlyErrorMessage(error));
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
  }

  const data: DeepSeekResponse = await response.json();
  if (data.error?.message) {
    throw new Error(data.error.message);
  }

  const choice = data.choices?.[0];
  const text = choice?.message?.content;
  if (!text || !text.trim()) {
    if (choice?.finish_reason === 'length') {
      throw new Error('模型输出过长（达到 token 上限），请重试');
    }
    throw new Error('No response from API');
  }

  return text;
}

async function callTextModelAPI(
  provider: ApiProvider,
  apiKey: string,
  prompt: string,
  options: {
    maxOutputTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    responseSchema?: Record<string, unknown>;
  } = {}
): Promise<string> {
  if (provider === 'deepseek') {
    return callDeepSeekAPI(apiKey, prompt, {
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      timeoutMs: options.timeoutMs,
    });
  }

  return callGeminiAPI(apiKey, prompt, undefined, {
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
    timeoutMs: options.timeoutMs,
    responseSchema: options.responseSchema,
  });
}

// ===== Parse Image with LLM =====

const HOLDINGS_PROMPT = `你是一个专业的证券数据提取助手。请仔细分析这张支付宝证券持仓截图，提取以下信息并以JSON格式返回：

请提取：
1. 每只股票的股票名称、股票代码
2. 持仓数量（股数）
3. 成本价/持仓成本
4. 当前价格
5. 盈亏金额
6. 盈亏率（%）
7. 总资产和总盈亏（如果有）
8. 只提取证券持仓相关字段，忽略昵称、时间、电量、广告、按钮、推荐文案等无关信息
9. 如果是基金持仓页（不是股票），请按以下规则映射：
   - stockName: 基金名称
   - stockCode: 没有代码时填 "N/A"
   - shares: 无份额时填 1
   - currentPrice: 用“金额/持仓市值”
   - profit: 用“持有收益”
   - profitRate: 用“持有收益率”
   - avgCost: 若无成本价，用 currentPrice - profit 估算

请以以下JSON格式返回（不要包含markdown代码块标记）：
{
  "holdings": [
    {
      "stockName": "股票名称",
      "stockCode": "股票代码",
      "shares": 100,
      "avgCost": 10.5,
      "currentPrice": 12.0,
      "profit": 150,
      "profitRate": 14.29
    }
  ],
  "summary": {
    "totalAssets": 100000,
    "totalProfit": 5000,
    "profitRate": 5.0
  }
}

如果某些数据无法识别，请使用合理的估计值。确保返回的是有效的JSON格式。`;

const TRANSACTIONS_PROMPT = `你是一个专业的证券交易记录提取助手。请仔细分析这张支付宝证券交易记录截图，提取以下信息并以JSON格式返回：

请提取每笔交易的：
1. 交易日期（格式：YYYY-MM-DD）
2. 股票/基金名称
3. 股票/基金代码（没有则填 "N/A"）
4. 交易类型（buy/sell）
5. 成交数量（份额）
6. 成交价格
7. 成交金额
8. 基金交易页映射规则：
   - 买入/申购/定投/转入 => type="buy"
   - 卖出/赎回/转出/转换 => type="sell"
   - 文本中出现“500.00元”这类金额：amount=500.00
   - 文本中出现“146.82份”这类份额：shares=146.82
   - 若 price 未给出且 amount>0 且 shares>0，则 price=amount/shares；否则 price=0
9. 只提取交易记录相关字段，忽略页面导航、账户信息、推荐文案、状态文案（如“交易进行中”“预计到账”）

请以以下JSON格式返回（不要包含markdown代码块标记）：
{
  "transactions": [
    {
      "date": "2024-01-15",
      "stockName": "股票名称",
      "stockCode": "600519",
      "type": "buy",
      "shares": 100,
      "price": 100.5,
      "amount": 10050
    }
  ]
}

如果某些数据无法识别，请使用合理的估计值。确保返回的是有效的JSON格式。`;

const HOLDINGS_COMPACT_RETRY_PROMPT = `请只返回一个可被 JSON.parse 解析的 JSON 对象，不要任何解释和 markdown。

目标：从这张证券持仓截图提取字段（最多 20 条）：
{
  "holdings": [
    {
      "stockName": "string",
      "stockCode": "string",
      "shares": number,
      "avgCost": number,
      "currentPrice": number,
      "profit": number,
      "profitRate": number
    }
  ],
  "summary": {
    "totalAssets": number,
    "totalProfit": number,
    "profitRate": number
  }
}`;

const TRANSACTIONS_COMPACT_RETRY_PROMPT = `请只返回一个可被 JSON.parse 解析的 JSON 对象，不要任何解释和 markdown。

目标：从这张证券交易截图提取字段（最多 50 条）：
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "stockName": "string",
      "stockCode": "string",
      "type": "buy" | "sell",
      "shares": number,
      "price": number,
      "amount": number
    }
  ]
}
补充规则：转换/赎回/卖出= sell；买入/申购/定投/转入= buy；无代码填 "N/A"。`;

const HOLDINGS_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  required: ['holdings', 'summary'],
  properties: {
    holdings: {
      type: 'ARRAY',
      maxItems: 20,
      items: {
        type: 'OBJECT',
        required: ['stockName', 'stockCode', 'shares', 'avgCost', 'currentPrice', 'profit', 'profitRate'],
        properties: {
          stockName: { type: 'STRING' },
          stockCode: { type: 'STRING' },
          shares: { type: 'NUMBER' },
          avgCost: { type: 'NUMBER' },
          currentPrice: { type: 'NUMBER' },
          profit: { type: 'NUMBER' },
          profitRate: { type: 'NUMBER' },
        },
      },
    },
    summary: {
      type: 'OBJECT',
      required: ['totalAssets', 'totalProfit', 'profitRate'],
      properties: {
        totalAssets: { type: 'NUMBER' },
        totalProfit: { type: 'NUMBER' },
        profitRate: { type: 'NUMBER' },
      },
    },
  },
};

const TRANSACTIONS_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  required: ['transactions'],
  properties: {
    transactions: {
      type: 'ARRAY',
      maxItems: 50,
      items: {
        type: 'OBJECT',
        required: ['date', 'stockName', 'stockCode', 'type', 'shares', 'price', 'amount'],
        properties: {
          date: { type: 'STRING' },
          stockName: { type: 'STRING' },
          stockCode: { type: 'STRING' },
          type: { type: 'STRING', enum: ['buy', 'sell'] },
          shares: { type: 'NUMBER' },
          price: { type: 'NUMBER' },
          amount: { type: 'NUMBER' },
        },
      },
    },
  },
};

const MAX_OCR_TEXT_LENGTH = 7000;

const HOLDINGS_OCR_PROMPT = `你是OCR转写助手。请逐行读取这张证券持仓截图中的文本并转写为纯文本。
要求：
1. 只输出纯文本，不要 JSON，不要解释
2. 优先保留：股票名称、代码、持仓数量、成本价、现价、盈亏、盈亏率、总资产、总盈亏
3. 忽略无关信息：状态栏、昵称、广告、按钮、推荐文案`;

const TRANSACTIONS_OCR_PROMPT = `你是OCR转写助手。请逐行读取这张证券交易记录截图中的文本并转写为纯文本。
要求：
1. 只输出纯文本，不要 JSON，不要解释
2. 优先保留：日期时间、基金/股票名称、买卖方向、份额、金额
3. 忽略无关信息：导航、广告、按钮、推荐文案`;

function normalizeOcrText(rawText: string): string {
  return rawText
    .replace(/\r/g, '\n')
    .replace(/[，]/g, ',')
    .replace(/[％﹪]/g, '%')
    .replace(/[−—–]/g, '-')
    .replace(/[：]/g, ':')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_OCR_TEXT_LENGTH);
}

function isLikelyOcrNoiseLine(line: string): boolean {
  const value = line.trim();
  if (!value) return true;
  if (/^\d{1,2}:\d{2}$/.test(value)) return true;
  if (/^(5g|4g|wifi|volte|\d+%)$/i.test(value)) return true;
  if (/^(全部|偏股|偏债|指数|黄金|全球|机会|自选|持有|基金市场)$/.test(value)) return true;
  if (/^(我的持有|持有收益率排序|金额\/昨日收益|持有收益\/率|基金|明细|全部|全部持有|收益明细|交易记录)$/.test(value)) return true;
  if (/^(反馈与投诉|更多产品.*|市场解读.*|基金经理说.*|重新分析|交易人格分析器)$/.test(value)) return true;
  if (/财富号/.test(value)) return true;
  if (/^(名称|金额\/昨日收益|持有收益\/率)$/.test(value)) return true;
  return false;
}

function normalizeOcrTextForType(rawText: string, type: 'holdings' | 'transactions'): string {
  const baseLines = normalizeOcrText(rawText)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isLikelyOcrNoiseLine(line));

  const mergedLines: string[] = [];
  for (const rawLine of baseLines) {
    const line = rawLine.replace(/\s{2,}/g, ' ');
    if (mergedLines.length > 0 && /^[A-Za-z]$/.test(line)) {
      // 基金名称常被 OCR 拆成单独字母行（如“混合”后面的“C”）
      mergedLines[mergedLines.length - 1] = `${mergedLines[mergedLines.length - 1]}${line}`;
      continue;
    }
    mergedLines.push(line);
  }

  const filtered = mergedLines.filter((line) => {
    const hasChinese = /[\u4e00-\u9fa5]/.test(line);
    const hasNumber = /[-+]?\d[\d,]*(\.\d+)?/.test(line);
    const hasPercent = /[-+]?\d[\d,]*(\.\d+)?\s*%/.test(line);
    const hasDate = /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}|\d{1,2}:\d{2}:\d{2}/.test(line);
    const hasCode = /\b\d{6}\b/.test(line);
    const isFundName = /(基金|混合|股票|债券|指数|ETF|联接|增强|FOF|QDII|LOF|策略|价值|成长|医药|科技|消费|中证|沪深|创业|新能源|红利)/.test(line);
    const hasFundSeparator = /基金\s*\|/.test(line);
    const isTradingKeyword = /(买入|卖出|转换|转入|转出|申购|赎回|buy|sell|成交|委托|撤单|到账|进行中)/i.test(line);
    const numberTokens = line.match(/[-+]?\d[\d,]*(\.\d+)?/g) ?? [];
    const isNumericRow = numberTokens.length >= 1 && !/[A-Za-z]{3,}/.test(line);

    if (type === 'holdings') {
      return hasPercent || hasCode || isFundName || (hasChinese && hasNumber) || isNumericRow;
    }

    return hasDate || hasPercent || hasFundSeparator || isTradingKeyword || (hasChinese && hasNumber);
  });

  return filtered.join('\n').slice(0, MAX_OCR_TEXT_LENGTH);
}

const HOLDINGS_FROM_OCR_PROMPT = (ocrText: string) => `以下是从持仓截图OCR得到的文本，请你仅基于这些文本提取结构化数据。

OCR文本：
${ocrText}

规则（非常重要）：
1. 只提取“真实持仓条目”，忽略导航栏、分类标签、广告、文案、按钮
2. 基金页常见结构是三行：
   - 第1行：基金名称
   - 第2行：金额/昨日收益
   - 第3行：持有收益/持有收益率
   按如下映射：
   - stockName = 基金名称
   - stockCode = 若没有代码填 "N/A"
   - shares = 无份额时填 1
   - currentPrice = 金额（持仓市值）
   - profit = 持有收益
   - profitRate = 持有收益率（百分比数字）
   - avgCost = 优先读取成本字段；无成本时用 currentPrice - profit，仍无法计算则等于 currentPrice
3. 返回 holdings 时，最多 20 条，不要输出空对象
4. summary 若页面无总计，请用 holdings 汇总：
   - totalAssets = sum(currentPrice)
   - totalProfit = sum(profit)
   - profitRate = totalAssets > 0 ? totalProfit / totalAssets * 100 : 0

请严格返回 JSON（不要 markdown，不要解释）：
{
  "holdings": [
    {
      "stockName": "string",
      "stockCode": "string",
      "shares": number,
      "avgCost": number,
      "currentPrice": number,
      "profit": number,
      "profitRate": number
    }
  ],
  "summary": {
    "totalAssets": number,
    "totalProfit": number,
    "profitRate": number
  }
}
若字段缺失，按上述规则补齐；数值字段必须是 number。`;

const HOLDINGS_FROM_OCR_RETRY_PROMPT = (ocrText: string) => `你上一次输出被截断。现在只输出一个可被 JSON.parse 解析的完整 JSON。

OCR文本：
${ocrText}

输出结构：
{
  "holdings": [{"stockName":"string","stockCode":"string","shares":0,"avgCost":0,"currentPrice":0,"profit":0,"profitRate":0}],
  "summary": {"totalAssets":0,"totalProfit":0,"profitRate":0}
}
注意：基金页按“金额=currentPrice，持有收益=profit，持有收益率=profitRate”映射。`;

const TRANSACTIONS_FROM_OCR_PROMPT = (ocrText: string) => `以下是从交易截图OCR得到的原始文本，请你仅基于这些文本提取结构化数据。

OCR文本：
${ocrText}

规则（非常重要）：
1. 每条交易通常包含：方向词（买入/卖出/转换）+ 基金名称 + 份额或金额 + 日期时间
2. 字段映射：
   - stockName：基金/股票名称（去掉“基金 | ”前缀）
   - stockCode：没有代码时填 "N/A"
   - type：买入/申购/定投/转入 => "buy"；卖出/赎回/转出/转换 => "sell"
   - shares：识别“xxx份”里的数字；若无份额填 0
   - amount：识别“xxx元”里的数字；若无金额填 0
   - price：优先使用明确价格；若无且 amount>0 且 shares>0，用 amount/shares；否则 0
   - date：提取日期，优先 YYYY-MM-DD（可忽略具体时分秒）
3. 忽略“交易进行中”“预计到账”等状态文案
4. 只输出有效交易，不要空对象

请严格返回 JSON（不要 markdown，不要解释）：
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "stockName": "string",
      "stockCode": "string",
      "type": "buy" | "sell",
      "shares": number,
      "price": number,
      "amount": number
    }
  ]
}
若某字段缺失，按上述规则填 0 或 "N/A"。`;

const TRANSACTIONS_FROM_OCR_RETRY_PROMPT = (ocrText: string) => `你上一次输出被截断。现在只输出一个可被 JSON.parse 解析的完整 JSON。

OCR文本：
${ocrText}

输出结构：
{
  "transactions": [{"date":"1970-01-01","stockName":"string","stockCode":"string","type":"buy","shares":0,"price":0,"amount":0}]
}
注意：转换/赎回/卖出统一映射为 "sell"，买入/申购/定投/转入映射为 "buy"。`;

async function parseImageWithDirectJson(
  apiKey: string,
  imageBase64: string,
  type: 'holdings' | 'transactions'
): Promise<Partial<TradeData>> {
  const prompts =
    type === 'holdings'
      ? [HOLDINGS_PROMPT, HOLDINGS_COMPACT_RETRY_PROMPT]
      : [TRANSACTIONS_PROMPT, TRANSACTIONS_COMPACT_RETRY_PROMPT];
  const responseSchema = type === 'holdings' ? HOLDINGS_RESPONSE_SCHEMA : TRANSACTIONS_RESPONSE_SCHEMA;
  let lastError: unknown;

  for (let i = 0; i < prompts.length; i++) {
    try {
      const response = await callGeminiAPI(apiKey, prompts[i], imageBase64, {
        maxOutputTokens: i === 0 ? 2048 : 1200,
        temperature: 0.1,
        timeoutMs: GEMINI_IMAGE_TIMEOUT_MS,
        responseSchema,
      });

      const parsedData = parseJsonObjectFromText(response);
      if (!parsedData || typeof parsedData !== 'object') {
        throw new Error('模型返回格式无效');
      }
      return parsedData as Partial<TradeData>;
    } catch (error) {
      lastError = error;
      console.error(`Gemini API error (direct image parse attempt ${i + 1}):`, error);
      if (i === 0 && (isJsonStructureError(error) || isTokenLimitError(error))) {
        continue;
      }
      break;
    }
  }

  throw new Error('图片解析失败: ' + toUserFriendlyErrorMessage(lastError));
}

async function parseImageWithIndependentOcrPipeline(
  provider: ApiProvider,
  apiKey: string,
  imageBase64: string,
  type: 'holdings' | 'transactions'
): Promise<Partial<TradeData>> {
  const ocrRawText = await runIndependentOcr(imageBase64, type);
  const ocrText = normalizeOcrTextForType(ocrRawText, type);
  if (!ocrText) {
    throw new Error('独立 OCR 未提取到有效文本');
  }

  const prompts =
    type === 'holdings'
      ? [HOLDINGS_FROM_OCR_PROMPT(ocrText), HOLDINGS_FROM_OCR_RETRY_PROMPT(ocrText)]
      : [TRANSACTIONS_FROM_OCR_PROMPT(ocrText), TRANSACTIONS_FROM_OCR_RETRY_PROMPT(ocrText)];
  const responseSchema = type === 'holdings' ? HOLDINGS_RESPONSE_SCHEMA : TRANSACTIONS_RESPONSE_SCHEMA;

  let lastError: unknown;
  for (let i = 0; i < prompts.length; i++) {
    try {
      const response = await callTextModelAPI(provider, apiKey, prompts[i], {
        maxOutputTokens: i === 0 ? 1500 : 900,
        temperature: 0.1,
        timeoutMs: provider === 'deepseek' ? DEEPSEEK_DEFAULT_TIMEOUT_MS : GEMINI_DEFAULT_TIMEOUT_MS,
        responseSchema,
      });

      const parsedData = parseJsonObjectFromText(response);
      if (!parsedData || typeof parsedData !== 'object') {
        throw new Error('模型返回格式无效');
      }
      return parsedData as Partial<TradeData>;
    } catch (error) {
      lastError = error;
      console.error(`Gemini API error (independent-ocr->json attempt ${i + 1}):`, error);
      if (i === 0 && (isJsonStructureError(error) || isTokenLimitError(error))) {
        continue;
      }
      break;
    }
  }

  throw new Error('图片解析失败: ' + toUserFriendlyErrorMessage(lastError));
}

async function parseImageWithOcrPipeline(
  apiKey: string,
  imageBase64: string,
  type: 'holdings' | 'transactions'
): Promise<Partial<TradeData>> {
  const ocrPrompt = type === 'holdings' ? HOLDINGS_OCR_PROMPT : TRANSACTIONS_OCR_PROMPT;
  const ocrRawText = await callGeminiAPI(apiKey, ocrPrompt, imageBase64, {
    maxOutputTokens: 2200,
    temperature: 0,
    timeoutMs: GEMINI_IMAGE_TIMEOUT_MS,
    responseMimeType: 'text/plain',
  });
  const ocrText = normalizeOcrTextForType(ocrRawText, type);
  if (!ocrText) {
    throw new Error('OCR 未提取到有效文本');
  }

  const prompts =
    type === 'holdings'
      ? [HOLDINGS_FROM_OCR_PROMPT(ocrText), HOLDINGS_FROM_OCR_RETRY_PROMPT(ocrText)]
      : [TRANSACTIONS_FROM_OCR_PROMPT(ocrText), TRANSACTIONS_FROM_OCR_RETRY_PROMPT(ocrText)];
  const responseSchema = type === 'holdings' ? HOLDINGS_RESPONSE_SCHEMA : TRANSACTIONS_RESPONSE_SCHEMA;

  let lastError: unknown;
  for (let i = 0; i < prompts.length; i++) {
    try {
      const response = await callGeminiAPI(apiKey, prompts[i], undefined, {
        maxOutputTokens: i === 0 ? 1500 : 900,
        temperature: 0.1,
        timeoutMs: GEMINI_DEFAULT_TIMEOUT_MS,
        responseSchema,
      });

      const parsedData = parseJsonObjectFromText(response);
      if (!parsedData || typeof parsedData !== 'object') {
        throw new Error('模型返回格式无效');
      }
      return parsedData as Partial<TradeData>;
    } catch (error) {
      lastError = error;
      console.error(`Gemini API error (ocr->json attempt ${i + 1}):`, error);
      if (i === 0 && (isJsonStructureError(error) || isTokenLimitError(error))) {
        continue;
      }
      break;
    }
  }

  throw new Error('图片解析失败: ' + toUserFriendlyErrorMessage(lastError));
}

export async function parseImageWithLLM(
  imageBase64: string,
  type: 'holdings' | 'transactions',
  ocrImageBase64?: string
): Promise<Partial<TradeData>> {
  const apiKey = getStoredApiKey();
  const provider = getStoredProvider();
  const ocrInput = ocrImageBase64 || imageBase64;

  if (!apiKey) {
    throw new Error('服务端 DeepSeek API 未配置');
  }

  // Use two-stage pipeline first: OCR text -> structured JSON. Fall back to direct image parsing.
  let independentPipelineError: unknown = null;
  try {
    return await parseImageWithIndependentOcrPipeline(provider, apiKey, ocrInput, type);
  } catch (independentOcrError) {
    independentPipelineError = independentOcrError;
    console.error('Independent OCR pipeline failed:', independentOcrError);
  }

  if (provider === 'deepseek') {
    throw new Error('图片解析失败: ' + toUserFriendlyErrorMessage(independentPipelineError));
  }

  try {
    return await parseImageWithOcrPipeline(apiKey, ocrInput, type);
  } catch (geminiOcrError) {
    console.error('Gemini OCR pipeline failed:', geminiOcrError);
  }

  return await parseImageWithDirectJson(apiKey, imageBase64, type);
}

// ===== Analyze Trading Data =====

const ANALYSIS_PROMPT = (tradeData: TradeData) => `你是一个专业的交易心理分析师，擅长用星座/塔罗风格的神秘语言分析投资者的交易行为。

请根据以下交易数据，生成一份交易人格分析报告。报告必须包含以下字段，并以JSON格式返回：

交易数据：
${JSON.stringify(tradeData, null, 2)}

请生成以下格式的JSON（不要包含markdown代码块标记）：
{
  "traderArchetype": "交易人格名称（如：天蝎猎手、狮子王者、双子游侠、金牛守护者、水瓶先知等，要有星座/神秘风格）",
  "archetypeDescription": "对这个人格的总体描述，用星座/塔罗风格的诗意语言，60字左右",
  "personalityTraits": [
    {
      "trait": "特质名称（如：直觉敏锐）",
      "description": "详细描述这个特质",
      "evidence": "来自交易数据的简短证据"
    }
  ],
  "tradingPatterns": [
    {
      "pattern": "模式名称（如：分批建仓）",
      "description": "描述这个交易模式",
      "evidence": "来自交易数据的简短证据"
    }
  ],
  "strengths": [
    {
      "strength": "优势名称",
      "description": "描述这个优势",
      "evidence": "来自交易数据的简短证据"
    }
  ],
  "weaknesses": [
    {
      "weakness": "弱点名称",
      "description": "描述这个弱点",
      "evidence": "来自交易数据的简短证据"
    }
  ],
  "destinyPrediction": "用星座运势的风格预测未来3-6个月的投资运势，包含星象隐喻，80字左右",
  "advice": "给出具体的投资建议，60字左右"
}

重要提示：
1. 使用神秘、诗意的语言风格，像星座解析或塔罗牌解读
2. 返回有效的JSON格式
3. personalityTraits 必须输出 3 条；tradingPatterns/strengths/weaknesses 各输出 2-3 条
4. 每条 description 不超过45字，每条 evidence 不超过36字
5. 只基于持仓金额、持有收益、收益率、交易记录做结论；不要提“份额/股数/手数”
6. 证据应优先引用金额占比、收益金额、收益率、交易次数等信息
7. 严禁输出任何 JSON 之外的文字`;

const ANALYSIS_COMPACT_RETRY_PROMPT = (tradeData: TradeData) => `你上一次输出被截断。现在只做一件事：输出可被 JSON.parse 解析的完整 JSON 对象。

交易数据：
${JSON.stringify(tradeData)}

要求：
1. 不要 markdown，不要解释，不要前后缀
2. 字段结构必须严格如下：
{
  "traderArchetype": "string",
  "archetypeDescription": "string",
  "personalityTraits": [{"trait":"string","description":"string","evidence":"string"}],
  "tradingPatterns": [{"pattern":"string","description":"string","evidence":"string"}],
  "strengths": [{"strength":"string","description":"string","evidence":"string"}],
  "weaknesses": [{"weakness":"string","description":"string","evidence":"string"}],
  "destinyPrediction": "string",
  "advice": "string"
}
3. 控制简洁：personalityTraits 固定3条，其他数组最多3条，description/evidence 每条不超过40字，destinyPrediction/advice 不超过80字
4. 不要出现“份额/股数/手数”`;

function toNonEmptyString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function normalizeAnalysisArray(
  raw: unknown,
  titleKey: 'trait' | 'pattern' | 'strength' | 'weakness'
): Array<{ [k in typeof titleKey]: string } & { description: string; evidence?: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        [titleKey]: toNonEmptyString(record[titleKey], '未命名'),
        description: toNonEmptyString(record.description, '暂无描述'),
        evidence: typeof record.evidence === 'string' && record.evidence.trim() ? record.evidence.trim() : undefined,
      } as { [k in typeof titleKey]: string } & { description: string; evidence?: string };
    });
}

type TraitItem = { trait: string; description: string; evidence?: string };

function ensureMinTraitItems(
  items: TraitItem[],
  minimum: number,
  fillers: TraitItem[]
): TraitItem[] {
  const next = items.slice(0, Math.max(minimum, items.length));
  let i = 0;
  while (next.length < minimum && i < fillers.length) {
    next.push(fillers[i]);
    i += 1;
  }
  return next;
}

function toFiniteNumberForAnalysis(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function buildAnalysisInput(tradeData: TradeData): TradeData {
  const holdings = Array.isArray(tradeData.holdings)
    ? tradeData.holdings.slice(0, 20).map((h) => ({
      stockName: toNonEmptyString(h.stockName, '未知股票'),
      stockCode: toNonEmptyString(h.stockCode, 'N/A'),
      // 基金持仓截图通常不包含份额，避免模型把占位值当成真实信息。
      shares: 0,
      avgCost: toFiniteNumberForAnalysis(h.avgCost),
      currentPrice: toFiniteNumberForAnalysis(h.currentPrice),
      profit: toFiniteNumberForAnalysis(h.profit),
      profitRate: toFiniteNumberForAnalysis(h.profitRate),
    }))
    : [];

  const transactions = Array.isArray(tradeData.transactions)
    ? tradeData.transactions.slice(0, 40).map((t) => {
      const txType: 'buy' | 'sell' = t.type === 'sell' ? 'sell' : 'buy';
      return {
        date: toNonEmptyString(t.date, '1970-01-01'),
        stockName: toNonEmptyString(t.stockName, '未知股票'),
        stockCode: toNonEmptyString(t.stockCode, 'N/A'),
        type: txType,
        shares: toFiniteNumberForAnalysis(t.shares),
        price: toFiniteNumberForAnalysis(t.price),
        amount: toFiniteNumberForAnalysis(t.amount),
      };
    })
    : [];

  return {
    holdings,
    transactions,
    summary: {
      totalAssets: toFiniteNumberForAnalysis(tradeData.summary?.totalAssets),
      totalProfit: toFiniteNumberForAnalysis(tradeData.summary?.totalProfit),
      profitRate: toFiniteNumberForAnalysis(tradeData.summary?.profitRate),
    },
  };
}

function normalizeAnalysisReport(raw: unknown): AnalysisReport {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const personalityTraits = ensureMinTraitItems(
    normalizeAnalysisArray(record.personalityTraits, 'trait') as TraitItem[],
    3,
    [
      { trait: '结构观察者', description: '你会先看组合结构，再做动作。', evidence: '证据：持仓分布在多个主题赛道。' },
      { trait: '波动承受者', description: '面对波动时，你更偏向耐心观察。', evidence: '证据：组合中正负收益并存，仍保持持有。' },
      { trait: '节奏调和者', description: '你追求收益与回撤间的平衡感。', evidence: '证据：组合收益率围绕中性区间波动。' },
    ]
  );

  return {
    traderArchetype: toNonEmptyString(record.traderArchetype, '星辰观察者'),
    archetypeDescription: toNonEmptyString(record.archetypeDescription, '你善于在市场波动中观察节奏。'),
    personalityTraits,
    tradingPatterns: normalizeAnalysisArray(record.tradingPatterns, 'pattern'),
    strengths: normalizeAnalysisArray(record.strengths, 'strength'),
    weaknesses: normalizeAnalysisArray(record.weaknesses, 'weakness'),
    destinyPrediction: toNonEmptyString(record.destinyPrediction, '近期运势偏稳，重在纪律。'),
    advice: toNonEmptyString(record.advice, '控制仓位，先求稳再求进。'),
  };
}

export async function analyzeTradingData(tradeData: TradeData): Promise<AnalysisReport> {
  const apiKey = getStoredApiKey();
  const provider = getStoredProvider();
  const analysisInput = buildAnalysisInput(tradeData);

  if (!apiKey) {
    throw new Error('服务端 DeepSeek API 未配置');
  }

  // Use configured LLM provider (deepseek by default)
  const prompts = [ANALYSIS_PROMPT(analysisInput), ANALYSIS_COMPACT_RETRY_PROMPT(analysisInput)];
  let lastError: unknown;

  for (let i = 0; i < prompts.length; i++) {
    try {
      const response =
        provider === 'deepseek'
          ? await callDeepSeekAPI(apiKey, prompts[i], {
            maxOutputTokens: i === 0 ? DEEPSEEK_ANALYSIS_MAX_OUTPUT_TOKENS : DEEPSEEK_DEFAULT_MAX_OUTPUT_TOKENS,
            temperature: i === 0 ? 0.3 : 0.1,
            timeoutMs: GEMINI_ANALYSIS_TIMEOUT_MS,
          })
          : await callGeminiAPI(apiKey, prompts[i], undefined, {
            maxOutputTokens: i === 0 ? GEMINI_ANALYSIS_MAX_OUTPUT_TOKENS : GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
            temperature: i === 0 ? 0.3 : 0.1,
            timeoutMs: GEMINI_ANALYSIS_TIMEOUT_MS,
          });

      const parsedReport = parseJsonObjectFromText(response);
      return normalizeAnalysisReport(parsedReport);
    } catch (error) {
      lastError = error;
      console.error(`${provider} API error (analysis attempt ${i + 1}):`, error);

      if (i === 0 && (isJsonStructureError(error) || isTokenLimitError(error))) {
        continue;
      }

      break;
    }
  }

  throw new Error('分析生成失败: ' + toUserFriendlyErrorMessage(lastError));
}

// ===== Validate API Key =====

export interface ApiKeyValidationResult {
  isValid: boolean;
  message?: string;
}

export async function validateApiKey(
  _apiKey: string,
  _provider: ApiProvider = getStoredProvider()
): Promise<ApiKeyValidationResult> {
  return {
    isValid: false,
    message: '前端 API Key 配置已移除，当前由服务端统一维护',
  };
}
