'use client'

/**
 * 로딩 애니메이션 컴포넌트들
 * - PrayingHandsIcon: 기도손 SVG 아이콘
 * - WaveText: 물결 텍스트 애니메이션
 * - PrayingHandsLoader: 기도손 + 물결 텍스트 조합
 */

// 기도손 SVG 아이콘
export function PrayingHandsIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* 왼손 */}
      <path
        d="M8 20V12C8 10.5 7 9 5.5 9C4 9 3 10.5 3 12V16C3 18.5 4.5 21 8 21"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-pray-left"
      />
      {/* 오른손 */}
      <path
        d="M16 20V12C16 10.5 17 9 18.5 9C20 9 21 10.5 21 12V16C21 18.5 19.5 21 16 21"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-pray-right"
      />
      {/* 손가락들 */}
      <path
        d="M8 12L10 6C10.3 5 10.7 4 12 4C13.3 4 13.7 5 14 6L16 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 빛 효과 */}
      <path
        d="M12 1V2M6 3L7 4M18 3L17 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="animate-glow"
      />
    </svg>
  )
}

// 물결 텍스트 애니메이션 컴포넌트
export function WaveText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`inline-flex ${className}`}>
      {text.split('').map((char, index) => (
        <span
          key={index}
          className="animate-wave inline-block"
          style={{
            animationDelay: `${index * 0.05}s`,
            whiteSpace: char === ' ' ? 'pre' : 'normal'
          }}
        >
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
    </span>
  )
}

// 기도손 로더 컴포넌트
export function PrayingHandsLoader({
  className = '',
  message = '말씀을 찾고 있습니다...',
  iconClassName = 'w-6 h-6 text-amber-600',
  textClassName = 'text-sm text-amber-600 font-medium'
}: {
  className?: string
  message?: string
  iconClassName?: string
  textClassName?: string
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <PrayingHandsIcon className={iconClassName} />
      <WaveText text={message} className={textClassName} />
    </div>
  )
}
