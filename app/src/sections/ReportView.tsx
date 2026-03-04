import { useRef } from 'react';
import { 
  Sparkles, 
  Stars, 
  Moon, 
  Sun, 
  ArrowLeft, 
  TrendingUp, 
  Target,
  Zap,
  Shield,
  AlertTriangle,
  Quote,
  Download,
  Share2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { AnalysisReport, TradeData } from '@/types';

interface ReportViewProps {
  report: AnalysisReport;
  tradeData: TradeData;
  onReset: () => void;
}

type Html2CanvasFn = (
  element: HTMLElement,
  options?: Record<string, unknown>
) => Promise<HTMLCanvasElement>;

declare global {
  interface Window {
    html2canvas?: Html2CanvasFn;
  }
}

const HTML2CANVAS_SCRIPT_CANDIDATES = [
  'https://cdn.bootcdn.net/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js',
];

let html2canvasLoadPromise: Promise<Html2CanvasFn> | null = null;

function loadHtml2Canvas(): Promise<Html2CanvasFn> {
  if (window.html2canvas) {
    return Promise.resolve(window.html2canvas);
  }

  if (html2canvasLoadPromise) {
    return html2canvasLoadPromise;
  }

  html2canvasLoadPromise = new Promise<Html2CanvasFn>((resolve, reject) => {
    const tryLoad = (index: number) => {
      if (index >= HTML2CANVAS_SCRIPT_CANDIDATES.length) {
        reject(new Error('截图引擎加载失败（CDN 不可用）'));
        return;
      }

      const src = HTML2CANVAS_SCRIPT_CANDIDATES[index];
      const existing = Array.from(
        document.querySelectorAll<HTMLScriptElement>('script[data-export-engine="html2canvas"]')
      ).find((node) => node.src === src);

      if (existing) {
        if (window.html2canvas) {
          resolve(window.html2canvas);
          return;
        }
        existing.addEventListener('load', () => {
          if (window.html2canvas) {
            resolve(window.html2canvas);
          } else {
            tryLoad(index + 1);
          }
        }, { once: true });
        existing.addEventListener('error', () => tryLoad(index + 1), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.exportEngine = 'html2canvas';
      script.onload = () => {
        if (window.html2canvas) {
          resolve(window.html2canvas);
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
    html2canvasLoadPromise = null;
    throw error;
  });

  return html2canvasLoadPromise;
}

function buildShareText(report: AnalysisReport, tradeData: TradeData): string {
  const profitRate = Number.isFinite(Number(tradeData?.summary?.profitRate))
    ? Number(tradeData.summary.profitRate)
    : 0;
  const holdingsCount = Array.isArray(tradeData?.holdings) ? tradeData.holdings.length : 0;
  const transactionsCount = Array.isArray(tradeData?.transactions) ? tradeData.transactions.length : 0;
  const archetype = report?.traderArchetype || '未知人格';
  const archetypeDescription = report?.archetypeDescription || '暂无描述';
  const advice = report?.advice || '暂无建议';

  return [
    `交易人格：${archetype}`,
    archetypeDescription,
    `总收益率：${profitRate > 0 ? '+' : ''}${profitRate.toFixed(2)}%`,
    `持仓数量：${holdingsCount}只`,
    `交易次数：${transactionsCount}笔`,
    `建议：${advice}`,
  ].join('\n');
}

function createTimestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${min}`;
}

export function ReportView({ report, tradeData, onReset }: ReportViewProps) {
  const reportRef = useRef<HTMLDivElement>(null);
  const profitRateValue = Number.isFinite(Number(tradeData?.summary?.profitRate))
    ? Number(tradeData.summary.profitRate)
    : 0;
  const holdingsCount = Array.isArray(tradeData?.holdings) ? tradeData.holdings.length : 0;
  const transactionsCount = Array.isArray(tradeData?.transactions) ? tradeData.transactions.length : 0;

  const personalityTraits = Array.isArray(report?.personalityTraits) ? report.personalityTraits : [];
  const tradingPatterns = Array.isArray(report?.tradingPatterns) ? report.tradingPatterns : [];
  const strengths = Array.isArray(report?.strengths) ? report.strengths : [];
  const weaknesses = Array.isArray(report?.weaknesses) ? report.weaknesses : [];

  const archetype = report?.traderArchetype || '未知人格';
  const archetypeDescription = report?.archetypeDescription || '暂无描述';
  const destinyPrediction = report?.destinyPrediction || '暂无预言';
  const advice = report?.advice || '暂无建议';
  const strengthWeaknessRows = Array.from(
    { length: Math.max(strengths.length, weaknesses.length) },
    (_, index) => ({
      index,
      strength: strengths[index],
      weakness: weaknesses[index],
    })
  );
  const personalityGridClass =
    personalityTraits.length <= 1
      ? 'grid md:grid-cols-1 gap-6 max-w-md mx-auto'
      : personalityTraits.length === 2
        ? 'grid md:grid-cols-2 gap-6 max-w-3xl mx-auto'
        : 'grid md:grid-cols-3 gap-6';

  const handleShare = async () => {
    const shareText = buildShareText(report, tradeData);
    try {
      if (navigator.share) {
        await navigator.share({
          title: `我的交易人格：${archetype}`,
          text: shareText,
        });
        toast.success('分享面板已打开');
      } else {
        await navigator.clipboard.writeText(shareText);
        toast.success('报告摘要已复制到剪贴板');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error('Share error:', error);
      toast.error('分享失败，请稍后重试');
    }
  };

  const handleDownload = async () => {
    try {
      const target = reportRef.current;
      if (!target) {
        throw new Error('报告区域不可用');
      }

      const width = target.scrollWidth;
      const height = target.scrollHeight;
      const maxPixels = 60_000_000;
      const preferredScale = Math.max(2.5, window.devicePixelRatio || 1);
      const safeScale = Math.sqrt(maxPixels / Math.max(1, width * height));
      const scale = Math.max(1, Math.min(3, preferredScale, safeScale));

      toast.info('正在生成报告图片...');
      if (document.fonts?.status !== 'loaded') {
        await document.fonts.ready;
      }
      const html2canvas = await loadHtml2Canvas();
      const renderOptions = {
        backgroundColor: '#1b0b3a',
        scale,
        useCORS: true,
        logging: false,
        windowWidth: width,
        windowHeight: height,
        width,
        height,
        scrollX: 0,
        scrollY: 0,
        ignoreElements: (element: Element) =>
          element instanceof HTMLElement && element.dataset.exportIgnore === 'true',
        onclone: (clonedDocument: Document) => {
          clonedDocument.documentElement.classList.add('report-export-mode');
        },
      } as const;

      let canvas: HTMLCanvasElement;
      try {
        canvas = await html2canvas(target, {
          ...renderOptions,
          foreignObjectRendering: true,
        });
      } catch {
        canvas = await html2canvas(target, {
          ...renderOptions,
          foreignObjectRendering: false,
        });
      }

      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `交易人格报告_${createTimestamp()}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('报告图片已下载');
    } catch (error) {
      console.error('Download error:', error);
      toast.error(`下载失败：${error instanceof Error ? error.message : '请稍后重试'}`);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-950 via-purple-900 to-indigo-950" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
      </div>

      {/* Content */}
      <div ref={reportRef} className="relative z-10">
        {/* Header */}
        <header
          data-export-ignore="true"
          className="sticky top-0 z-50 bg-purple-950/80 backdrop-blur-md border-b border-amber-500/10"
        >
          <div className="container mx-auto px-4 py-4 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="text-purple-300 hover:text-amber-300 hover:bg-amber-500/10"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              重新分析
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleShare}
                className="text-purple-300 hover:text-amber-300 hover:bg-amber-500/10"
              >
                <Share2 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDownload}
                className="text-purple-300 hover:text-amber-300 hover:bg-amber-500/10"
              >
                <Download className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </header>

        {/* Report Content */}
        <main className="container mx-auto px-4 py-8 max-w-4xl">
          {/* Hero Section */}
          <section className="text-center mb-12 animate-fade-in-up">
            <div className="report-hero-top flex flex-col items-center mb-6">
              <div className="report-hero-badge inline-flex h-11 items-center justify-center gap-2 px-5 rounded-full bg-amber-500/10 border border-amber-500/20 mb-4">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="report-hero-badge-text text-amber-300 text-sm leading-none">交易人格鉴定书</span>
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
              </div>

              <div className="report-hero-logo-wrap relative flex items-center justify-center w-24 h-24">
                <div className="report-hero-logo-glow absolute inset-0 bg-gradient-to-r from-amber-500 via-purple-500 to-amber-500 rounded-full blur-xl opacity-30 animate-pulse" />
                <div className="report-hero-logo relative w-24 h-24 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
                  <span className="report-hero-symbol block text-[2.6rem] leading-none select-none">
                    {getArchetypeEmoji(archetype)}
                  </span>
                </div>
              </div>
            </div>

            <h1 className="text-4xl md:text-5xl font-bold gold-text mb-4">
              {archetype}
            </h1>
            
            <p className="text-purple-200/80 text-lg max-w-2xl mx-auto leading-relaxed">
              {archetypeDescription}
            </p>

            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto mt-8">
              <StatCard
                icon={<TrendingUp className="w-5 h-5" />}
                label="总收益率"
                value={`${profitRateValue > 0 ? '+' : ''}${profitRateValue.toFixed(2)}%`}
                positive={profitRateValue >= 0}
              />
              <StatCard
                icon={<Target className="w-5 h-5" />}
                label="持仓数量"
                value={`${holdingsCount}只`}
              />
              <StatCard
                icon={<Zap className="w-5 h-5" />}
                label="交易次数"
                value={`${transactionsCount}笔`}
              />
            </div>
          </section>

          <div className="mystical-divider" />

          {/* Personality Traits */}
          <section className="mb-12 animate-fade-in-up">
            <SectionHeader
              icon={<Stars className="w-6 h-6" />}
              title="人格特质"
              subtitle="星辰揭示了你的交易性格"
            />
            
            <div className={personalityGridClass}>
              {personalityTraits.map((trait, index) => (
                <TraitCard
                  key={index}
                  trait={trait.trait}
                  description={trait.description}
                  evidence={trait.evidence}
                  index={index}
                />
              ))}
            </div>
          </section>

          {/* Trading Patterns */}
          <section className="mb-12 animate-fade-in-up">
            <SectionHeader
              icon={<Moon className="w-6 h-6" />}
              title="交易模式"
              subtitle="宇宙规律在你的操作中显现"
            />
            
            <div className="space-y-4">
              {tradingPatterns.map((pattern, index) => (
                <PatternCard
                  key={index}
                  pattern={pattern.pattern}
                  description={pattern.description}
                  evidence={pattern.evidence}
                />
              ))}
            </div>
          </section>

          {/* Strengths & Weaknesses */}
          <section className="mb-12 animate-fade-in-up">
            <div className="grid md:grid-cols-2 gap-8 mb-4">
              <SectionHeader
                icon={<Shield className="w-6 h-6 text-emerald-400" />}
                title="天赋优势"
                subtitle="你的交易超能力"
              />
              <SectionHeader
                icon={<AlertTriangle className="w-6 h-6 text-amber-400" />}
                title="成长空间"
                subtitle="需要警惕的盲点"
              />
            </div>

            <div className="space-y-4">
              {strengthWeaknessRows.map((row) => (
                <div key={row.index} className="grid md:grid-cols-2 gap-8 items-stretch">
                  {row.strength ? (
                    <StrengthCard
                      strength={row.strength.strength}
                      description={row.strength.description}
                      evidence={row.strength.evidence}
                    />
                  ) : (
                    <div className="hidden md:block" aria-hidden="true" />
                  )}
                  {row.weakness ? (
                    <WeaknessCard
                      weakness={row.weakness.weakness}
                      description={row.weakness.description}
                      evidence={row.weakness.evidence}
                    />
                  ) : (
                    <div className="hidden md:block" aria-hidden="true" />
                  )}
                </div>
              ))}
            </div>
          </section>

          <div className="mystical-divider" />

          {/* Destiny Prediction */}
          <section className="mb-12 animate-fade-in-up">
            <SectionHeader
              icon={<Sun className="w-6 h-6" />}
              title="命运预言"
              subtitle="星象指引的未来"
            />
            
            <div className="tarot-card relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl" />
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl" />
              
              <div className="relative">
                <Quote className="w-8 h-8 text-amber-400/40 mb-4" />
                <p className="text-purple-100/90 text-lg leading-relaxed italic">
                  {destinyPrediction}
                </p>
                <Quote className="w-8 h-8 text-amber-400/40 mt-4 ml-auto rotate-180" />
              </div>
            </div>
          </section>

          {/* Advice */}
          <section className="mb-12 animate-fade-in-up">
            <SectionHeader
              icon={<Sparkles className="w-6 h-6" />}
              title="星辰建议"
              subtitle="宇宙给你的启示"
            />
            
            <div className="mystical-card rounded-2xl p-8">
              <p className="text-purple-100/90 text-lg leading-relaxed">
                {advice}
              </p>
            </div>
          </section>

          {/* Footer */}
          <footer className="text-center py-8">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Stars className="w-5 h-5 text-amber-400" />
              <Sparkles className="w-4 h-4 text-purple-400" />
              <Stars className="w-5 h-5 text-amber-400" />
            </div>
            <p className="text-purple-300/50 text-sm">
              愿星辰指引你的投资之路
            </p>
            <p className="text-purple-300/30 text-xs mt-2">
              本分析仅供娱乐，不构成投资建议
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}

// Helper Components

function SectionHeader({ 
  icon, 
  title, 
  subtitle 
}: { 
  icon: React.ReactNode; 
  title: string; 
  subtitle: string;
}) {
  return (
    <div className="text-center mb-8">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 mb-4">
        <span className="text-amber-400">{icon}</span>
      </div>
      <h2 className="text-2xl font-bold gold-text mb-2">{title}</h2>
      <p className="text-purple-300/60 text-sm">{subtitle}</p>
    </div>
  );
}

function StatCard({ 
  icon, 
  label, 
  value, 
  positive 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="mystical-card rounded-xl p-4 text-center">
      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-full mb-2 ${
        positive === undefined 
          ? 'bg-purple-500/10 text-purple-400' 
          : positive 
            ? 'bg-emerald-500/10 text-emerald-400' 
            : 'bg-red-500/10 text-red-400'
      }`}>
        {icon}
      </div>
      <div className={`text-xl font-bold ${
        positive === undefined 
          ? 'text-purple-200' 
          : positive 
            ? 'text-emerald-400' 
            : 'text-red-400'
      }`}>
        {value}
      </div>
      <div className="text-purple-300/50 text-xs mt-1">{label}</div>
    </div>
  );
}

function TraitCard({ 
  trait, 
  description, 
  evidence,
  index 
}: { 
  trait: string; 
  description: string; 
  evidence?: string;
  index: number;
}) {
  const icons = ['✦', '✧', '✦'];
  return (
    <div className="tarot-card h-full">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl text-amber-400">{icons[index % icons.length]}</span>
        <h3 className="text-lg font-semibold gold-text">{trait}</h3>
      </div>
      <p className="text-purple-200/80 text-sm leading-relaxed mb-4">
        {description}
      </p>
      {evidence ? (
        <p className="text-[11px] leading-relaxed text-purple-200/55 whitespace-pre-wrap break-words border-l border-amber-500/25 pl-3">
          证据：{evidence}
        </p>
      ) : null}
    </div>
  );
}

function PatternCard({ 
  pattern, 
  description,
  evidence
}: { 
  pattern: string; 
  description: string; 
  evidence?: string;
}) {
  return (
    <div className="mystical-card rounded-xl p-6">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
          <TrendingUp className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold gold-text mb-2">{pattern}</h3>
          <p className="text-purple-200/80 text-sm leading-relaxed">
            {description}
          </p>
          {evidence ? (
            <p className="mt-3 text-[11px] leading-relaxed text-purple-200/55 whitespace-pre-wrap break-words border-l border-amber-500/25 pl-3">
              证据：{evidence}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StrengthCard({ 
  strength, 
  description,
  evidence
}: { 
  strength: string; 
  description: string; 
  evidence?: string;
}) {
  return (
    <div className="h-full flex items-start gap-3 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
      <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-emerald-400 text-xs">✓</span>
      </div>
      <div>
        <h4 className="text-emerald-300 font-medium mb-1">{strength}</h4>
        <p className="text-purple-200/70 text-sm">{description}</p>
        {evidence ? (
          <p className="mt-2 text-[11px] leading-relaxed text-purple-200/55 whitespace-pre-wrap break-words border-l border-emerald-500/25 pl-3">
            证据：{evidence}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function WeaknessCard({ 
  weakness, 
  description,
  evidence
}: { 
  weakness: string; 
  description: string; 
  evidence?: string;
}) {
  return (
    <div className="h-full flex items-start gap-3 p-4 rounded-lg bg-amber-500/5 border border-amber-500/20">
      <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-amber-400 text-xs">!</span>
      </div>
      <div>
        <h4 className="text-amber-300 font-medium mb-1">{weakness}</h4>
        <p className="text-purple-200/70 text-sm">{description}</p>
        {evidence ? (
          <p className="mt-2 text-[11px] leading-relaxed text-purple-200/55 whitespace-pre-wrap break-words border-l border-amber-500/25 pl-3">
            证据：{evidence}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function getArchetypeEmoji(archetype: string): string {
  const emojiMap: Record<string, string> = {
    '天蝎猎手': '🦂',
    '狮子王者': '🦁',
    '双子游侠': '♊',
    '金牛守护者': '🐂',
    '水瓶先知': '♒',
  };
  return emojiMap[archetype] || '✨';
}
