import { useState, useRef, useEffect } from 'react';
import { Sparkles, Upload, Stars, Moon, Sun, ChevronRight, X, Image as ImageIcon, FileText, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import type { TradeData, AnalysisReport, UploadedImage } from '@/types';
import { analyzeTradingData, parseImageWithLLM } from '@/services/llmService';
import { ReportView } from '@/sections/ReportView';
import { LoadingState } from '@/sections/LoadingState';

const MAX_UPLOAD_IMAGE_SIDE = 1800;
const MAX_UPLOAD_IMAGE_BYTES = 1_200_000;
const DEFAULT_PARSE_CONCURRENCY_DEEPSEEK = 2;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result as string);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function dataUrlSizeInBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] ?? '';
  return Math.floor((base64.length * 3) / 4);
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('加载图片失败'));
    image.src = dataUrl;
  });
}

async function optimizeImageForLLM(file: File): Promise<{
  dataUrl: string;
  originalDataUrl: string;
  originalBytes: number;
  resultBytes: number;
}> {
  const originalDataUrl = await fileToDataUrl(file);
  const originalBytes = dataUrlSizeInBytes(originalDataUrl);

  try {
    const image = await loadImage(originalDataUrl);
    const maxSide = Math.max(image.width, image.height);
    const scale = maxSide > MAX_UPLOAD_IMAGE_SIDE ? MAX_UPLOAD_IMAGE_SIDE / maxSide : 1;

    let targetWidth = Math.max(1, Math.round(image.width * scale));
    let targetHeight = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return { dataUrl: originalDataUrl, originalDataUrl, originalBytes, resultBytes: originalBytes };
    }

    let quality = 0.9;
    let resultDataUrl = originalDataUrl;
    let resultBytes = originalBytes;

    // Resize + encode to JPEG for smaller payload while keeping text readable.
    while (true) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      ctx.clearRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

      resultDataUrl = canvas.toDataURL('image/jpeg', quality);
      resultBytes = dataUrlSizeInBytes(resultDataUrl);

      if (resultBytes <= MAX_UPLOAD_IMAGE_BYTES) break;
      if (quality > 0.65) {
        quality -= 0.08;
        continue;
      }
      if (targetWidth > 700 && targetHeight > 700) {
        targetWidth = Math.round(targetWidth * 0.85);
        targetHeight = Math.round(targetHeight * 0.85);
        continue;
      }
      break;
    }

    return { dataUrl: resultDataUrl, originalDataUrl, originalBytes, resultBytes };
  } catch {
    return { dataUrl: originalDataUrl, originalDataUrl, originalBytes, resultBytes: originalBytes };
  }
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const normalized = value
      .replace(/,/g, '')
      .replace(/[％﹪]/g, '%')
      .replace(/[−—–]/g, '-')
      .replace(/%/g, '');
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function extractFirstNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const normalized = value
      .replace(/[，,]/g, '')
      .replace(/[％﹪]/g, '%')
      .replace(/[−—–]/g, '-');
    const match = normalized.match(/[-+]?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return fallback;
}

function toSafeString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function normalizeTradeDate(value: unknown): string {
  const text = toSafeString(value, '');
  const match = text.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/);
  if (!match) return '1970-01-01';
  const [year, month, day] = match[0].split(/[-/.]/);
  const mm = month.padStart(2, '0');
  const dd = day.padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function normalizeHoldingItem(raw: unknown): TradeData['holdings'][number] | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const stockName = toSafeString(record.stockName ?? record.fundName ?? record.name, '未知标的');
  const stockCode = toSafeString(record.stockCode ?? record.code, 'N/A');
  const currentPrice = toFiniteNumber(
    record.currentPrice ?? record.amount ?? record.marketValue ?? record.positionValue,
    0
  );
  const profit = toFiniteNumber(
    record.profit ?? record.holdProfit ?? record.pnl ?? record.floatingProfit,
    0
  );
  const inferredAvgCost = currentPrice - profit;
  const shares = toFiniteNumber(record.shares ?? record.units ?? record.position ?? 1, 1);

  return {
    stockName,
    stockCode,
    shares: shares > 0 ? shares : 1,
    avgCost: toFiniteNumber(record.avgCost ?? record.costPrice ?? record.cost, inferredAvgCost),
    currentPrice,
    profit,
    profitRate: toFiniteNumber(
      record.profitRate ?? record.holdProfitRate ?? record.pnlRate ?? record.returnRate,
      0
    ),
  };
}

function normalizeTransactionItem(raw: unknown): TradeData['transactions'][number] | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const typeRaw = toSafeString(record.type ?? record.direction ?? record.action, 'buy').toLowerCase();
  const type: 'buy' | 'sell' =
    /(sell|卖出|赎回|转出|转换)/i.test(typeRaw) ? 'sell' : 'buy';
  const stockName = toSafeString(
    record.stockName ?? record.fundName ?? record.name ?? record.securityName,
    '未知标的'
  )
    .replace(/^基金\s*\|?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const shares = extractFirstNumber(record.shares ?? record.quantity ?? record.units ?? record.volume, 0);
  const amount = extractFirstNumber(
    record.amount ?? record.transactionAmount ?? record.money ?? record.dealAmount,
    0
  );
  const directPrice = extractFirstNumber(record.price ?? record.dealPrice ?? record.nav, 0);
  const inferredPrice = shares > 0 && amount > 0 ? amount / shares : 0;
  const price = directPrice > 0 ? directPrice : inferredPrice;

  return {
    date: normalizeTradeDate(record.date),
    stockName,
    stockCode: toSafeString(record.stockCode ?? record.code, 'N/A'),
    type,
    shares,
    price,
    amount,
  };
}

function normalizeHoldings(raw: unknown): TradeData['holdings'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeHoldingItem(item))
    .filter((item): item is TradeData['holdings'][number] => item !== null);
}

function normalizeTransactions(raw: unknown): TradeData['transactions'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeTransactionItem(item))
    .filter((item): item is TradeData['transactions'][number] => item !== null);
}

function computeSummaryFromHoldings(holdings: TradeData['holdings']): TradeData['summary'] {
  const totalAssets = holdings.reduce((sum, item) => sum + item.currentPrice, 0);
  const totalProfit = holdings.reduce((sum, item) => sum + item.profit, 0);
  const totalCost = totalAssets - totalProfit;

  let profitRate = 0;
  if (totalCost > 0) {
    // 与基金页面口径保持一致：持有收益率 = 持有收益 / 持仓成本
    profitRate = (totalProfit / totalCost) * 100;
  } else if (totalAssets > 0) {
    profitRate = (totalProfit / totalAssets) * 100;
  }

  return {
    totalAssets,
    totalProfit,
    profitRate,
  };
}

function scoreHoldingItem(item: TradeData['holdings'][number]): number {
  let score = 0;
  if (item.currentPrice > 0) score += 2;
  if (item.profit !== 0) score += 2;
  if (item.profitRate !== 0) score += 2;
  if (item.avgCost > 0) score += 1;
  if (item.shares > 0) score += 1;
  if (item.stockCode && item.stockCode !== 'N/A') score += 1;
  return score;
}

function dedupeHoldings(items: TradeData['holdings']): TradeData['holdings'] {
  const map = new Map<string, TradeData['holdings'][number]>();
  for (const item of items) {
    const key = `${item.stockName.trim().toLowerCase()}|${item.stockCode.trim().toLowerCase()}`;
    const existing = map.get(key);
    if (!existing || scoreHoldingItem(item) > scoreHoldingItem(existing)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function dedupeTransactions(items: TradeData['transactions']): TradeData['transactions'] {
  const map = new Map<string, TradeData['transactions'][number]>();
  for (const item of items) {
    const key = [
      item.date.trim(),
      item.stockName.trim().toLowerCase(),
      item.type,
      item.amount.toFixed(2),
      item.shares.toFixed(4),
    ].join('|');
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }
    const existingScore = (existing.price > 0 ? 1 : 0) + (existing.stockCode !== 'N/A' ? 1 : 0);
    const currentScore = (item.price > 0 ? 1 : 0) + (item.stockCode !== 'N/A' ? 1 : 0);
    if (currentScore > existingScore) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));
  return results;
}

function getAnalysisDurationHint(imageCount: number): string {
  if (imageCount <= 1) {
    return '当前 1 张图，通常约 40-60 秒完成';
  }
  if (imageCount <= 3) {
    return `当前 ${imageCount} 张图，通常约 1 分钟完成`;
  }
  if (imageCount <= 6) {
    return `当前 ${imageCount} 张图，通常约 1-2 分钟完成`;
  }
  return `当前 ${imageCount} 张图，图片较多，通常需要约 2 分钟`;
}

function App() {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [tradeData, setTradeData] = useState<TradeData | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState<'holdings' | 'transactions'>('holdings');
  const apiMode = 'deepseek' as const;

  const appendDebugLog = (message: string) => {
    if (!import.meta.env.DEV) return;
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs((prev) => [`[${timestamp}] ${message}`, ...prev].slice(0, 30));
  };

  // Generate star field
  useEffect(() => {
    const starField = document.getElementById('star-field');
    if (starField) {
      for (let i = 0; i < 100; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;
        star.style.animationDelay = `${Math.random() * 2}s`;
        starField.appendChild(star);
      }
    }
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} 不是图片文件`);
        continue;
      }

      try {
        const optimized = await optimizeImageForLLM(file);
        const newImage: UploadedImage = {
          id: Math.random().toString(36).substr(2, 9),
          file,
          preview: optimized.dataUrl,
          ocrSource: optimized.originalDataUrl,
          type: activeTab,
        };
        setImages((prev) => [...prev, newImage]);
        const beforeKB = Math.round(optimized.originalBytes / 1024);
        const afterKB = Math.round(optimized.resultBytes / 1024);
        if (afterKB < beforeKB) {
          appendDebugLog(`图片优化：${file.name} ${beforeKB}KB -> ${afterKB}KB`);
          toast.success(`已添加 ${file.name}（已优化）`);
        } else {
          toast.success(`已添加 ${file.name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        toast.error(`读取图片失败：${file.name}（${errorMessage}）`);
      }
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleAnalyze = async () => {
    if (images.length === 0) {
      toast.error('请至少上传一张图片');
      return;
    }

    setLastError(null);
    setDebugLogs([]);
    setIsAnalyzing(true);
    toast.info('正在解析图片中的交易数据...');
    appendDebugLog(`开始分析，共 ${images.length} 张图片，模式：${apiMode}`);
    appendDebugLog(`浏览器在线状态：${navigator.onLine ? 'online' : 'offline'}`);

    try {
      const envParseConcurrency = Number(import.meta.env.VITE_IMAGE_PARSE_CONCURRENCY);
      const defaultConcurrency = DEFAULT_PARSE_CONCURRENCY_DEEPSEEK;
      const parseConcurrency =
        Number.isFinite(envParseConcurrency) && envParseConcurrency > 0
          ? Math.floor(envParseConcurrency)
          : defaultConcurrency;
      const effectiveConcurrency = Math.max(1, Math.min(images.length, parseConcurrency));
      appendDebugLog(`并行解析已启用：并发 ${effectiveConcurrency}`);

      const parsedDataArray = await mapWithConcurrency(images, effectiveConcurrency, async (img, index) => {
        const startedAt = performance.now();
        appendDebugLog(`解析第 ${index + 1} 张：${img.file.name}（${img.type}）`);
        try {
          const data = await parseImageWithLLM(img.preview, img.type, img.ocrSource || img.preview);
          const elapsedMs = Math.round(performance.now() - startedAt);
          appendDebugLog(`第 ${index + 1} 张解析成功（${elapsedMs}ms）`);
          return { type: img.type, data } as { type: 'holdings' | 'transactions'; data: Partial<TradeData> };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          throw new Error(`第 ${index + 1} 张图片（${img.file.name}）解析失败：${errorMessage}`);
        }
      });

      // Merge parsed data
      const mergedData: TradeData = {
        holdings: [],
        transactions: [],
        summary: {
          totalAssets: 0,
          totalProfit: 0,
          profitRate: 0,
        },
      };

      parsedDataArray.forEach(({ type, data }) => {
        if (type === 'holdings') {
          mergedData.holdings.push(...normalizeHoldings(data.holdings));
        }
        if (type === 'transactions') {
          mergedData.transactions.push(...normalizeTransactions(data.transactions));
        }
        if (data.summary && typeof data.summary === 'object') {
          const summary = data.summary as Record<string, unknown>;
          mergedData.summary = {
            totalAssets: toFiniteNumber(
              summary.totalAssets ?? summary.totalAmount ?? summary.assets,
              mergedData.summary.totalAssets
            ),
            totalProfit: toFiniteNumber(
              summary.totalProfit ?? summary.profit ?? summary.holdProfit,
              mergedData.summary.totalProfit
            ),
            profitRate: toFiniteNumber(
              summary.profitRate ?? summary.totalProfitRate ?? summary.holdProfitRate,
              mergedData.summary.profitRate
            ),
          };
        }
      });

      mergedData.holdings = dedupeHoldings(mergedData.holdings);
      mergedData.transactions = dedupeTransactions(mergedData.transactions);
      if (mergedData.holdings.length > 0) {
        mergedData.summary = computeSummaryFromHoldings(mergedData.holdings);
      }

      setTradeData(mergedData);
      appendDebugLog(`图片解析完成：持仓 ${mergedData.holdings.length} 条，交易 ${mergedData.transactions.length} 条`);
      toast.success('数据解析完成，正在生成人格分析...');

      // Generate analysis report
      appendDebugLog('开始生成分析报告');
      const analysisReport = await analyzeTradingData(mergedData);
      setReport(analysisReport);
      appendDebugLog('分析报告生成成功');
      toast.success('分析完成！');
    } catch (error) {
      console.error('Analysis error:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      setLastError(errorMessage);
      appendDebugLog(`分析失败：${errorMessage}`);
      toast.error(`分析失败：${errorMessage}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const resetAnalysis = () => {
    setImages([]);
    setReport(null);
    setTradeData(null);
  };

  if (isAnalyzing) {
    return <LoadingState />;
  }

  if (report && tradeData) {
    return <ReportView report={report} tradeData={tradeData} onReset={resetAnalysis} />;
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Star Field Background */}
      <div id="star-field" className="star-field" />

      {/* Main Content */}
      <div className="relative z-10 container mx-auto px-4 py-8 min-h-screen flex flex-col">
        {/* Header */}
        <header className="text-center mb-12 animate-fade-in-up">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Stars className="w-8 h-8 text-amber-400 animate-star-twinkle" />
            <Sparkles className="w-6 h-6 text-purple-400 animate-float" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold gold-text mb-4 tracking-wide">
            交易人格分析器
          </h1>
          <p className="text-purple-200/70 text-lg max-w-2xl mx-auto">
            上传你的支付宝证券交易、持仓截图，探索你独特的交易人格
          </p>
          
          {/* API Mode Indicator */}
          <div className="flex items-center justify-center gap-2 mt-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
              <Cpu className="w-3 h-3" />
              <span>DeepSeek AI 模式</span>
            </div>
          </div>
          
          <div className="mystical-divider max-w-md mx-auto mt-6" />
        </header>

        {/* Upload Section */}
        <main className="flex-1 max-w-4xl mx-auto w-full">
          {lastError && (
            <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <h3 className="text-sm font-semibold text-red-300">上次分析失败</h3>
              <p className="mt-1 text-xs text-red-200/90 break-words">{lastError}</p>
            </div>
          )}

          {import.meta.env.DEV && debugLogs.length > 0 && (
            <details className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-amber-300">
                开发调试日志（点击展开）
              </summary>
              <div className="mt-3 space-y-1 text-xs text-amber-100/90 font-mono">
                {debugLogs.map((log, idx) => (
                  <p key={`${idx}-${log}`} className="break-words">{log}</p>
                ))}
              </div>
            </details>
          )}

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'holdings' | 'transactions')}
            className="w-full"
          >
            <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 mb-8 bg-purple-950/50 border border-amber-500/20">
              <TabsTrigger
                value="holdings"
                className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300"
              >
                <Sun className="w-4 h-4 mr-2" />
                持仓截图
              </TabsTrigger>
              <TabsTrigger
                value="transactions"
                className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300"
              >
                <Moon className="w-4 h-4 mr-2" />
                交易记录
              </TabsTrigger>
            </TabsList>

            <TabsContent value="holdings" className="mt-0">
              <UploadZone
                images={images.filter((img) => img.type === 'holdings')}
                onFileSelect={handleFileSelect}
                onRemove={removeImage}
                fileInputRef={fileInputRef}
                title="上传持仓截图"
                description="支持支付宝证券持仓页面截图，包含证券名称、持仓数量、盈亏等信息"
              />
            </TabsContent>

            <TabsContent value="transactions" className="mt-0">
              <UploadZone
                images={images.filter((img) => img.type === 'transactions')}
                onFileSelect={handleFileSelect}
                onRemove={removeImage}
                fileInputRef={fileInputRef}
                title="上传交易记录"
                description="支持支付宝交易记录截图，包含买卖时间、股票、价格、数量等信息"
              />
            </TabsContent>
          </Tabs>

          {/* All Images Preview */}
          {images.length > 0 && (
            <div className="mt-8 animate-fade-in-up">
              <h3 className="text-amber-300/80 text-sm font-medium mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                已上传的图片 ({images.length})
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {images.map((img, index) => (
                  <div
                    key={img.id}
                    className="relative group aspect-square rounded-lg overflow-hidden border border-amber-500/20"
                  >
                    <img
                      src={img.preview}
                      alt={`上传的图片 ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button
                        onClick={() => removeImage(img.id)}
                        className="p-2 bg-red-500/80 rounded-full hover:bg-red-500 transition-colors"
                      >
                        <X className="w-4 h-4 text-white" />
                      </button>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-2 py-1">
                      <span className="text-xs text-amber-300/80">
                        {img.type === 'holdings' ? '持仓' : '交易'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Analyze Button */}
          {images.length > 0 && (
            <div className="mt-10 text-center animate-fade-in-up">
              <Button
                onClick={handleAnalyze}
                size="lg"
                className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-purple-950 font-semibold px-8 py-6 text-lg rounded-xl shadow-lg shadow-amber-500/20 animate-glow"
              >
                <Sparkles className="w-5 h-5 mr-2" />
                开始分析我的交易人格
                <ChevronRight className="w-5 h-5 ml-2" />
              </Button>
              <p className="text-purple-300/50 text-sm mt-4">
                {getAnalysisDurationHint(images.length)}
              </p>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="text-center mt-12 text-purple-300/40 text-sm">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Stars className="w-4 h-4" />
            <span>星辰指引你的投资之路</span>
            <Stars className="w-4 h-4" />
          </div>
          <p>上传的数据仅用于分析，不会被存储</p>
        </footer>
      </div>
    </div>
  );
}

interface UploadZoneProps {
  images: UploadedImage[];
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (id: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  title: string;
  description: string;
}

function UploadZone({
  images,
  onFileSelect,
  fileInputRef,
  title,
  description,
}: UploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0 && fileInputRef.current) {
      const dataTransfer = new DataTransfer();
      Array.from(files).forEach((file) => dataTransfer.items.add(file));
      fileInputRef.current.files = dataTransfer.files;
      
      const event = new Event('change', { bubbles: true }) as unknown as React.ChangeEvent<HTMLInputElement>;
      Object.defineProperty(event, 'target', {
        value: fileInputRef.current,
        writable: false,
      });
      onFileSelect(event);
    }
  };

  return (
    <div className="mystical-card rounded-2xl p-6 md:p-8">
      <div className="text-center mb-6">
        <h3 className="text-xl font-semibold gold-text mb-2">{title}</h3>
        <p className="text-purple-300/60 text-sm">{description}</p>
      </div>

      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`upload-zone rounded-xl p-8 text-center cursor-pointer transition-all ${
          isDragOver ? 'dragover' : ''
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onFileSelect}
          className="hidden"
        />
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-amber-400" />
          </div>
          <div>
            <p className="text-amber-200/80 font-medium mb-1">
              点击或拖拽图片到这里
            </p>
            <p className="text-purple-300/50 text-sm">
              支持 JPG、PNG 格式，可上传多张
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
          >
            <Upload className="w-4 h-4 mr-2" />
            选择文件
          </Button>
        </div>
      </div>

      {/* Preview for current tab */}
      {images.length > 0 && (
        <div className="mt-6">
          <p className="text-amber-300/60 text-sm mb-3">当前标签页已上传 ({images.length})</p>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
            {images.map((img) => (
              <div
                key={img.id}
                className="relative aspect-square rounded-lg overflow-hidden border border-amber-500/20"
              >
                <img
                  src={img.preview}
                  alt="预览"
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
