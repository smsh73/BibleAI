'use client'

/**
 * 공통 페이지 레이아웃 컴포넌트
 * 모든 페이지에서 일관된 테마와 네비게이션 제공
 */

import Link from 'next/link'
import { ReactNode } from 'react'

interface PageLayoutProps {
  children: ReactNode
  title: string
  subtitle?: string
  currentPage?: 'home' | 'admin' | 'news' | 'youtube' | 'verse-map' | 'bulletin'
  showBackButton?: boolean
  headerColor?: 'amber' | 'indigo' | 'purple' | 'blue'
}

export default function PageLayout({
  children,
  title,
  subtitle,
  currentPage,
  showBackButton = true,
  headerColor = 'amber'
}: PageLayoutProps) {
  const colorClasses = {
    amber: {
      bg: 'bg-gradient-to-b from-amber-50 to-orange-50',
      header: 'bg-amber-600',
      headerHover: 'hover:bg-amber-700',
      text: 'text-amber-900',
      textLight: 'text-amber-700',
      border: 'border-amber-200',
      accent: 'bg-amber-100 text-amber-800'
    },
    indigo: {
      bg: 'bg-gradient-to-br from-indigo-50 via-white to-purple-50',
      header: 'bg-indigo-600',
      headerHover: 'hover:bg-indigo-700',
      text: 'text-indigo-900',
      textLight: 'text-indigo-700',
      border: 'border-indigo-200',
      accent: 'bg-indigo-100 text-indigo-800'
    },
    purple: {
      bg: 'bg-gradient-to-br from-purple-50 via-white to-indigo-50',
      header: 'bg-purple-600',
      headerHover: 'hover:bg-purple-700',
      text: 'text-purple-900',
      textLight: 'text-purple-700',
      border: 'border-purple-200',
      accent: 'bg-purple-100 text-purple-800'
    },
    blue: {
      bg: 'bg-gradient-to-br from-blue-50 via-white to-cyan-50',
      header: 'bg-blue-600',
      headerHover: 'hover:bg-blue-700',
      text: 'text-blue-900',
      textLight: 'text-blue-700',
      border: 'border-blue-200',
      accent: 'bg-blue-100 text-blue-800'
    }
  }

  const colors = colorClasses[headerColor]

  const navItems = [
    { href: '/', label: '홈', page: 'home' },
    { href: '/verse-map', label: '성경지도', page: 'verse-map' },
    { href: '/youtube', label: '설교', page: 'youtube' },
    { href: '/news', label: '신문', page: 'news' },
    { href: '/bulletin', label: '주보', page: 'bulletin' },
    { href: '/admin', label: '관리', page: 'admin' }
  ]

  return (
    <div className={`min-h-screen ${colors.bg}`}>
      {/* 헤더 */}
      <header className={`${colors.header} text-white shadow-lg`}>
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* 로고 및 제목 */}
            <div className="flex items-center gap-4">
              {showBackButton && currentPage !== 'home' && (
                <Link
                  href="/"
                  className={`p-2 rounded-full ${colors.headerHover} transition-colors`}
                  title="홈으로"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </Link>
              )}
              <div>
                <h1 className="text-xl font-bold">{title}</h1>
                {subtitle && (
                  <p className="text-sm opacity-80">{subtitle}</p>
                )}
              </div>
            </div>

            {/* 네비게이션 */}
            <nav className="flex items-center gap-1">
              {navItems.map((item, idx) => (
                <span key={item.page} className="flex items-center">
                  <Link
                    href={item.href}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      currentPage === item.page
                        ? 'bg-white/20'
                        : 'hover:bg-white/10'
                    }`}
                  >
                    {item.label}
                  </Link>
                  {idx < navItems.length - 1 && (
                    <span className="text-white/30 mx-1">|</span>
                  )}
                </span>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {children}
      </main>

      {/* 푸터 */}
      <footer className="border-t border-gray-200 bg-white/50 mt-auto">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>BibleAI - 성경 상담 및 교회 소식</span>
            <Link href="/" className={`${colors.textLight} hover:underline`}>
              메인으로 돌아가기
            </Link>
          </div>
        </div>
      </footer>

      {/* 전역 스타일 */}
      <style jsx global>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slide-up {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fade-in {
          animation: fade-in 0.5s ease-out forwards;
        }

        .animate-slide-up {
          animation: slide-up 0.3s ease-out forwards;
        }

        .overflow-y-auto::-webkit-scrollbar {
          width: 6px;
        }

        .overflow-y-auto::-webkit-scrollbar-track {
          background: transparent;
        }

        .overflow-y-auto::-webkit-scrollbar-thumb {
          background: rgba(100, 100, 100, 0.2);
          border-radius: 3px;
        }

        .overflow-y-auto::-webkit-scrollbar-thumb:hover {
          background: rgba(100, 100, 100, 0.4);
        }
      `}</style>
    </div>
  )
}

/**
 * 공통 카드 컴포넌트
 */
export function Card({
  children,
  title,
  className = '',
  headerColor = 'amber'
}: {
  children: ReactNode
  title?: string
  className?: string
  headerColor?: 'amber' | 'indigo' | 'purple' | 'blue'
}) {
  const borderColors = {
    amber: 'border-amber-100',
    indigo: 'border-indigo-100',
    purple: 'border-purple-100',
    blue: 'border-blue-100'
  }

  const titleColors = {
    amber: 'text-amber-900',
    indigo: 'text-indigo-900',
    purple: 'text-purple-900',
    blue: 'text-blue-900'
  }

  return (
    <div className={`bg-white rounded-xl shadow-sm border ${borderColors[headerColor]} ${className}`}>
      {title && (
        <div className={`px-5 py-3 border-b ${borderColors[headerColor]}`}>
          <h2 className={`font-semibold ${titleColors[headerColor]}`}>{title}</h2>
        </div>
      )}
      <div className="p-5">
        {children}
      </div>
    </div>
  )
}

/**
 * 공통 버튼 컴포넌트
 */
export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'md',
  disabled = false,
  className = '',
  color = 'amber'
}: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  className?: string
  color?: 'amber' | 'indigo' | 'purple' | 'blue'
}) {
  const colorClasses = {
    amber: {
      primary: 'bg-amber-600 hover:bg-amber-700 text-white',
      secondary: 'bg-amber-100 hover:bg-amber-200 text-amber-800',
      ghost: 'text-amber-700 hover:bg-amber-50'
    },
    indigo: {
      primary: 'bg-indigo-600 hover:bg-indigo-700 text-white',
      secondary: 'bg-indigo-100 hover:bg-indigo-200 text-indigo-800',
      ghost: 'text-indigo-700 hover:bg-indigo-50'
    },
    purple: {
      primary: 'bg-purple-600 hover:bg-purple-700 text-white',
      secondary: 'bg-purple-100 hover:bg-purple-200 text-purple-800',
      ghost: 'text-purple-700 hover:bg-purple-50'
    },
    blue: {
      primary: 'bg-blue-600 hover:bg-blue-700 text-white',
      secondary: 'bg-blue-100 hover:bg-blue-200 text-blue-800',
      ghost: 'text-blue-700 hover:bg-blue-50'
    }
  }

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg'
  }

  const variantClasses = variant === 'danger'
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : colorClasses[color][variant]

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`
        ${sizeClasses[size]}
        ${variantClasses}
        rounded-lg font-medium transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed
        ${className}
      `}
    >
      {children}
    </button>
  )
}
