'use client'

/**
 * 관리자 페이지
 * - API 키 관리
 * - 성경 버전 관리 (크롤링/추출)
 * - 데이터 초기화
 */

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { AIProvider } from '@/types'

interface ApiKeyData {
  id: string
  provider: AIProvider
  keyPreview: string
  isActive: boolean
  priority: number
}

interface BibleVersion {
  id: string
  name_korean: string
  name_english?: string
  language: string
  is_default: boolean
  is_active: boolean
  source_url?: string
  verse_count?: number
  embedded_count?: number
}

interface DataStats {
  newsIssues: number
  newsChunks: number
  newsEmbedded: number
  bibleVerses: number
  bibleEmbedded: number
  sermons: number
  sermonChunks: number
  bulletinIssues: number
  bulletinChunks: number
  verseRelations: number
  verseThemes: number
  relationTypeCount: Record<string, number>
}

const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)',
  perplexity: 'Perplexity',
  youtube: 'YouTube API'
}

type TabType = 'api-keys' | 'bible' | 'data'

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabType>('api-keys')

  // API 키 상태
  const [apiKeys, setApiKeys] = useState<ApiKeyData[]>([])
  const [apiLoading, setApiLoading] = useState(true)
  const [editing, setEditing] = useState<AIProvider | null>(null)
  const [formData, setFormData] = useState({
    provider: 'openai' as AIProvider,
    key: '',
    isActive: true,
    priority: 0
  })

  // 성경 버전 상태
  const [bibleVersions, setBibleVersions] = useState<BibleVersion[]>([])
  const [bibleLoading, setBibleLoading] = useState(false)
  const [extracting, setExtracting] = useState<string | null>(null)
  const [extractProgress, setExtractProgress] = useState('')

  // 데이터 통계
  const [dataStats, setDataStats] = useState<DataStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  // API 키 목록 로드
  useEffect(() => {
    fetchApiKeys()
  }, [])

  // 성경 버전 및 통계 로드
  useEffect(() => {
    if (activeTab === 'bible') {
      fetchBibleVersions()
    } else if (activeTab === 'data') {
      fetchDataStats()
    }
  }, [activeTab])

  async function fetchApiKeys() {
    try {
      const res = await fetch('/api/admin/api-keys')
      const data = await res.json()
      setApiKeys(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Failed to fetch API keys:', error)
      setApiKeys([])
    } finally {
      setApiLoading(false)
    }
  }

  async function fetchBibleVersions() {
    setBibleLoading(true)
    try {
      const res = await fetch('/api/bible/versions')
      const data = await res.json()
      if (data.success) {
        setBibleVersions(data.versions || [])
      }
    } catch (error) {
      console.error('Failed to fetch Bible versions:', error)
    } finally {
      setBibleLoading(false)
    }
  }

  async function fetchDataStats() {
    setStatsLoading(true)
    try {
      const res = await fetch('/api/admin/stats')
      const data = await res.json()
      if (data.success) {
        setDataStats(data.stats)
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    } finally {
      setStatsLoading(false)
    }
  }

  async function handleApiSubmit(e: React.FormEvent) {
    e.preventDefault()

    try {
      const res = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })

      if (res.ok) {
        alert('API 키가 저장되었습니다.')
        setFormData({ provider: 'openai', key: '', isActive: true, priority: 0 })
        setEditing(null)
        fetchApiKeys()
      } else {
        alert('저장 실패')
      }
    } catch (error) {
      console.error('Save error:', error)
      alert('저장 중 오류 발생')
    }
  }

  async function handleApiDelete(provider: AIProvider) {
    if (!confirm(`${PROVIDER_LABELS[provider]} API 키를 삭제하시겠습니까?`)) return

    try {
      const res = await fetch(`/api/admin/api-keys?provider=${provider}`, {
        method: 'DELETE'
      })

      if (res.ok) {
        alert('삭제되었습니다.')
        fetchApiKeys()
      }
    } catch (error) {
      console.error('Delete error:', error)
    }
  }

  async function handleBibleExtract(versionId: string) {
    if (!confirm(`${versionId} 버전 성경을 추출하시겠습니까?\n시간이 오래 걸릴 수 있습니다.`)) return

    setExtracting(versionId)
    setExtractProgress('추출 시작...')

    try {
      const res = await fetch('/api/bible/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: versionId })
      })

      const data = await res.json()
      if (data.success) {
        setExtractProgress(`완료: ${data.verseCount}개 구절 추출`)
        fetchBibleVersions()
      } else {
        setExtractProgress(`오류: ${data.error}`)
      }
    } catch (error: any) {
      setExtractProgress(`오류: ${error.message}`)
    } finally {
      setTimeout(() => {
        setExtracting(null)
        setExtractProgress('')
      }, 3000)
    }
  }

  async function handleBibleEmbed(versionId: string) {
    if (!confirm(`${versionId} 버전 임베딩을 생성하시겠습니까?\nAPI 비용이 발생합니다.`)) return

    setExtracting(versionId)
    setExtractProgress('임베딩 시작...')

    try {
      const res = await fetch('/api/bible/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: versionId })
      })

      const data = await res.json()
      if (data.success) {
        setExtractProgress(`완료: ${data.embeddedCount}개 임베딩 생성`)
        fetchBibleVersions()
      } else {
        setExtractProgress(`오류: ${data.error}`)
      }
    } catch (error: any) {
      setExtractProgress(`오류: ${error.message}`)
    } finally {
      setTimeout(() => {
        setExtracting(null)
        setExtractProgress('')
      }, 3000)
    }
  }

  async function handleDataReset(type: 'news' | 'bible' | 'sermons' | 'bulletin' | 'all') {
    const messages = {
      news: '뉴스 데이터(기사, 청크, 임베딩)를 모두 삭제하시겠습니까?',
      bible: '성경 임베딩을 모두 삭제하시겠습니까? (구절 텍스트는 유지)',
      sermons: '설교 데이터를 모두 삭제하시겠습니까?',
      bulletin: '주보 데이터(주보, 섹션, 청크)를 모두 삭제하시겠습니까?',
      all: '모든 데이터를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다!'
    }

    if (!confirm(messages[type])) return

    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      })

      const data = await res.json()
      if (data.success) {
        alert('초기화 완료')
        fetchDataStats()
        if (type === 'bible' || type === 'all') {
          fetchBibleVersions()
        }
      } else {
        alert(`오류: ${data.error}`)
      }
    } catch (error: any) {
      alert(`오류: ${error.message}`)
    }
  }

  return (
    <div className="relative flex flex-col min-h-screen overflow-hidden">
      {/* 배경 */}
      <div className="absolute inset-0 bg-white" />
      <div className="absolute inset-0 bg-gradient-to-br from-amber-50 via-white to-orange-50" />

      {/* 헤더 */}
      <header className="relative z-10 flex-shrink-0 px-4 py-2 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h1 className="text-lg font-semibold text-amber-900">관리자</h1>
            </div>
            <nav className="flex items-center gap-3 text-sm text-gray-600 font-medium">
              <Link href="/" className="hover:text-gray-900 hover:underline">홈</Link>
              <span className="text-gray-300">|</span>
              <Link href="/verse-map" className="hover:text-gray-900 hover:underline">성경지도</Link>
              <span className="text-gray-300">|</span>
              <Link href="/youtube" className="hover:text-gray-900 hover:underline">설교</Link>
              <span className="text-gray-300">|</span>
              <Link href="/news" className="hover:text-gray-900 hover:underline">신문</Link>
              <span className="text-gray-300">|</span>
              <Link href="/bulletin" className="hover:text-gray-900 hover:underline">주보</Link>
              <span className="text-gray-300">|</span>
              <Link href="/admin" className="hover:text-gray-900 hover:underline">관리</Link>
            </nav>
          </div>

          {/* 탭 버튼 */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {[
              { id: 'api-keys', label: 'API 키 관리' },
              { id: 'bible', label: '성경 버전' },
              { id: 'data', label: '데이터 관리' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-white text-amber-800 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-4xl w-full mx-auto px-4 py-6">

        {/* API 키 관리 탭 */}
        {activeTab === 'api-keys' && (
          <div className="space-y-6 animate-fade-in">
            {/* 등록된 API 키 목록 */}
            <div className="bg-white/95 rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">등록된 API 키</h2>

              {apiLoading ? (
                <div className="text-center py-8 text-gray-500">로딩 중...</div>
              ) : apiKeys.length === 0 ? (
                <div className="text-center py-8 text-gray-500">등록된 API 키가 없습니다.</div>
              ) : (
                <div className="space-y-3">
                  {apiKeys.map((apiKey) => (
                    <div
                      key={apiKey.id}
                      className="border border-gray-100 rounded-lg p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <h3 className="font-semibold text-gray-900">{PROVIDER_LABELS[apiKey.provider]}</h3>
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              apiKey.isActive
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {apiKey.isActive ? '활성' : '비활성'}
                          </span>
                          <span className="text-xs text-gray-500">우선순위: {apiKey.priority}</span>
                        </div>
                        <div className="text-sm text-gray-500 mt-1 font-mono">{apiKey.keyPreview}</div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditing(apiKey.provider)
                            setFormData(prev => ({ ...prev, provider: apiKey.provider, key: '' }))
                          }}
                          className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => handleApiDelete(apiKey.provider)}
                          className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-sm font-medium transition-colors"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* API 키 추가/수정 폼 */}
            <div className="bg-white/95 rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {editing ? 'API 키 수정' : 'API 키 추가'}
              </h2>

              <form onSubmit={handleApiSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700">제공자</label>
                    <select
                      value={formData.provider}
                      onChange={(e) => setFormData({ ...formData, provider: e.target.value as AIProvider })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-gray-900 bg-white focus:outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200"
                      disabled={!!editing}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic (Claude)</option>
                      <option value="google">Google (Gemini)</option>
                      <option value="perplexity">Perplexity</option>
                      <option value="youtube">YouTube API</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700">우선순위</label>
                    <input
                      type="number"
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-gray-900 bg-white focus:outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200"
                      min="0"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-700">API 키</label>
                  <input
                    type="password"
                    value={formData.key}
                    onChange={(e) => setFormData({ ...formData, key: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg font-mono text-gray-900 bg-white focus:outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200"
                    placeholder="sk-..."
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">API 키는 암호화되어 저장됩니다.</p>
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.isActive}
                      onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                      className="w-4 h-4 text-gray-600 rounded"
                    />
                    <span className="text-sm text-gray-700">활성화</span>
                  </label>

                  <div className="flex-1" />

                  <button
                    type="submit"
                    className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 font-medium transition-colors"
                  >
                    {editing ? '수정하기' : '추가하기'}
                  </button>

                  {editing && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(null)
                        setFormData({ provider: 'openai', key: '', isActive: true, priority: 0 })
                      }}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium transition-colors"
                    >
                      취소
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Fallback 설명 */}
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
              <h3 className="font-semibold text-gray-900 mb-2">Fallback 동작 방식</h3>
              <p className="text-sm text-gray-600">
                우선순위가 낮은 순서대로 시도합니다. 예: OpenAI(0) → Claude(1) → Gemini(2)
                <br />
                하나의 API가 실패하면 자동으로 다음 API로 넘어갑니다.
              </p>
            </div>
          </div>
        )}

        {/* 성경 버전 관리 탭 */}
        {activeTab === 'bible' && (
          <div className="space-y-6 animate-fade-in">
            {/* 성경 버전 목록 */}
            <div className="bg-white/95 rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">성경 버전 목록</h2>
                <button
                  onClick={fetchBibleVersions}
                  className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors"
                >
                  새로고침
                </button>
              </div>

              {bibleLoading ? (
                <div className="text-center py-8 text-gray-500">로딩 중...</div>
              ) : (
                <div className="space-y-3">
                  {/* 기본 버전들 */}
                  {[
                    { id: 'GAE', name_korean: '개역개정', name_english: 'Korean Revised Version (New)', language: 'ko', source_url: 'http://www.holybible.or.kr/B_GAE/' },
                    { id: 'KRV', name_korean: '개역한글', name_english: 'Korean Revised Version', language: 'ko', source_url: 'http://www.holybible.or.kr/B_KRV/' },
                    { id: 'NIV', name_korean: 'NIV', name_english: 'New International Version', language: 'en', source_url: 'http://www.holybible.or.kr/B_NIV/' },
                    { id: 'ESV', name_korean: 'ESV', name_english: 'English Standard Version', language: 'en', source_url: 'http://www.holybible.or.kr/B_ESV/' }
                  ].map(version => {
                    const dbVersion = bibleVersions.find(v => v.id === version.id)
                    const verseCount = dbVersion?.verse_count || 0
                    const embeddedCount = dbVersion?.embedded_count || 0
                    const isExtracting = extracting === version.id

                    // 버튼 활성화 로직:
                    // - 100% 완료: 두 버튼 모두 비활성화
                    // - 0% (구절 없음): 추출만 활성화
                    // - 0% < x < 100%: 두 버튼 모두 활성화
                    const isComplete = verseCount > 0 && embeddedCount === verseCount
                    const hasVerses = verseCount > 0
                    const completionPercent = verseCount > 0 ? Math.round((embeddedCount / verseCount) * 100) : 0

                    return (
                      <div
                        key={version.id}
                        className="border border-gray-100 rounded-lg p-4 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-1">
                              <h3 className="font-semibold text-gray-900">{version.name_korean}</h3>
                              <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                                {version.id}
                              </span>
                              <span className="text-xs text-gray-500">{version.language === 'ko' ? '한국어' : '영어'}</span>
                              {isComplete && (
                                <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">
                                  ✓ 완료
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-500">{version.name_english}</p>
                            <p className="text-xs text-gray-400 mt-1">{version.source_url}</p>

                            {/* 통계 */}
                            <div className="flex items-center gap-4 mt-2">
                              <span className="text-sm text-gray-600">
                                구절: <strong>{verseCount.toLocaleString()}</strong>개
                              </span>
                              <span className="text-sm text-gray-600">
                                임베딩: <strong>{embeddedCount.toLocaleString()}</strong>개
                              </span>
                              {verseCount > 0 && (
                                <span className={`text-sm font-medium ${isComplete ? 'text-green-600' : 'text-amber-600'}`}>
                                  ({completionPercent}%)
                                </span>
                              )}
                            </div>

                            {isExtracting && extractProgress && (
                              <p className="text-sm text-gray-600 mt-2">{extractProgress}</p>
                            )}
                          </div>

                          <div className="flex gap-2">
                            <button
                              onClick={() => handleBibleExtract(version.id)}
                              disabled={isExtracting || isComplete}
                              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                isComplete
                                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50'
                              }`}
                            >
                              {isExtracting ? '처리중...' : '추출'}
                            </button>
                            <button
                              onClick={() => handleBibleEmbed(version.id)}
                              disabled={isExtracting || isComplete || !hasVerses}
                              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                isComplete || !hasVerses
                                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                  : 'bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50'
                              }`}
                            >
                              임베딩
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 크롤링 안내 */}
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
              <h3 className="font-semibold text-gray-900 mb-2">성경 크롤링 안내</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• <strong>추출</strong>: 웹사이트에서 성경 구절을 크롤링하여 데이터베이스에 저장합니다.</li>
                <li>• <strong>임베딩</strong>: 저장된 구절에 벡터 임베딩을 생성합니다 (OpenAI API 비용 발생).</li>
                <li>• 추출은 약 30분, 임베딩은 약 10분 소요됩니다.</li>
                <li>• 서버 부하 방지를 위해 각 구절 간 0.5초 지연이 있습니다.</li>
              </ul>
            </div>
          </div>
        )}

        {/* 데이터 관리 탭 */}
        {activeTab === 'data' && (
          <div className="space-y-6 animate-fade-in">
            {/* 현재 데이터 통계 */}
            <div className="bg-white/95 rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">현재 데이터 현황</h2>
                <button
                  onClick={fetchDataStats}
                  className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors"
                >
                  새로고침
                </button>
              </div>

              {statsLoading ? (
                <div className="text-center py-8 text-gray-500">로딩 중...</div>
              ) : dataStats ? (
                <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* 뉴스 */}
                  <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-100">
                    <h3 className="font-semibold text-indigo-900 mb-3">열한시 뉴스</h3>
                    <div className="space-y-1 text-sm">
                      <p className="text-gray-600">호수: <strong>{dataStats.newsIssues}</strong>개</p>
                      <p className="text-gray-600">청크: <strong>{dataStats.newsChunks}</strong>개</p>
                      <p className="text-gray-600">임베딩: <strong>{dataStats.newsEmbedded}</strong>개</p>
                    </div>
                  </div>

                  {/* 주보 */}
                  <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                    <h3 className="font-semibold text-green-900 mb-3">주보</h3>
                    <div className="space-y-1 text-sm">
                      <p className="text-gray-600">주보: <strong>{dataStats.bulletinIssues || 0}</strong>개</p>
                      <p className="text-gray-600">청크: <strong>{dataStats.bulletinChunks || 0}</strong>개</p>
                    </div>
                  </div>

                  {/* 성경 */}
                  <div className="bg-amber-50 rounded-lg p-4 border border-amber-100">
                    <h3 className="font-semibold text-amber-900 mb-3">성경</h3>
                    <div className="space-y-1 text-sm">
                      <p className="text-gray-600">구절: <strong>{dataStats.bibleVerses?.toLocaleString()}</strong>개</p>
                      <p className="text-gray-600">임베딩: <strong>{dataStats.bibleEmbedded?.toLocaleString()}</strong>개</p>
                    </div>
                  </div>

                  {/* 설교 */}
                  <div className="bg-purple-50 rounded-lg p-4 border border-purple-100">
                    <h3 className="font-semibold text-purple-900 mb-3">설교</h3>
                    <div className="space-y-1 text-sm">
                      <p className="text-gray-600">설교: <strong>{dataStats.sermons}</strong>개</p>
                      <p className="text-gray-600">청크: <strong>{dataStats.sermonChunks}</strong>개</p>
                    </div>
                  </div>
                </div>

                {/* 성경 구절 관계 통계 */}
                <div className="mt-6 bg-rose-50 rounded-lg p-4 border border-rose-100">
                  <h3 className="font-semibold text-rose-900 mb-3">성경 구절 관계 (GraphRAG)</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div className="text-center p-3 bg-white rounded-lg border border-rose-200">
                      <div className="text-2xl font-bold text-rose-700">{dataStats.verseRelations || 0}</div>
                      <div className="text-xs text-gray-600">구절 연결</div>
                    </div>
                    <div className="text-center p-3 bg-white rounded-lg border border-rose-200">
                      <div className="text-2xl font-bold text-rose-700">{dataStats.verseThemes || 0}</div>
                      <div className="text-xs text-gray-600">주제 태그</div>
                    </div>
                    <div className="text-center p-3 bg-white rounded-lg border border-rose-200">
                      <div className="text-2xl font-bold text-rose-700">
                        {Object.keys(dataStats.relationTypeCount || {}).length}
                      </div>
                      <div className="text-xs text-gray-600">관계 유형</div>
                    </div>
                    <div className="text-center p-3 bg-white rounded-lg border border-rose-200">
                      <div className="text-2xl font-bold text-rose-700">
                        {Object.values(dataStats.relationTypeCount || {}).reduce((a, b) => a + b, 0)}
                      </div>
                      <div className="text-xs text-gray-600">총 연결 수</div>
                    </div>
                  </div>

                  {/* 관계 유형별 상세 */}
                  {dataStats.relationTypeCount && Object.keys(dataStats.relationTypeCount).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">관계 유형별 통계</p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(dataStats.relationTypeCount).map(([type, count]) => {
                          const typeLabels: Record<string, string> = {
                            prophecy_fulfillment: '예언/성취',
                            parallel: '평행본문',
                            quotation: '인용',
                            thematic: '주제 연결',
                            narrative: '서사 연결',
                            theological: '신학적',
                            semantic: '의미 유사'
                          }
                          return (
                            <span
                              key={type}
                              className="inline-flex items-center gap-1 px-3 py-1 bg-white rounded-full text-xs border border-rose-200"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                              <span className="text-gray-700">{typeLabels[type] || type}</span>
                              <span className="font-semibold text-rose-600">{count}</span>
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
                </>
              ) : (
                <div className="text-center py-8 text-gray-500">통계를 불러올 수 없습니다.</div>
              )}
            </div>

            {/* 데이터 초기화 */}
            <div className="bg-white/95 rounded-xl shadow-sm border border-red-100 p-6">
              <h2 className="text-lg font-semibold text-red-900 mb-4">데이터 초기화</h2>
              <p className="text-sm text-gray-600 mb-4">
                주의: 삭제된 데이터는 복구할 수 없습니다. 신중하게 진행하세요.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => handleDataReset('news')}
                  className="p-4 border-2 border-red-200 rounded-lg text-left hover:bg-red-50 transition-colors"
                >
                  <h3 className="font-semibold text-red-800 mb-1">뉴스 데이터 삭제</h3>
                  <p className="text-sm text-gray-500">호수, 기사, 청크, 임베딩 모두 삭제</p>
                </button>

                <button
                  type="button"
                  onClick={() => handleDataReset('bulletin')}
                  className="p-4 border-2 border-red-200 rounded-lg text-left hover:bg-red-50 transition-colors"
                >
                  <h3 className="font-semibold text-red-800 mb-1">주보 데이터 삭제</h3>
                  <p className="text-sm text-gray-500">주보, 섹션, 청크 모두 삭제</p>
                </button>

                <button
                  type="button"
                  onClick={() => handleDataReset('bible')}
                  className="p-4 border-2 border-red-200 rounded-lg text-left hover:bg-red-50 transition-colors"
                >
                  <h3 className="font-semibold text-red-800 mb-1">성경 임베딩 삭제</h3>
                  <p className="text-sm text-gray-500">구절 텍스트는 유지, 임베딩만 삭제</p>
                </button>

                <button
                  type="button"
                  onClick={() => handleDataReset('sermons')}
                  className="p-4 border-2 border-red-200 rounded-lg text-left hover:bg-red-50 transition-colors"
                >
                  <h3 className="font-semibold text-red-800 mb-1">설교 데이터 삭제</h3>
                  <p className="text-sm text-gray-500">설교 및 청크 모두 삭제</p>
                </button>
              </div>
            </div>

            {/* 전체 초기화 (별도 섹션) */}
            <div className="bg-red-50 rounded-xl shadow-sm border-2 border-red-300 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-red-900 mb-1">전체 데이터 초기화</h2>
                  <p className="text-sm text-red-700">
                    뉴스, 주보, 성경 임베딩, 설교 데이터를 모두 삭제합니다. 이 작업은 되돌릴 수 없습니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDataReset('all')}
                  className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors whitespace-nowrap"
                >
                  전체 초기화
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 스타일 */}
      <style jsx global>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  )
}
