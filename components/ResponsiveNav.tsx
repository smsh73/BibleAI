'use client'

/**
 * 반응형 네비게이션 컴포넌트
 * - 데스크탑: 텍스트 링크
 * - 모바일: 아이콘만 표시
 * - 설교/신문/주보 메뉴: 관리자 인증 후에만 표시
 * - 관리 메뉴: 클릭 시 암호 모달 → 인증 후 숨긴 메뉴 표시 + 관리 페이지 이동
 */

import { useState, useEffect } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'

const ADMIN_PASSWORD = 'wnslaRpdudrhkd25@@'
const AUTH_KEY = 'bibleai_admin_auth'

export default function ResponsiveNav() {
  const { t } = useLanguage()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const auth = sessionStorage.getItem(AUTH_KEY)
    if (auth === 'true') {
      setIsAuthenticated(true)
    }
  }, [])

  const handleAdminClick = (e: React.MouseEvent) => {
    if (!isAuthenticated) {
      e.preventDefault()
      setShowPasswordModal(true)
      setPassword('')
      setError('')
    }
  }

  const handlePasswordSubmit = () => {
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true)
      sessionStorage.setItem(AUTH_KEY, 'true')
      setShowPasswordModal(false)
      setPassword('')
      setError('')
      window.location.href = '/admin'
    } else {
      setError('암호가 올바르지 않습니다.')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handlePasswordSubmit()
    } else if (e.key === 'Escape') {
      setShowPasswordModal(false)
    }
  }

  const publicNavItems = [
    {
      href: '/',
      label: t('common.home'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      )
    },
    {
      href: '/verse-map',
      label: t('common.verseMap'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
      )
    },
  ]

  const protectedNavItems = [
    {
      href: '/youtube',
      label: t('common.sermon'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )
    },
    {
      href: '/news',
      label: t('common.news'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
        </svg>
      )
    },
    {
      href: '/bulletin',
      label: t('common.bulletin'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )
    },
  ]

  const adminItem = {
    href: '/admin',
    label: t('common.admin'),
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )
  }

  // Build visible items list
  const visibleItems = [
    ...publicNavItems,
    ...(isAuthenticated ? protectedNavItems : []),
  ]

  return (
    <>
      <nav className="flex items-center gap-1 sm:gap-3 text-sm text-gray-600 font-medium">
        {visibleItems.map((item, idx) => (
          <span key={item.href} className="contents">
            <a
              href={item.href}
              className="hover:text-gray-900 p-1.5 sm:p-0 rounded-md sm:rounded-none hover:bg-gray-100 sm:hover:bg-transparent transition-colors"
              title={item.label}
            >
              <span className="hidden sm:inline hover:underline">{item.label}</span>
              <span className="sm:hidden">{item.icon}</span>
            </a>
            <span className="text-gray-300 hidden sm:inline">|</span>
          </span>
        ))}
        {/* 관리 메뉴 - 항상 표시, 미인증 시 암호 모달 */}
        <span className="contents">
          <a
            href={isAuthenticated ? '/admin' : '#'}
            onClick={handleAdminClick}
            className="hover:text-gray-900 p-1.5 sm:p-0 rounded-md sm:rounded-none hover:bg-gray-100 sm:hover:bg-transparent transition-colors"
            title={adminItem.label}
          >
            <span className="hidden sm:inline hover:underline">{adminItem.label}</span>
            <span className="sm:hidden">{adminItem.icon}</span>
          </a>
        </span>
      </nav>

      {/* 암호 입력 모달 */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowPasswordModal(false)}>
          <div
            className="bg-white rounded-xl shadow-2xl p-6 mx-4 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-800 mb-4">관리자 인증</h3>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError('') }}
              onKeyDown={handleKeyDown}
              placeholder="암호를 입력하세요"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-800"
              autoFocus
            />
            {error && (
              <p className="text-red-500 text-sm mt-2">{error}</p>
            )}
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowPasswordModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handlePasswordSubmit}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
