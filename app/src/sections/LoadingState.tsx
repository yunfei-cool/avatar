import { useEffect, useState } from 'react';
import { Sparkles, Stars, Moon, Loader2 } from 'lucide-react';

const loadingMessages = [
  '正在解读星辰的指引...',
  '解析你的交易轨迹...',
  '占卜你的投资命运...',
  '绘制你的财富星盘...',
  '聆听宇宙的启示...',
  '计算你的交易能量...',
  '揭示你的投资人格...',
];

export function LoadingState() {
  const [messageIndex, setMessageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const messageInterval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % loadingMessages.length);
    }, 2000);

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) return 0;
        return prev + 2;
      });
    }, 100);

    return () => {
      clearInterval(messageInterval);
      clearInterval(progressInterval);
    };
  }, []);

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center">
      {/* Animated Background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-950 via-purple-900 to-indigo-950" />
        
        {/* Floating Orbs */}
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 right-1/3 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />

        {/* Stars */}
        {[...Array(50)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-white rounded-full animate-star-twinkle"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 2}s`,
              opacity: Math.random() * 0.5 + 0.2,
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 text-center px-4">
        {/* Central Icon */}
        <div className="relative w-32 h-32 mx-auto mb-8">
          <div className="absolute inset-0 border-2 border-amber-500/30 rounded-full animate-rotate-slow" />
          <div className="absolute inset-2 border border-purple-500/30 rounded-full animate-rotate-slow" style={{ animationDirection: 'reverse', animationDuration: '15s' }} />
          <div className="absolute inset-4 border border-indigo-500/20 rounded-full animate-rotate-slow" style={{ animationDuration: '25s' }} />
          
          <div className="absolute inset-0 flex items-center justify-center">
            <Sparkles className="w-12 h-12 text-amber-400 animate-pulse" />
          </div>
          
          {/* Orbiting Elements */}
          <div className="absolute inset-0 animate-rotate-slow" style={{ animationDuration: '8s' }}>
            <div className="absolute -top-2 left-1/2 -translate-x-1/2">
              <Stars className="w-4 h-4 text-purple-400" />
            </div>
          </div>
          <div className="absolute inset-0 animate-rotate-slow" style={{ animationDuration: '12s', animationDirection: 'reverse' }}>
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
              <Moon className="w-4 h-4 text-indigo-400" />
            </div>
          </div>
        </div>

        {/* Loading Text */}
        <h2 className="text-2xl md:text-3xl font-bold gold-text mb-4">
          正在占卜你的交易命运
        </h2>
        
        <p className="text-purple-200/70 text-lg mb-8 min-h-[1.75rem]">
          {loadingMessages[messageIndex]}
        </p>

        {/* Progress Bar */}
        <div className="max-w-md mx-auto">
          <div className="h-1 bg-purple-800/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-center gap-2 mt-4 text-purple-300/50">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">请稍候，星辰正在诉说...</span>
          </div>
        </div>

        {/* Decorative Elements */}
        <div className="flex items-center justify-center gap-8 mt-12">
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
              <span className="text-amber-400 text-lg">✦</span>
            </div>
            <span className="text-xs text-purple-300/40">解析数据</span>
          </div>
          <div className="w-16 h-px bg-gradient-to-r from-amber-500/30 to-purple-500/30" />
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
              <span className="text-purple-400 text-lg">✧</span>
            </div>
            <span className="text-xs text-purple-300/40">分析人格</span>
          </div>
          <div className="w-16 h-px bg-gradient-to-r from-purple-500/30 to-indigo-500/30" />
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center">
              <span className="text-indigo-400 text-lg">✦</span>
            </div>
            <span className="text-xs text-purple-300/40">生成报告</span>
          </div>
        </div>
      </div>
    </div>
  );
}
