'use client'

/**
 * 열한시 뉴스 관리 및 챗봇 페이지
 * - URL 크롤링
 * - PDF 업로드
 * - 뉴스 검색 챗봇
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
  totalArticles: number
  totalChunks: number
}

interface CompletedIssue {
  id: number
  issue_number: number
  issue_date: string
  year: number
  month: number
  page_count: number
  articleCount: number
  chunkCount: number
  created_at: string
}

type TabType = 'chat' | 'crawl' | 'upload' | 'stats'

export default function NewsPage() {
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
  const [crawlResults, setCrawlResults] = useState<any[]>([])
  const [scannedIssues, setScannedIssues] = useState<any[]>([])

  // URL 설정 (유연한 방식)
  const [listPageUrl, setListPageUrl] = useState('https://www.anyangjeil.org/Board/Index/66')
  const [startUrl, setStartUrl] = useState('') // 선택사항: 시작(최신) 게시물 URL
  const [endUrl, setEndUrl] = useState('') // 선택사항: 끝(가장 오래된) 게시물 URL

  // 실시간 진행상황
  const [progressPercent, setProgressPercent] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [progressDetail, setProgressDetail] = useState('')
  const [progressLogs, setProgressLogs] = useState<string[]>([])

  // 업로드 상태
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadResults, setUploadResults] = useState<any[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 완료된 호수 목록
  const [completedIssues, setCompletedIssues] = useState<CompletedIssue[]>([])
  const [issuesLoading, setIssuesLoading] = useState(false)

  // 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 상태 로드
  useEffect(() => {
    loadStatus()
  }, [])

  // 통계 탭 선택 시 완료된 호수 목록 로드
  useEffect(() => {
    if (activeTab === 'stats') {
      loadCompletedIssues()
    }
  }, [activeTab])

  async function loadCompletedIssues() {
    setIssuesLoading(true)
    try {
      const res = await fetch('/api/news/issues')
      const data = await res.json()
      if (data.success) {
        setCompletedIssues(data.issues)
      }
    } catch (error) {
      console.error('완료된 호수 목록 로드 실패:', error)
    } finally {
      setIssuesLoading(false)
    }
  }

  async function loadStatus() {
    try {
      const res = await fetch('/api/news/process')
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
      const response = await fetch('/api/news/chat', {
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
    setProgressLogs([])
    setProgressMessage('호수 목록 스캔 중...')
    setProgressPercent(10)
    setProgressLogs(prev => [...prev, '[스캔] 웹사이트에서 호수 목록을 가져오는 중...'])

    try {
      const res = await fetch('/api/news/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'scan',
          config: {
            listPageUrl,
            startUrl: startUrl || undefined,
            endUrl: endUrl || undefined
          }
        })
      })

      setProgressPercent(80)
      setProgressLogs(prev => [...prev, '[스캔] 데이터베이스에서 처리 상태 확인 중...'])

      const data = await res.json()

      if (data.success) {
        setScannedIssues(data.issues || [])
        setProgressPercent(100)
        setProgressMessage('스캔 완료!')
        setProgressLogs(prev => [
          ...prev,
          `[스캔] 완료: 총 ${data.total}개 호수 발견`,
          `[스캔] 기처리: ${data.completed}개, 미처리: ${data.pending}개`
        ])
        loadStatus()
      } else {
        setProgressLogs(prev => [...prev, `[오류] ${data.error || '스캔 실패'}`])
        alert(data.error || '스캔 실패')
      }
    } catch (error: any) {
      setProgressLogs(prev => [...prev, `[오류] ${error.message}`])
      alert('스캔 오류: ' + error.message)
    } finally {
      setCrawlLoading(false)
    }
  }

  // 증분 처리 실행 (스트리밍)
  async function handleProcessIncremental(maxIssues: number = 3) {
    setCrawlLoading(true)
    setCrawlResults([])
    setProgressPercent(0)
    setProgressMessage('처리 시작 중...')
    setProgressDetail('')
    setProgressLogs([])

    try {
      const response = await fetch('/api/news/process-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process_incremental',
          maxIssues,
          config: {
            listPageUrl,
            startUrl: startUrl || undefined,
            endUrl: endUrl || undefined
          }
        })
      })

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) throw new Error('No reader')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.type === 'progress') {
                setProgressPercent(data.percent || 0)
                setProgressMessage(data.message || '')
                setProgressDetail(data.detail || '')
                setProgressLogs(prev => [...prev.slice(-30), `[${data.step}] ${data.message}`])

                // 호수 처리 시작 시 상태 업데이트
                if (data.step === 'issue_start' && data.issueDate) {
                  setScannedIssues(prev => prev.map(issue =>
                    issue.issueDate === data.issueDate
                      ? { ...issue, status: 'processing' }
                      : issue
                  ))
                }

                // 호수 처리 완료 시 상태 업데이트
                if (data.step === 'issue_done' && data.issueDate) {
                  setScannedIssues(prev => prev.map(issue =>
                    issue.issueDate === data.issueDate
                      ? { ...issue, status: 'completed' }
                      : issue
                  ))
                }
              } else if (data.type === 'complete') {
                setProgressPercent(100)
                setProgressMessage('처리 완료!')
                setCrawlResults(data.results || [])
                loadStatus()
                // 처리된 호수의 상태 업데이트
                const processedNumbers = (data.results || [])
                  .filter((r: any) => r.success)
                  .map((r: any) => r.issueNumber)
                setScannedIssues(prev => prev.map(issue =>
                  processedNumbers.includes(issue.issueNumber)
                    ? { ...issue, status: 'completed' }
                    : issue
                ))
              } else if (data.type === 'error') {
                setProgressLogs(prev => [...prev, `[오류] ${data.message}`])
              }
            } catch (e) {
              // 파싱 오류 무시
            }
          }
        }
      }
    } catch (error: any) {
      alert('처리 오류: ' + error.message)
    } finally {
      setCrawlLoading(false)
    }
  }

  // 파일 업로드
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploadLoading(true)
    setUploadResults([])

    try {
      const formData = new FormData()
      Array.from(files).forEach(file => {
        formData.append('files', file)
      })

      const res = await fetch('/api/news/upload', {
        method: 'POST',
        body: formData
      })
      const data = await res.json()

      if (data.success) {
        setUploadResults(data.results || [])
        alert(`업로드 완료: ${data.summary.processed}개 처리, ${data.summary.skipped}개 스킵, ${data.summary.failed}개 실패`)
        loadStatus()
      } else {
        alert(data.error || '업로드 실패')
      }
    } catch (error: any) {
      alert('업로드 오류: ' + error.message)
    } finally {
      setUploadLoading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
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
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                </svg>
              </div>
              <h1 className="text-lg font-semibold text-amber-900">열한시 뉴스</h1>
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
              { id: 'chat', label: '뉴스 검색' },
              { id: 'crawl', label: 'URL 크롤링' },
              { id: 'upload', label: '파일 업로드' },
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
                    className="px-2 py-0.5 bg-white/80 border border-amber-200 rounded text-amber-800 text-sm focus:outline-none focus:border-indigo-400 cursor-pointer"
                  >
                    <option value="">전체</option>
                    {[2026, 2025, 2024, 2023, 2022, 2021, 2020].map(year => (
                      <option key={year} value={year}>{year}년</option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-500 ml-auto">
                    총 {crawlStatus?.totalChunks || 0}개 기사 조각 검색 가능
                  </span>
                </div>
              </div>
            )}

            {/* 메시지 */}
            <div className="flex-1 overflow-y-auto py-4">
              {messages.length === 0 ? (
                <div className="text-center pt-20 pb-8 animate-fade-in">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center shadow-lg">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                    </svg>
                  </div>
                  <p className="text-indigo-900 text-xl font-semibold mb-2">열한시 뉴스 검색</p>
                  <p className="text-amber-700 text-base mb-8">교회 소식을 검색하고 질문해보세요</p>
                  <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-base">
                    {[
                      '최근 부흥회 소식',
                      '2024년 성탄절 행사',
                      '선교 관련 기사',
                      '청년부 활동'
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => setInput(suggestion)}
                        className="text-amber-700 hover:text-indigo-900 hover:underline underline-offset-2 transition-colors font-medium"
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
                            <p className="text-xs text-indigo-600 mb-1.5">참조 기사:</p>
                            <div className="space-y-1">
                              {message.sources.slice(0, 3).map((source, idx) => (
                                <div key={idx} className="text-xs bg-amber-50 text-amber-800 rounded px-2 py-1">
                                  [{source.issueDate}] {source.title}
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
                          <span className="text-sm text-indigo-600 animate-pulse">기사를 찾고 있습니다...</span>
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
                    placeholder="뉴스에 대해 질문하세요..."
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
              <h2 className="text-lg font-semibold text-indigo-900 mb-4">처리 현황</h2>
              {crawlStatus ? (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="bg-amber-50 rounded-xl p-4 text-center border border-amber-100">
                    <div className="text-2xl font-bold text-amber-700">{crawlStatus.totalIssues}</div>
                    <div className="text-sm text-indigo-600">전체 호수</div>
                  </div>
                  <div className="bg-green-50 rounded-xl p-4 text-center border border-green-100">
                    <div className="text-2xl font-bold text-green-700">{crawlStatus.completedIssues}</div>
                    <div className="text-sm text-green-600">완료</div>
                  </div>
                  <div className="bg-yellow-50 rounded-xl p-4 text-center border border-yellow-100">
                    <div className="text-2xl font-bold text-yellow-700">{crawlStatus.pendingIssues}</div>
                    <div className="text-sm text-yellow-600">대기중</div>
                  </div>
                  <div className="bg-purple-50 rounded-xl p-4 text-center border border-purple-100">
                    <div className="text-2xl font-bold text-purple-700">{crawlStatus.totalArticles}</div>
                    <div className="text-sm text-purple-600">기사</div>
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
              <h2 className="text-lg font-semibold text-indigo-900 mb-4">URL 설정</h2>
              <p className="text-sm text-gray-600 mb-4">
                뉴스 목록 페이지의 URL을 입력하세요. 범위를 지정하려면 시작/끝 게시물 URL도 입력하세요.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-amber-800 mb-1">
                    목록 페이지 URL <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="url"
                    value={listPageUrl}
                    onChange={(e) => setListPageUrl(e.target.value)}
                    placeholder="https://example.com/news/list 또는 https://www.anyangjeil.org/Board/Index/66"
                    className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-gray-900 placeholder-gray-400 bg-white"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    브라우저에서 뉴스 목록이 보이는 페이지의 URL을 붙여넣으세요
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-amber-800 mb-1">
                      시작 게시물 URL (선택)
                    </label>
                    <input
                      type="url"
                      value={startUrl}
                      onChange={(e) => setStartUrl(e.target.value)}
                      placeholder="가장 최신 게시물의 URL"
                      className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-gray-900 placeholder-gray-400 bg-white"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      크롤링 시작점 (최신 호수)
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-amber-800 mb-1">
                      끝 게시물 URL (선택)
                    </label>
                    <input
                      type="url"
                      value={endUrl}
                      onChange={(e) => setEndUrl(e.target.value)}
                      placeholder="가장 오래된 게시물의 URL"
                      className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-gray-900 placeholder-gray-400 bg-white"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      크롤링 종료점 (가장 오래된 호수)
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-100">
                <p className="text-xs text-amber-700">
                  스캔 대상: <code className="bg-amber-100 px-1 rounded">{listPageUrl || '(URL을 입력하세요)'}</code>
                </p>
                {(startUrl || endUrl) && (
                  <p className="text-xs text-indigo-600 mt-1">
                    범위: {startUrl ? '시작 URL 지정됨' : '처음부터'} ~ {endUrl ? '끝 URL 지정됨' : '끝까지'}
                  </p>
                )}
                <p className="text-xs text-indigo-600 mt-1">
                  시작/끝 URL을 지정하면 게시판 구조 파악과 범위 제한에 도움이 됩니다.
                </p>
              </div>
            </div>

            {/* 크롤링 컨트롤 */}
            <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6">
              <h2 className="text-lg font-semibold text-indigo-900 mb-4">크롤링 실행</h2>
              <p className="text-sm text-gray-600 mb-4">
                1단계: 먼저 스캔을 실행하여 처리할 호수 목록을 확인하세요.<br />
                2단계: 스캔 결과에서 처리할 호수를 확인하고 벡터 임베딩을 시작하세요.
              </p>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleScan}
                  disabled={crawlLoading}
                  className="px-6 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-sm transition-colors"
                >
                  {crawlLoading ? '스캔 중...' : '호수 목록 스캔'}
                </button>
                <span className="flex items-center text-sm text-gray-500">
                  스캔 후 아래에서 처리할 호수를 선택할 수 있습니다
                </span>
              </div>

              {crawlLoading && (
                <div className="mt-4 p-4 bg-amber-50 rounded-lg border border-amber-100 space-y-4">
                  {/* 진행률 바 */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-amber-700">{progressMessage}</span>
                      <span className="text-sm text-indigo-600">{progressPercent.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-indigo-200 rounded-full h-2">
                      <div
                        className="bg-amber-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    {progressDetail && (
                      <p className="text-xs text-indigo-600 mt-1">{progressDetail}</p>
                    )}
                  </div>

                  {/* 진행 로그 */}
                  <div className="bg-white rounded-lg p-3 max-h-40 overflow-y-auto border border-amber-100">
                    <p className="text-xs text-gray-500 mb-2">작업 로그:</p>
                    <div className="space-y-1 font-mono text-xs text-gray-600">
                      {progressLogs.map((log, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <span className="text-gray-400">{String(idx + 1).padStart(2, '0')}</span>
                          <span>{log}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 스캔 결과 */}
            {scannedIssues.length > 0 && (
              <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-indigo-900">
                    스캔 결과: 총 {scannedIssues.length}건
                    <span className="ml-2 text-sm font-normal text-gray-600">
                      (기처리: {scannedIssues.filter(i => i.status === 'completed').length}건 / 미처리: {scannedIssues.filter(i => i.status !== 'completed').length}건)
                    </span>
                  </h2>
                </div>

                {/* 미처리 호수가 있을 때 처리 버튼 표시 */}
                {scannedIssues.filter(i => i.status !== 'completed').length > 0 && !crawlLoading && (
                  <div className="mb-4 p-4 bg-amber-50 border border-amber-100 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-indigo-900">
                          {scannedIssues.filter(i => i.status !== 'completed').length}개 호수가 처리 대기중입니다
                        </p>
                        <p className="text-sm text-amber-700 mt-1">
                          벡터 임베딩 처리를 시작하시겠습니까? (이미 처리된 호수는 자동으로 건너뜁니다)
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleProcessIncremental(3)}
                          className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm shadow-sm transition-colors"
                        >
                          3개 처리
                        </button>
                        <button
                          onClick={() => handleProcessIncremental(scannedIssues.filter(i => i.status !== 'completed').length)}
                          className="px-4 py-2 bg-indigo-800 text-white rounded-lg hover:bg-indigo-900 text-sm shadow-sm transition-colors"
                        >
                          전체 처리 ({scannedIssues.filter(i => i.status !== 'completed').length}개)
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 모두 처리 완료된 경우 */}
                {scannedIssues.filter(i => i.status !== 'completed').length === 0 && (
                  <div className="mb-4 p-4 bg-green-50 border border-green-100 rounded-lg">
                    <p className="font-medium text-green-900">
                      모든 호수가 이미 처리되었습니다
                    </p>
                    <p className="text-sm text-green-700 mt-1">
                      새로운 호수가 발행되면 다시 스캔하세요.
                    </p>
                  </div>
                )}

                <div className="max-h-96 overflow-y-auto border border-amber-100 rounded-lg">
                  <table className="w-full text-sm text-gray-900">
                    <thead className="bg-amber-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2 text-amber-800 font-semibold">호수</th>
                        <th className="text-left p-2 text-amber-800 font-semibold">발행일</th>
                        <th className="text-left p-2 text-amber-800 font-semibold">페이지</th>
                        <th className="text-left p-2 text-amber-800 font-semibold">상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scannedIssues.map((issue, idx) => (
                        <tr key={idx} className={`border-t border-indigo-50 ${
                          issue.status === 'processing'
                            ? 'bg-amber-50'
                            : issue.status !== 'completed'
                              ? 'bg-yellow-50'
                              : 'bg-white'
                        }`}>
                          <td className="p-2 text-gray-900">{issue.issueNumber}호</td>
                          <td className="p-2 text-gray-900">{issue.issueDate}</td>
                          <td className="p-2 text-gray-900">{issue.pageCount || issue.imageUrls?.length}면</td>
                          <td className="p-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              issue.status === 'completed'
                                ? 'bg-green-100 text-green-700'
                                : issue.status === 'processing'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {issue.status === 'completed' ? '완료' : issue.status === 'processing' ? '처리중...' : '대기'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 처리 결과 */}
            {crawlResults.length > 0 && (
              <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6">
                <h2 className="text-lg font-semibold text-indigo-900 mb-4">처리 결과</h2>
                <div className="space-y-2">
                  {crawlResults.map((result, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg ${
                        result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {result.issueDate} ({result.issueNumber}호)
                        </span>
                        <span className={`text-sm ${result.success ? 'text-green-600' : 'text-red-600'}`}>
                          {result.success
                            ? `${result.articles}개 기사, ${result.chunks}개 청크`
                            : result.error
                          }
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* =============== 업로드 탭 =============== */}
        {activeTab === 'upload' && (
          <div className="space-y-6">
            <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6">
              <h2 className="text-lg font-semibold text-indigo-900 mb-4">PDF/이미지 업로드</h2>
              <p className="text-sm text-gray-600 mb-4">
                열한시 신문 PDF 또는 이미지 파일을 업로드하세요. 파일명에 호수 정보가 포함되어야 합니다.
              </p>
              <p className="text-xs text-gray-500 mb-4">
                예: 열한시504호.pdf, 열한시504호-1.jpg, 2026년1월호.pdf
              </p>

              <div className="border-2 border-dashed border-amber-200 rounded-xl p-8 text-center hover:border-indigo-400 transition-colors bg-amber-50/50">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                />
                <label
                  htmlFor="file-upload"
                  className="cursor-pointer"
                >
                  <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center shadow-lg">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <p className="text-gray-700 font-medium mb-2">
                    파일을 선택하거나 드래그하세요
                  </p>
                  <p className="text-sm text-gray-500">
                    PDF, JPG, PNG 파일 (최대 50MB)
                  </p>
                </label>
              </div>

              {uploadLoading && (
                <div className="mt-4 p-4 bg-amber-50 rounded-lg border border-amber-100">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                    <span className="text-amber-700">파일 처리 중...</span>
                  </div>
                </div>
              )}
            </div>

            {/* 업로드 결과 */}
            {uploadResults.length > 0 && (
              <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6">
                <h2 className="text-lg font-semibold text-indigo-900 mb-4">업로드 결과</h2>
                <div className="space-y-2">
                  {uploadResults.map((result, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg ${
                        result.status === 'processed'
                          ? 'bg-green-50 border border-green-200'
                          : result.status === 'skipped'
                          ? 'bg-gray-50 border border-gray-200'
                          : 'bg-red-50 border border-red-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{result.filename}</span>
                        <span className={`text-xs ${
                          result.status === 'processed'
                            ? 'text-green-600'
                            : result.status === 'skipped'
                            ? 'text-gray-600'
                            : 'text-red-600'
                        }`}>
                          {result.status === 'processed'
                            ? `완료 - ${result.articles}개 기사`
                            : result.status === 'skipped'
                            ? '스킵 (중복)'
                            : result.error || '실패'
                          }
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* =============== 통계 탭 =============== */}
        {activeTab === 'stats' && (
          <div className="space-y-6">
            <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6">
              <h2 className="text-lg font-semibold text-indigo-900 mb-4">데이터 통계</h2>

              {crawlStatus && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-amber-600 rounded-xl p-4 text-white shadow-sm">
                    <div className="text-3xl font-bold">{crawlStatus.completedIssues}</div>
                    <div className="text-indigo-200">처리된 호수</div>
                  </div>
                  <div className="bg-purple-600 rounded-xl p-4 text-white shadow-sm">
                    <div className="text-3xl font-bold">{crawlStatus.totalArticles}</div>
                    <div className="text-purple-200">전체 기사</div>
                  </div>
                  <div className="bg-indigo-800 rounded-xl p-4 text-white shadow-sm">
                    <div className="text-3xl font-bold">{crawlStatus.totalChunks}</div>
                    <div className="text-indigo-300">벡터 청크</div>
                  </div>
                  <div className="bg-green-600 rounded-xl p-4 text-white shadow-sm">
                    <div className="text-3xl font-bold">
                      {((crawlStatus.completedIssues / Math.max(crawlStatus.totalIssues, 1)) * 100).toFixed(0)}%
                    </div>
                    <div className="text-green-200">완료율</div>
                  </div>
                </div>
              )}

              <p className="text-sm text-gray-600">
                2020년 2월호부터 현재까지의 열한시 신문 데이터가 벡터화되어 검색 가능합니다.
              </p>
            </div>

            {/* 완료된 호수 목록 */}
            <div className="bg-white/95 rounded-xl border border-amber-100 shadow-sm p-6">
              <h2 className="text-lg font-semibold text-indigo-900 mb-4">벡터 임베딩 완료된 호수 목록</h2>

              {issuesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <span className="ml-2 text-gray-500">호수 목록 로딩 중...</span>
                </div>
              ) : completedIssues.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>아직 임베딩된 호수가 없습니다.</p>
                  <p className="text-sm mt-1">크롤링 탭에서 신문을 처리해주세요.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-amber-50">
                      <tr>
                        <th className="text-left p-3 font-semibold text-amber-800">호수</th>
                        <th className="text-left p-3 font-semibold text-amber-800">발행일</th>
                        <th className="text-center p-3 font-semibold text-amber-800">페이지</th>
                        <th className="text-center p-3 font-semibold text-amber-800">기사 수</th>
                        <th className="text-center p-3 font-semibold text-amber-800">청크 수</th>
                        <th className="text-left p-3 font-semibold text-amber-800">처리일</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-indigo-50">
                      {completedIssues.map((issue) => (
                        <tr key={issue.id} className="hover:bg-amber-50 transition-colors">
                          <td className="p-3">
                            <span className="font-medium text-gray-900">제{issue.issue_number}호</span>
                          </td>
                          <td className="p-3 text-gray-700">{issue.issue_date}</td>
                          <td className="p-3 text-center text-gray-600">{issue.page_count}면</td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">
                              {issue.articleCount}개
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">
                              {issue.chunkCount}개
                            </span>
                          </td>
                          <td className="p-3 text-gray-500 text-xs">
                            {new Date(issue.created_at).toLocaleDateString('ko-KR')}
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
