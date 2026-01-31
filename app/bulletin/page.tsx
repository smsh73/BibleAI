'use client'

/**
 * 주보 관리 및 챗봇 페이지
 * - URL 크롤링
 * - 주보 검색 챗봇
 */

import { useState, useRef, useEffect } from 'react'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: any[]
}

interface ProcessingStatus {
  totalIssues: number
  completedIssues: number
  pendingIssues: number
  totalChunks: number
  embeddedChunks: number
}

interface BulletinIssue {
  id: number
  bulletin_date: string
  title: string
  year: number
  month: number
  day: number
  page_count: number
  status: string
  chunkCount: number
  created_at: string
}

type TabType = 'chat' | 'crawl' | 'stats'

export default function BulletinPage() {
  const [activeTab, setActiveTab] = useState<TabType>('chat')

  // 챗봇 상태
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [yearFilter, setYearFilter] = useState<number | undefined>()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 크롤링 상태
  const [crawlStatus, setCrawlStatus] = useState<ProcessingStatus | null>(null)
  const [crawlLoading, setCrawlLoading] = useState(false)
  const [scannedBulletins, setScannedBulletins] = useState<any[]>([])
  const [progressMessage, setProgressMessage] = useState('')

  // URL 설정
  const [listPageUrl, setListPageUrl] = useState('https://www.anyangjeil.org/Board/Index/65')

  // 완료된 주보 목록
  const [completedBulletins, setCompletedBulletins] = useState<BulletinIssue[]>([])
  const [issuesLoading, setIssuesLoading] = useState(false)

  // 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 상태 로드
  useEffect(() => {
    loadStatus()
  }, [])

  // 통계 탭 선택 시 완료된 주보 목록 로드
  useEffect(() => {
    if (activeTab === 'stats') {
      loadCompletedBulletins()
    }
  }, [activeTab])

  async function loadCompletedBulletins() {
    setIssuesLoading(true)
    try {
      const res = await fetch('/api/bulletin/issues?status=completed')
      const data = await res.json()
      if (data.success) {
        setCompletedBulletins(data.issues)
      }
    } catch (error) {
      console.error('완료된 주보 목록 로드 실패:', error)
    } finally {
      setIssuesLoading(false)
    }
  }

  async function loadStatus() {
    try {
      const res = await fetch('/api/bulletin/process')
      const data = await res.json()
      if (data.success) {
        setCrawlStatus(data.stats)
      }
    } catch (error) {
      console.error('상태 로드 실패:', error)
    }
  }

  // 챗봇 제출
  async function handleChatSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const response = await fetch('/api/bulletin/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content
          })),
          filters: { year: yearFilter }
        })
      })

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) throw new Error('No reader')

      let assistantMessage = ''
      let sources: any[] = []
      const assistantId = (Date.now() + 1).toString()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6)
            if (dataStr === '[DONE]') continue

            try {
              const data = JSON.parse(dataStr)

              if (data.type === 'sources') {
                sources = data.sources
              } else if (data.content) {
                assistantMessage += data.content

                setMessages(prev => {
                  const existing = prev.find(m => m.id === assistantId)
                  if (existing) {
                    return prev.map(m =>
                      m.id === assistantId
                        ? { ...m, content: assistantMessage, sources }
                        : m
                    )
                  } else {
                    return [
                      ...prev,
                      {
                        id: assistantId,
                        role: 'assistant' as const,
                        content: assistantMessage,
                        sources
                      }
                    ]
                  }
                })
              }
            } catch (e) {
              // 파싱 오류 무시
            }
          }
        }
      }
    } catch (error) {
      console.error('챗봇 오류:', error)
      alert('오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // 스캔 실행
  async function handleScan() {
    setCrawlLoading(true)
    setProgressMessage('주보 목록 스캔 중...')

    try {
      const res = await fetch('/api/bulletin/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'scan',
          config: { listPageUrl }
        })
      })

      const data = await res.json()

      if (data.success) {
        setScannedBulletins(data.issues || [])
        setProgressMessage(`스캔 완료: 총 ${data.total}개 (신규: ${data.newSaved}개, 완료: ${data.completed}개, 대기: ${data.pending}개)`)
        loadStatus()
      } else {
        setProgressMessage(`오류: ${data.error}`)
      }
    } catch (error: any) {
      setProgressMessage(`오류: ${error.message}`)
    } finally {
      setCrawlLoading(false)
    }
  }

  // 처리 실행
  async function handleProcess(maxIssues: number = 3) {
    setCrawlLoading(true)
    setProgressMessage(`${maxIssues}개 주보 처리 중...`)

    try {
      const res = await fetch('/api/bulletin/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          maxIssues,
          config: { listPageUrl }
        })
      })

      const data = await res.json()

      if (data.success) {
        const successCount = data.results.filter((r: any) => r.success).length
        setProgressMessage(`처리 완료: ${successCount}개 성공`)
        loadStatus()
        handleScan() // 목록 새로고침
      } else {
        setProgressMessage(`오류: ${data.error}`)
      }
    } catch (error: any) {
      setProgressMessage(`오류: ${error.message}`)
    } finally {
      setCrawlLoading(false)
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
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h1 className="text-lg font-semibold text-amber-900">주보 시스템</h1>
            </div>
            <nav className="flex items-center gap-3 text-sm text-gray-600 font-medium">
              <a href="/" className="hover:text-gray-900 hover:underline">홈</a>
              <span className="text-gray-300">|</span>
              <a href="/verse-map" className="hover:text-gray-900 hover:underline">성경지도</a>
              <span className="text-gray-300">|</span>
              <a href="/youtube" className="hover:text-gray-900 hover:underline">설교</a>
              <span className="text-gray-300">|</span>
              <a href="/news" className="hover:text-gray-900 hover:underline">신문</a>
              <span className="text-gray-300">|</span>
              <a href="/bulletin" className="hover:text-gray-900 hover:underline">주보</a>
              <span className="text-gray-300">|</span>
              <a href="/admin" className="hover:text-gray-900 hover:underline">관리</a>
            </nav>
          </div>

          {/* 탭 버튼 */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {[
              { id: 'chat', label: '주보 검색' },
              { id: 'crawl', label: 'URL 크롤링' },
              { id: 'stats', label: '통계' }
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

      <div className="relative z-10 max-w-4xl mx-auto p-4 flex-1">
        {/* =============== 챗봇 탭 =============== */}
        {activeTab === 'chat' && (
          <div className="flex flex-col h-[calc(100vh-180px)]">
            {/* 필터 */}
            {messages.length === 0 && (
              <div className="flex-shrink-0 mb-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-amber-700 font-medium">연도:</span>
                  <select
                    value={yearFilter || ''}
                    onChange={(e) => setYearFilter(e.target.value ? parseInt(e.target.value) : undefined)}
                    className="px-2 py-0.5 bg-white/80 border border-amber-200 rounded text-amber-800 text-sm focus:outline-none focus:border-green-400 cursor-pointer"
                  >
                    <option value="">전체</option>
                    {[2026, 2025, 2024, 2023, 2022, 2021, 2020].map(year => (
                      <option key={year} value={year}>{year}년</option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-500 ml-auto">
                    총 {crawlStatus?.totalChunks || 0}개 주보 청크 검색 가능
                  </span>
                </div>
              </div>
            )}

            {/* 메시지 */}
            <div className="flex-1 overflow-y-auto py-4">
              {messages.length === 0 ? (
                <div className="text-center pt-20 pb-8 animate-fade-in">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center shadow-lg">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-green-900 text-xl font-semibold mb-2">주보 검색</p>
                  <p className="text-amber-700 text-base mb-8">예배순서, 교회소식, 행사 안내를 검색해보세요</p>
                  <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-base">
                    {[
                      '다음 주 예배 시간',
                      '교회소식 요약',
                      '기도제목',
                      '새가족 환영'
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => setInput(suggestion)}
                        className="text-amber-700 hover:text-green-900 hover:underline underline-offset-2 transition-colors font-medium"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message, idx) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up`}
                      style={{ animationDelay: `${idx * 0.03}s` }}
                    >
                      <div
                        className={`max-w-[85%] px-4 py-3 ${
                          message.role === 'user'
                            ? 'bg-amber-600 text-white rounded-2xl rounded-br-sm'
                            : 'bg-white/95 text-gray-800 rounded-2xl rounded-bl-sm shadow-sm border border-amber-100'
                        }`}
                      >
                        <div className="whitespace-pre-wrap text-base leading-relaxed">
                          {message.content}
                        </div>

                        {/* 출처 */}
                        {message.sources && message.sources.length > 0 && (
                          <div className="mt-3 pt-2 border-t border-amber-200">
                            <p className="text-xs text-green-600 mb-1.5">참조 주보:</p>
                            <div className="space-y-1">
                              {message.sources.slice(0, 3).map((source, idx) => (
                                <div key={idx} className="text-xs bg-amber-50 text-amber-800 rounded px-2 py-1">
                                  [{source.bulletinTitle}] {source.sectionType}: {source.title}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {loading && (
                    <div className="flex justify-start animate-fade-in">
                      <div className="bg-white/95 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm border border-amber-100">
                        <div className="flex items-center gap-2">
                          <span className="text-xl animate-pulse-slow">🙏</span>
                          <span className="text-sm text-green-600 animate-pulse">주보를 찾고 있습니다...</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* 입력 */}
            <div className="flex-shrink-0 py-3 bg-white/50">
              <form onSubmit={handleChatSubmit}>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="주보에 대해 질문하세요..."
                    className="flex-1 px-4 py-3 bg-white border border-amber-300 rounded-full focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 text-gray-900 placeholder-amber-500 text-base"
                    disabled={loading}
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="w-10 h-10 flex items-center justify-center bg-amber-600 hover:bg-amber-700 text-white rounded-full disabled:bg-amber-300 disabled:cursor-not-allowed transition-colors"
                  >
                    {loading ? (
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* =============== 크롤링 탭 =============== */}
        {activeTab === 'crawl' && (
          <div className="space-y-6">
            {/* 현재 상태 */}
            <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6">
              <h2 className="text-lg font-semibold text-green-900 mb-4">처리 현황</h2>
              {crawlStatus ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-amber-50 rounded-xl p-4 text-center border border-amber-100">
                    <div className="text-2xl font-bold text-amber-700">{crawlStatus.totalIssues}</div>
                    <div className="text-sm text-green-600">전체 주보</div>
                  </div>
                  <div className="bg-emerald-50 rounded-xl p-4 text-center border border-emerald-100">
                    <div className="text-2xl font-bold text-emerald-700">{crawlStatus.completedIssues}</div>
                    <div className="text-sm text-emerald-600">완료</div>
                  </div>
                  <div className="bg-yellow-50 rounded-xl p-4 text-center border border-yellow-100">
                    <div className="text-2xl font-bold text-yellow-700">{crawlStatus.pendingIssues}</div>
                    <div className="text-sm text-yellow-600">대기중</div>
                  </div>
                  <div className="bg-amber-100 rounded-xl p-4 text-center border border-amber-200">
                    <div className="text-2xl font-bold text-amber-800">{crawlStatus.totalChunks}</div>
                    <div className="text-sm text-amber-700">청크</div>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500">로딩 중...</p>
              )}
            </div>

            {/* URL 설정 */}
            <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6">
              <h2 className="text-lg font-semibold text-green-900 mb-4">URL 설정</h2>
              <div>
                <label className="block text-sm font-medium text-amber-800 mb-1">
                  주보 목록 페이지 URL
                </label>
                <input
                  type="url"
                  value={listPageUrl}
                  onChange={(e) => setListPageUrl(e.target.value)}
                  placeholder="https://www.anyangjeil.org/Board/Index/65"
                  className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300 focus:border-green-400 text-gray-900 bg-white"
                />
              </div>
            </div>

            {/* 크롤링 컨트롤 */}
            <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6">
              <h2 className="text-lg font-semibold text-green-900 mb-4">크롤링 실행</h2>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleScan}
                  disabled={crawlLoading}
                  className="px-6 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-sm transition-colors"
                >
                  {crawlLoading ? '스캔 중...' : '주보 목록 스캔'}
                </button>
              </div>

              {progressMessage && (
                <div className="mt-4 p-4 bg-amber-50 rounded-lg border border-amber-100">
                  <p className="text-sm text-amber-700">{progressMessage}</p>
                </div>
              )}
            </div>

            {/* 스캔 결과 */}
            {scannedBulletins.length > 0 && (
              <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-green-900">
                    스캔 결과: 총 {scannedBulletins.length}건
                  </h2>
                </div>

                {/* 미처리 주보가 있을 때 처리 버튼 */}
                {scannedBulletins.filter(b => b.status !== 'completed').length > 0 && !crawlLoading && (
                  <div className="mb-4 p-4 bg-amber-50 border border-amber-100 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-green-900">
                          {scannedBulletins.filter(b => b.status !== 'completed').length}개 주보가 처리 대기중입니다
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleProcess(3)}
                          className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm shadow-sm transition-colors"
                        >
                          3개 처리
                        </button>
                        <button
                          onClick={() => handleProcess(10)}
                          className="px-4 py-2 bg-green-800 text-white rounded-lg hover:bg-green-900 text-sm shadow-sm transition-colors"
                        >
                          10개 처리
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="max-h-96 overflow-y-auto border border-amber-100 rounded-lg">
                  <table className="w-full text-sm text-gray-900">
                    <thead className="bg-amber-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2 text-amber-800 font-semibold">주보 날짜</th>
                        <th className="text-left p-2 text-amber-800 font-semibold">제목</th>
                        <th className="text-center p-2 text-amber-800 font-semibold">페이지</th>
                        <th className="text-left p-2 text-amber-800 font-semibold">상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scannedBulletins.slice(0, 50).map((bulletin, idx) => (
                        <tr key={idx} className={`border-t border-green-50 ${
                          bulletin.status !== 'completed' ? 'bg-yellow-50' : 'bg-white'
                        }`}>
                          <td className="p-2 text-gray-900">{bulletin.bulletinDate}</td>
                          <td className="p-2 text-gray-900">{bulletin.title}</td>
                          <td className="p-2 text-center text-gray-600">{bulletin.pageCount}면</td>
                          <td className="p-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              bulletin.status === 'completed'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {bulletin.status === 'completed' ? '완료' : '대기'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =============== 통계 탭 =============== */}
        {activeTab === 'stats' && (
          <div className="space-y-6">
            <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6">
              <h2 className="text-lg font-semibold text-green-900 mb-4">데이터 통계</h2>

              {crawlStatus && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-amber-600 rounded-xl p-4 text-white shadow-sm">
                    <div className="text-3xl font-bold">{crawlStatus.completedIssues}</div>
                    <div className="text-green-200">처리된 주보</div>
                  </div>
                  <div className="bg-green-800 rounded-xl p-4 text-white shadow-sm">
                    <div className="text-3xl font-bold">{crawlStatus.totalChunks}</div>
                    <div className="text-green-300">벡터 청크</div>
                  </div>
                  <div className="bg-emerald-600 rounded-xl p-4 text-white shadow-sm">
                    <div className="text-3xl font-bold">{crawlStatus.embeddedChunks}</div>
                    <div className="text-emerald-200">임베딩 완료</div>
                  </div>
                  <div className="bg-teal-600 rounded-xl p-4 text-white shadow-sm">
                    <div className="text-3xl font-bold">
                      {((crawlStatus.completedIssues / Math.max(crawlStatus.totalIssues, 1)) * 100).toFixed(0)}%
                    </div>
                    <div className="text-teal-200">완료율</div>
                  </div>
                </div>
              )}
            </div>

            {/* 완료된 주보 목록 */}
            <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6">
              <h2 className="text-lg font-semibold text-green-900 mb-4">벡터 임베딩 완료된 주보 목록</h2>

              {issuesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                  <span className="ml-2 text-gray-500">주보 목록 로딩 중...</span>
                </div>
              ) : completedBulletins.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>아직 임베딩된 주보가 없습니다.</p>
                  <p className="text-sm mt-1">크롤링 탭에서 주보를 처리해주세요.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-amber-50">
                      <tr>
                        <th className="text-left p-3 font-semibold text-amber-800">날짜</th>
                        <th className="text-left p-3 font-semibold text-amber-800">제목</th>
                        <th className="text-center p-3 font-semibold text-amber-800">페이지</th>
                        <th className="text-center p-3 font-semibold text-amber-800">청크 수</th>
                        <th className="text-left p-3 font-semibold text-amber-800">처리일</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-green-50">
                      {completedBulletins.map((bulletin) => (
                        <tr key={bulletin.id} className="hover:bg-amber-50 transition-colors">
                          <td className="p-3">
                            <span className="font-medium text-gray-900">{bulletin.bulletin_date}</span>
                          </td>
                          <td className="p-3 text-gray-700">{bulletin.title}</td>
                          <td className="p-3 text-center text-gray-600">{bulletin.page_count}면</td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">
                              {bulletin.chunkCount}개
                            </span>
                          </td>
                          <td className="p-3 text-gray-500 text-xs">
                            {new Date(bulletin.created_at).toLocaleDateString('ko-KR')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 커스텀 스타일 */}
      <style jsx global>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.5s ease-out forwards;
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  )
}
