'use client'

/**
 * 다국어 지원 Context
 * - 언어 상태 전역 관리
 * - 성경 버전에 따른 자동 언어 전환
 * - localStorage로 언어 설정 저장
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import koTranslations from '@/locales/ko.json'
import enTranslations from '@/locales/en.json'

export type Language = 'ko' | 'en'

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string) => string
  setLanguageByBibleVersion: (versionId: string) => void
}

const translations: Record<Language, typeof koTranslations> = {
  ko: koTranslations,
  en: enTranslations
}

// 성경 버전 → 언어 매핑
const VERSION_LANGUAGE_MAP: Record<string, Language> = {
  'GAE': 'ko',  // 개역개정
  'KRV': 'ko',  // 개역한글
  'NIV': 'en',  // New International Version
  'ESV': 'en',  // English Standard Version
  'KJV': 'en',  // King James Version
  'NASB': 'en', // New American Standard Bible
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('ko')
  const [isInitialized, setIsInitialized] = useState(false)

  // 초기 언어 설정 로드
  useEffect(() => {
    const savedLanguage = localStorage.getItem('language') as Language
    if (savedLanguage && (savedLanguage === 'ko' || savedLanguage === 'en')) {
      setLanguageState(savedLanguage)
    }
    setIsInitialized(true)
  }, [])

  // 언어 변경 함수
  const setLanguage = (lang: Language) => {
    setLanguageState(lang)
    localStorage.setItem('language', lang)
  }

  // 성경 버전에 따른 언어 자동 설정
  const setLanguageByBibleVersion = (versionId: string) => {
    const lang = VERSION_LANGUAGE_MAP[versionId] || 'ko'
    setLanguage(lang)
  }

  // 번역 함수 (중첩 키 지원: "bible.greeting")
  const t = (key: string): string => {
    const keys = key.split('.')
    let value: any = translations[language]

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k]
      } else {
        // 키를 찾지 못하면 키 자체를 반환
        console.warn(`Translation not found for key: ${key}`)
        return key
      }
    }

    return typeof value === 'string' ? value : key
  }

  // SSR 호환을 위해 초기화 전에는 기본값 사용
  if (!isInitialized) {
    return (
      <LanguageContext.Provider value={{
        language: 'ko',
        setLanguage: () => {},
        t: (key: string) => {
          const keys = key.split('.')
          let value: any = translations['ko']
          for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
              value = value[k]
            } else {
              return key
            }
          }
          return typeof value === 'string' ? value : key
        },
        setLanguageByBibleVersion: () => {}
      }}>
        {children}
      </LanguageContext.Provider>
    )
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, setLanguageByBibleVersion }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
