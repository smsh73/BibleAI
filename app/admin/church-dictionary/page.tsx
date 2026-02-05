'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import ResponsiveNav from '@/components/ResponsiveNav'

// 타입 정의
interface Church {
  id: number
  name: string
  code: string
  homepageUrl: string
  lastCrawled?: string
}

interface PageInfo {
  url: string
  title: string
  pageType: string
  depth: number
  contentType?: string
  crawled?: boolean
  crawlError?: string
  children?: PageInfo[]
  extractedData?: {
    title?: string
    description?: string
    keywords?: string
    images?: number
    links?: number
    forms?: number
  }
}

interface ContactInfo {
  phones: string[]
  emails: string[]
  fax?: string
  address?: string
  postalCode?: string
}

interface SocialMediaInfo {
  youtube?: string
  facebook?: string
  instagram?: string
  twitter?: string
  blog?: string
  kakao?: string
  naverBlog?: string
  naverCafe?: string
  naverTv?: string
  other: { platform: string; url: string }[]
}

interface MediaInfo {
  logo?: string
  bannerImages: string[]
  galleryImages: string[]
  videos: { url: string; title: string; platform?: string }[]
  documents: { url: string; title: string; type: string }[]
}

interface WorshipTimeInfo {
  name: string
  day: string
  time: string
  location?: string
  notes?: string
}

interface SiteStructure {
  church: { name: string; code: string; url: string }
  navigation: PageInfo[]
  boards: PageInfo[]
  specialPages: PageInfo[]
  metadata: {
    totalPages: number
    maxDepth: number
    hasLogin: boolean
    hasMobileVersion: boolean
    technologies: string[]
  }
  // 확장된 정보
  contacts?: ContactInfo
  socialMedia?: SocialMediaInfo
  media?: MediaInfo
  worshipTimes?: WorshipTimeInfo[]
}

interface DictionaryEntry {
  term: string
  category: string
  subcategory?: string
  definition?: string
  aliases?: string[]
  relatedTerms?: string[]
  sourceUrl?: string
}

interface CrawlLog {
  id: number
  crawl_type: string
  status: string
  pages_crawled: number
  items_extracted: number
  errors_count: number
  started_at: string
  completed_at: string
  result_summary: any
}

interface CrawlResult {
  success: boolean
  message?: string
  result?: {
    churchId: number
    crawlTime: number
    totalPages: number
    crawledPages: number
    navigationCount: number
    boardsCount: number
    popupsCount: number
    dictionaryCount: number
    taxonomyCount: number
    errorsCount: number
    deepCrawl: boolean
    maxDepth: number
    // 확장 정보
    contactsCount?: number
    socialMediaCount?: number
    mediaCount?: number
    worshipTimesCount?: number
  }
  errors?: string[]
}

type TabType = 'dashboard' | 'crawler' | 'structure' | 'dictionary' | 'settings'

export default function ChurchDictionaryAdmin() {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard')
  const [churches, setChurches] = useState<Church[]>([])
  const [selectedChurch, setSelectedChurch] = useState<string>('')
  const [structure, setStructure] = useState<SiteStructure | null>(null)
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([])
  const [crawlLogs, setCrawlLogs] = useState<CrawlLog[]>([])
  const [loading, setLoading] = useState(false)
  const [crawling, setCrawling] = useState(false)
  const [crawlProgress, setCrawlProgress] = useState<string[]>([])
  const [lastCrawlResult, setLastCrawlResult] = useState<CrawlResult | null>(null)

  // 트리 확장/축소 상태
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [selectedNode, setSelectedNode] = useState<PageInfo | null>(null)

  const [crawlOptions, setCrawlOptions] = useState({
    deepCrawl: false,
    maxDepth: 3,
    maxPages: 100,
    delayMs: 500,
    extractPeople: true,
    extractBoards: true,
    extractContacts: true,
    extractMedia: true
  })

  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [newChurch, setNewChurch] = useState({ name: '', code: '', homepageUrl: '', denomination: '' })

  const logContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadChurches()
  }, [])

  useEffect(() => {
    if (selectedChurch) {
      loadChurchData()
    }
  }, [selectedChurch])

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [crawlProgress])

  // 모든 노드 확장
  const expandAll = useCallback(() => {
    const allIds = new Set<string>()
    const collectIds = (nodes: PageInfo[], prefix: string = '') => {
      nodes.forEach((node, i) => {
        const id = `${prefix}${i}-${node.title}`
        if (node.children && node.children.length > 0) {
          allIds.add(id)
          collectIds(node.children, `${id}-`)
        }
      })
    }
    if (structure?.navigation) {
      collectIds(structure.navigation)
    }
    setExpandedNodes(allIds)
  }, [structure])

  // 모든 노드 축소
  const collapseAll = useCallback(() => {
    setExpandedNodes(new Set())
  }, [])

  // 노드 토글
  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  const loadChurches = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/church-crawler?action=list')
      const data = await res.json()
      if (data.success) {
        setChurches(data.churches)
        if (data.churches.length > 0 && !selectedChurch) {
          setSelectedChurch(data.churches[0].code)
        }
      }
    } catch (error) {
      console.error('Failed to load churches:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadChurchData = async () => {
    if (!selectedChurch) return
    setLoading(true)
    try {
      const [structureRes, dictionaryRes, logsRes] = await Promise.all([
        fetch(`/api/admin/church-crawler?action=structure&churchCode=${selectedChurch}`),
        fetch(`/api/admin/church-crawler?action=dictionary&churchCode=${selectedChurch}`),
        fetch(`/api/admin/church-crawler?action=logs&churchCode=${selectedChurch}`)
      ])

      const [structureData, dictionaryData, logsData] = await Promise.all([
        structureRes.json(),
        dictionaryRes.json(),
        logsRes.json()
      ])

      if (structureData.success) setStructure(structureData.structure)
      if (dictionaryData.success) setDictionary(dictionaryData.dictionary || [])
      if (logsData.success) setCrawlLogs(logsData.logs || [])
    } catch (error) {
      console.error('Failed to load church data:', error)
    } finally {
      setLoading(false)
    }
  }

  const startCrawl = async () => {
    if (!selectedChurch || crawling) return

    setCrawling(true)
    setCrawlProgress([`크롤링 시작: ${selectedChurch}`])
    setLastCrawlResult(null)

    try {
      setCrawlProgress(prev => [...prev, `옵션: deepCrawl=${crawlOptions.deepCrawl}, maxDepth=${crawlOptions.maxDepth}, maxPages=${crawlOptions.maxPages}`])

      const res = await fetch('/api/admin/church-crawler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'crawl',
          churchCode: selectedChurch,
          options: crawlOptions
        })
      })

      const result: CrawlResult = await res.json()
      setLastCrawlResult(result)

      if (result.success && result.result) {
        setCrawlProgress(prev => [
          ...prev,
          `완료`,
          `  총 페이지: ${result.result!.totalPages}`,
          `  메뉴: ${result.result!.navigationCount}개`,
          `  게시판: ${result.result!.boardsCount}개`,
          `  팝업: ${result.result!.popupsCount}개`,
          `  사전: ${result.result!.dictionaryCount}개`,
          `  연락처: ${result.result!.contactsCount || 0}개`,
          `  소셜미디어: ${result.result!.socialMediaCount || 0}개`,
          `  미디어: ${result.result!.mediaCount || 0}개`,
          `  예배시간: ${result.result!.worshipTimesCount || 0}개`,
          `  에러: ${result.result!.errorsCount}개`,
          `  소요시간: ${(result.result!.crawlTime / 1000).toFixed(1)}초`
        ])
        await loadChurchData()
      } else {
        setCrawlProgress(prev => [...prev, `실패: ${result.errors?.join(', ')}`])
      }
    } catch (error: any) {
      setCrawlProgress(prev => [...prev, `오류: ${error.message}`])
    } finally {
      setCrawling(false)
    }
  }

  const addChurch = async () => {
    if (!newChurch.name || !newChurch.code || !newChurch.homepageUrl) return

    try {
      const res = await fetch('/api/admin/church-crawler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addChurch',
          ...newChurch
        })
      })

      const data = await res.json()
      if (data.success) {
        setShowAddModal(false)
        setNewChurch({ name: '', code: '', homepageUrl: '', denomination: '' })
        await loadChurches()
      }
    } catch (error) {
      console.error('Failed to add church:', error)
    }
  }

  const filteredDictionary = dictionary.filter(entry => {
    const matchesSearch = !searchTerm ||
      entry.term.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.definition?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory = categoryFilter === 'all' || entry.category === categoryFilter
    return matchesSearch && matchesCategory
  })

  const categories = [...new Set(dictionary.map(d => d.category))]

  // 총 메뉴 수 계산
  const countTotalMenus = (nodes: PageInfo[]): number => {
    let count = 0
    for (const node of nodes) {
      count++
      if (node.children) {
        count += countTotalMenus(node.children)
      }
    }
    return count
  }

  // 트리 노드 렌더링 (개선된 버전)
  const renderTreeNode = (node: PageInfo, level: number = 0, prefix: string = ''): React.ReactNode => {
    const indent = level * 16
    const hasChildren = node.children && node.children.length > 0
    const nodeId = `${prefix}${level}-${node.title}`
    const isExpanded = expandedNodes.has(nodeId)
    const isSelected = selectedNode?.url === node.url && selectedNode?.title === node.title

    return (
      <div key={nodeId}>
        <div
          className={`flex items-center py-1.5 px-2 rounded cursor-pointer group transition-colors ${
            isSelected ? 'bg-indigo-100' : 'hover:bg-indigo-50'
          } ${node.crawled ? 'text-gray-800' : 'text-gray-500'}`}
          style={{ paddingLeft: `${indent + 8}px` }}
          onClick={() => setSelectedNode(node)}
        >
          {/* 확장/축소 버튼 */}
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleNode(nodeId); }}
              className="w-5 h-5 flex items-center justify-center mr-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-100 rounded transition-colors"
            >
              {isExpanded ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              )}
            </button>
          ) : (
            <span className="w-5 h-5 mr-1" />
          )}

          {/* 상태 표시 */}
          <span className={`w-2 h-2 rounded-full mr-2 flex-shrink-0 ${
            node.crawled ? 'bg-emerald-400' :
            node.crawlError ? 'bg-red-400' :
            'bg-gray-300'
          }`} />

          {/* 타입 뱃지 */}
          <span className={`text-xs px-1.5 py-0.5 rounded mr-2 font-medium ${
            node.pageType === 'menu' ? 'bg-indigo-100 text-indigo-700' :
            node.pageType === 'submenu' ? 'bg-purple-100 text-purple-700' :
            node.pageType === 'board' ? 'bg-amber-100 text-amber-700' :
            node.pageType === 'popup' ? 'bg-rose-100 text-rose-700' :
            'bg-gray-100 text-gray-600'
          }`}>
            {node.pageType}
          </span>

          {/* 제목 */}
          <span className="font-medium truncate flex-1 text-gray-700">{node.title}</span>

          {/* 자식 수 */}
          {hasChildren && (
            <span className="text-xs text-gray-400 mr-2">
              ({node.children!.length})
            </span>
          )}

          {/* 링크 버튼 */}
          {node.url && (
            <a
              href={node.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-600 hover:text-indigo-800 opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
              onClick={e => e.stopPropagation()}
            >
              열기
            </a>
          )}
        </div>

        {/* 자식 노드 */}
        {hasChildren && isExpanded && (
          <div className="border-l border-indigo-100 ml-4">
            {node.children!.map((child, i) => renderTreeNode(child, level + 1, `${nodeId}-`))}
          </div>
        )}
      </div>
    )
  }

  const currentChurch = churches.find(c => c.code === selectedChurch)
  const totalMenuCount = structure?.navigation ? countTotalMenus(structure.navigation) : 0

  return (
    <div className="relative flex flex-col min-h-screen overflow-hidden">
      {/* 배경 */}
      <div className="absolute inset-0 bg-white" />
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-white to-purple-50" />

      {/* 메인 */}
      <div className="relative flex flex-col h-full z-10">
        {/* 헤더 */}
        <header className="flex-shrink-0 px-4 py-2 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-semibold text-indigo-900">교회 크롤러 관리</h1>
                <select
                  value={selectedChurch}
                  onChange={e => setSelectedChurch(e.target.value)}
                  className="px-3 py-1 bg-white/80 border border-indigo-200 rounded text-indigo-800 text-sm focus:outline-none focus:border-indigo-400 cursor-pointer"
                >
                  {churches.map(church => (
                    <option key={church.code} value={church.code}>
                      {church.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <ResponsiveNav />
                <span className="text-gray-300 hidden sm:inline">|</span>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="text-indigo-700 hover:text-indigo-900 hover:underline text-sm font-medium"
                >
                  교회 추가
                </button>
              </div>
            </div>

            {/* 탭 */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {([
                { id: 'dashboard', label: '대시보드' },
                { id: 'crawler', label: '크롤러' },
                { id: 'structure', label: '사이트 구조' },
                { id: 'dictionary', label: '사전' },
                { id: 'settings', label: '설정' }
              ] as { id: TabType; label: string }[]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-white text-indigo-800 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* 콘텐츠 */}
        <main className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-7xl mx-auto">
            {/* 대시보드 */}
            {activeTab === 'dashboard' && (
              <div className="space-y-6 animate-fade-in">
                {/* 통계 카드 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white/95 rounded-2xl rounded-bl-sm p-5 shadow-sm border border-indigo-100">
                    <div className="text-sm text-gray-500 mb-1">등록된 교회</div>
                    <div className="text-3xl font-bold text-indigo-700">{churches.length}</div>
                  </div>
                  <div className="bg-white/95 rounded-2xl rounded-bl-sm p-5 shadow-sm border border-purple-100">
                    <div className="text-sm text-gray-500 mb-1">총 메뉴</div>
                    <div className="text-3xl font-bold text-purple-700">{totalMenuCount}</div>
                  </div>
                  <div className="bg-white/95 rounded-2xl rounded-bl-sm p-5 shadow-sm border border-emerald-100">
                    <div className="text-sm text-gray-500 mb-1">사전 항목</div>
                    <div className="text-3xl font-bold text-emerald-700">{dictionary.length}</div>
                  </div>
                  <div className="bg-white/95 rounded-2xl rounded-bl-sm p-5 shadow-sm border border-amber-100">
                    <div className="text-sm text-gray-500 mb-1">게시판</div>
                    <div className="text-3xl font-bold text-amber-700">{structure?.boards.length || 0}</div>
                  </div>
                </div>

                {/* 교회 정보 + 로그 */}
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="bg-white/95 rounded-2xl rounded-bl-sm p-6 shadow-sm border border-indigo-100">
                    <h3 className="text-base font-semibold text-indigo-900 mb-4">현재 교회 정보</h3>
                    {currentChurch && (
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between py-2 border-b border-gray-100">
                          <span className="text-gray-500">교회명</span>
                          <span className="font-medium text-gray-800">{currentChurch.name}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-gray-100">
                          <span className="text-gray-500">코드</span>
                          <span className="font-mono text-xs bg-indigo-50 px-2 py-0.5 rounded text-indigo-700">{currentChurch.code}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-gray-100">
                          <span className="text-gray-500">홈페이지</span>
                          <a href={currentChurch.homepageUrl} target="_blank" rel="noopener noreferrer"
                             className="text-indigo-700 hover:text-indigo-900 hover:underline text-xs truncate max-w-[200px]">
                            {currentChurch.homepageUrl}
                          </a>
                        </div>
                        <div className="flex justify-between py-2">
                          <span className="text-gray-500">마지막 크롤링</span>
                          <span className="text-gray-700">
                            {currentChurch.lastCrawled
                              ? new Date(currentChurch.lastCrawled).toLocaleString('ko-KR')
                              : '-'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="bg-white/95 rounded-2xl rounded-bl-sm p-6 shadow-sm border border-indigo-100">
                    <h3 className="text-base font-semibold text-indigo-900 mb-4">최근 크롤링 기록</h3>
                    <div className="space-y-2 max-h-52 overflow-y-auto">
                      {crawlLogs.slice(0, 5).map(log => (
                        <div key={log.id} className="flex items-center justify-between py-2 px-3 bg-indigo-50/50 rounded-lg text-sm">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${
                              log.status === 'completed' ? 'bg-emerald-400' :
                              log.status === 'failed' ? 'bg-red-400' :
                              'bg-amber-400'
                            }`} />
                            <span className="text-gray-700">{log.crawl_type}</span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span>{log.pages_crawled} 페이지</span>
                            <span>{new Date(log.completed_at).toLocaleDateString('ko-KR')}</span>
                          </div>
                        </div>
                      ))}
                      {crawlLogs.length === 0 && (
                        <div className="text-gray-400 text-center py-8 text-sm">
                          크롤링 기록이 없습니다
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 빠른 실행 */}
                <div className="bg-indigo-600 rounded-2xl rounded-br-sm p-6 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold mb-1">빠른 크롤링 실행</h3>
                      <p className="text-indigo-200 text-sm">
                        {currentChurch?.name}의 홈페이지를 크롤링하여 구조와 정보를 추출합니다.
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => { setCrawlOptions(opt => ({ ...opt, deepCrawl: false })); startCrawl(); }}
                        disabled={crawling}
                        className="px-5 py-2.5 bg-white text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-50 transition-all disabled:opacity-50"
                      >
                        {crawling ? '실행 중...' : '기본 크롤링'}
                      </button>
                      <button
                        onClick={() => { setCrawlOptions(opt => ({ ...opt, deepCrawl: true })); startCrawl(); }}
                        disabled={crawling}
                        className="px-5 py-2.5 bg-indigo-700 text-white rounded-lg text-sm font-medium hover:bg-indigo-800 transition-all disabled:opacity-50 border border-indigo-400"
                      >
                        {crawling ? '실행 중...' : '딥 크롤링'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 확장 정보 */}
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* 연락처 */}
                  <div className="bg-white/95 rounded-2xl rounded-bl-sm p-5 shadow-sm border border-blue-100">
                    <h4 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      연락처
                    </h4>
                    {structure?.contacts && (structure.contacts.phones.length > 0 || structure.contacts.emails.length > 0) ? (
                      <div className="space-y-2 text-xs">
                        {structure.contacts.phones.map((phone, i) => (
                          <div key={i} className="flex items-center gap-2 text-gray-700">
                            <span className="text-blue-500">TEL</span>
                            <a href={`tel:${phone}`} className="hover:text-blue-700 hover:underline">{phone}</a>
                          </div>
                        ))}
                        {structure.contacts.fax && (
                          <div className="flex items-center gap-2 text-gray-600">
                            <span className="text-gray-400">FAX</span>
                            <span>{structure.contacts.fax}</span>
                          </div>
                        )}
                        {structure.contacts.emails.map((email, i) => (
                          <div key={i} className="flex items-center gap-2 text-gray-700">
                            <span className="text-blue-500">@</span>
                            <a href={`mailto:${email}`} className="hover:text-blue-700 hover:underline truncate">{email}</a>
                          </div>
                        ))}
                        {structure.contacts.address && (
                          <div className="pt-2 border-t border-gray-100 text-gray-600">
                            {structure.contacts.postalCode && <span className="text-gray-400">[{structure.contacts.postalCode}] </span>}
                            {structure.contacts.address}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-gray-400 text-xs">연락처 정보 없음</div>
                    )}
                  </div>

                  {/* 소셜 미디어 */}
                  <div className="bg-white/95 rounded-2xl rounded-bl-sm p-5 shadow-sm border border-pink-100">
                    <h4 className="text-sm font-semibold text-pink-900 mb-3 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      소셜 미디어
                    </h4>
                    {structure?.socialMedia && Object.keys(structure.socialMedia).filter(k => k !== 'other' && (structure.socialMedia as any)?.[k]).length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {structure.socialMedia.youtube && (
                          <a href={structure.socialMedia.youtube} target="_blank" rel="noopener noreferrer"
                             className="px-2 py-1 bg-red-50 text-red-700 rounded text-xs hover:bg-red-100 transition-colors">
                            YouTube
                          </a>
                        )}
                        {structure.socialMedia.facebook && (
                          <a href={structure.socialMedia.facebook} target="_blank" rel="noopener noreferrer"
                             className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs hover:bg-blue-100 transition-colors">
                            Facebook
                          </a>
                        )}
                        {structure.socialMedia.instagram && (
                          <a href={structure.socialMedia.instagram} target="_blank" rel="noopener noreferrer"
                             className="px-2 py-1 bg-pink-50 text-pink-700 rounded text-xs hover:bg-pink-100 transition-colors">
                            Instagram
                          </a>
                        )}
                        {structure.socialMedia.kakao && (
                          <a href={structure.socialMedia.kakao} target="_blank" rel="noopener noreferrer"
                             className="px-2 py-1 bg-yellow-50 text-yellow-700 rounded text-xs hover:bg-yellow-100 transition-colors">
                            Kakao
                          </a>
                        )}
                        {structure.socialMedia.naverBlog && (
                          <a href={structure.socialMedia.naverBlog} target="_blank" rel="noopener noreferrer"
                             className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs hover:bg-green-100 transition-colors">
                            Naver Blog
                          </a>
                        )}
                        {structure.socialMedia.naverCafe && (
                          <a href={structure.socialMedia.naverCafe} target="_blank" rel="noopener noreferrer"
                             className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs hover:bg-green-100 transition-colors">
                            Naver Cafe
                          </a>
                        )}
                        {structure.socialMedia.blog && (
                          <a href={structure.socialMedia.blog} target="_blank" rel="noopener noreferrer"
                             className="px-2 py-1 bg-gray-50 text-gray-700 rounded text-xs hover:bg-gray-100 transition-colors">
                            Blog
                          </a>
                        )}
                      </div>
                    ) : (
                      <div className="text-gray-400 text-xs">소셜 미디어 없음</div>
                    )}
                  </div>

                  {/* 미디어 */}
                  <div className="bg-white/95 rounded-2xl rounded-bl-sm p-5 shadow-sm border border-orange-100">
                    <h4 className="text-sm font-semibold text-orange-900 mb-3 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      미디어
                    </h4>
                    {structure?.media && (structure.media.logo || structure.media.bannerImages.length > 0 || structure.media.videos.length > 0) ? (
                      <div className="space-y-2 text-xs">
                        {structure.media.logo && (
                          <div className="flex items-center gap-2">
                            <img src={structure.media.logo} alt="Logo" className="w-8 h-8 object-contain rounded"
                                 onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            <span className="text-gray-600">로고</span>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1 text-gray-600">
                          {structure.media.bannerImages.length > 0 && (
                            <span className="px-2 py-0.5 bg-orange-50 rounded">배너 {structure.media.bannerImages.length}개</span>
                          )}
                          {structure.media.galleryImages.length > 0 && (
                            <span className="px-2 py-0.5 bg-orange-50 rounded">갤러리 {structure.media.galleryImages.length}개</span>
                          )}
                          {structure.media.videos.length > 0 && (
                            <span className="px-2 py-0.5 bg-orange-50 rounded">비디오 {structure.media.videos.length}개</span>
                          )}
                          {structure.media.documents.length > 0 && (
                            <span className="px-2 py-0.5 bg-orange-50 rounded">문서 {structure.media.documents.length}개</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-gray-400 text-xs">미디어 정보 없음</div>
                    )}
                  </div>

                  {/* 예배 시간 */}
                  <div className="bg-white/95 rounded-2xl rounded-bl-sm p-5 shadow-sm border border-violet-100">
                    <h4 className="text-sm font-semibold text-violet-900 mb-3 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      예배 시간
                    </h4>
                    {structure?.worshipTimes && structure.worshipTimes.length > 0 ? (
                      <div className="space-y-1.5 text-xs max-h-28 overflow-y-auto">
                        {structure.worshipTimes.slice(0, 5).map((wt, i) => (
                          <div key={i} className="flex items-center justify-between text-gray-700 py-1 border-b border-gray-50 last:border-0">
                            <span className="font-medium truncate mr-2">{wt.name}</span>
                            <span className="text-gray-500 text-xs whitespace-nowrap">{wt.day} {wt.time}</span>
                          </div>
                        ))}
                        {structure.worshipTimes.length > 5 && (
                          <div className="text-gray-400 text-center pt-1">
                            +{structure.worshipTimes.length - 5}개 더
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-gray-400 text-xs">예배 시간 정보 없음</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 크롤러 */}
            {activeTab === 'crawler' && (
              <div className="space-y-6 animate-fade-in">
                <div className="grid md:grid-cols-3 gap-6">
                  {/* 설정 */}
                  <div className="md:col-span-1 bg-white/95 rounded-2xl rounded-bl-sm p-6 shadow-sm border border-indigo-100">
                    <h3 className="text-base font-semibold text-indigo-900 mb-4">크롤링 설정</h3>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between py-3 border-b border-gray-100">
                        <div>
                          <div className="font-medium text-gray-800 text-sm">딥 크롤링</div>
                          <div className="text-xs text-gray-500">실제 서브페이지 방문</div>
                        </div>
                        <button
                          onClick={() => setCrawlOptions(opt => ({ ...opt, deepCrawl: !opt.deepCrawl }))}
                          className={`w-12 h-6 rounded-full transition-colors ${
                            crawlOptions.deepCrawl ? 'bg-indigo-500' : 'bg-gray-200'
                          }`}
                        >
                          <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                            crawlOptions.deepCrawl ? 'translate-x-7' : 'translate-x-1'
                          }`} />
                        </button>
                      </div>

                      <div className="py-3 border-b border-gray-100">
                        <div className="flex justify-between mb-2">
                          <span className="text-sm font-medium text-gray-800">최대 깊이</span>
                          <span className="text-sm text-indigo-700 font-bold">{crawlOptions.maxDepth}</span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          value={crawlOptions.maxDepth}
                          onChange={e => setCrawlOptions(opt => ({ ...opt, maxDepth: Number(e.target.value) }))}
                          className="w-full accent-indigo-500"
                        />
                      </div>

                      <div className="py-3 border-b border-gray-100">
                        <div className="flex justify-between mb-2">
                          <span className="text-sm font-medium text-gray-800">최대 페이지</span>
                          <span className="text-sm text-indigo-700 font-bold">{crawlOptions.maxPages}</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="500"
                          step="10"
                          value={crawlOptions.maxPages}
                          onChange={e => setCrawlOptions(opt => ({ ...opt, maxPages: Number(e.target.value) }))}
                          className="w-full accent-indigo-500"
                        />
                      </div>

                      <div className="py-3 border-b border-gray-100">
                        <div className="flex justify-between mb-2">
                          <span className="text-sm font-medium text-gray-800">요청 간격</span>
                          <span className="text-sm text-indigo-700 font-bold">{crawlOptions.delayMs}ms</span>
                        </div>
                        <input
                          type="range"
                          min="100"
                          max="2000"
                          step="100"
                          value={crawlOptions.delayMs}
                          onChange={e => setCrawlOptions(opt => ({ ...opt, delayMs: Number(e.target.value) }))}
                          className="w-full accent-indigo-500"
                        />
                      </div>

                      <div className="space-y-3 py-3">
                        <label className="flex items-center gap-3 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={crawlOptions.extractPeople}
                            onChange={e => setCrawlOptions(opt => ({ ...opt, extractPeople: e.target.checked }))}
                            className="w-4 h-4 accent-indigo-500 rounded"
                          />
                          <span className="text-gray-700">인물 정보 추출</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={crawlOptions.extractBoards}
                            onChange={e => setCrawlOptions(opt => ({ ...opt, extractBoards: e.target.checked }))}
                            className="w-4 h-4 accent-indigo-500 rounded"
                          />
                          <span className="text-gray-700">게시판 구조 추출</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={crawlOptions.extractContacts}
                            onChange={e => setCrawlOptions(opt => ({ ...opt, extractContacts: e.target.checked }))}
                            className="w-4 h-4 accent-indigo-500 rounded"
                          />
                          <span className="text-gray-700">연락처 정보 추출</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={crawlOptions.extractMedia}
                            onChange={e => setCrawlOptions(opt => ({ ...opt, extractMedia: e.target.checked }))}
                            className="w-4 h-4 accent-indigo-500 rounded"
                          />
                          <span className="text-gray-700">미디어 정보 추출</span>
                        </label>
                      </div>

                      <button
                        onClick={startCrawl}
                        disabled={crawling}
                        className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all ${
                          crawling
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
                        }`}
                      >
                        {crawling ? '크롤링 중...' : '크롤링 시작'}
                      </button>
                    </div>
                  </div>

                  {/* 로그 */}
                  <div className="md:col-span-2 bg-gray-900 rounded-2xl rounded-br-sm p-6 text-white">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-base font-semibold">크롤링 로그</h3>
                      {crawling && (
                        <span className="flex items-center gap-2 text-emerald-400 text-xs">
                          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                          실행 중
                        </span>
                      )}
                    </div>
                    <div
                      ref={logContainerRef}
                      className="font-mono text-xs bg-black/50 rounded-xl p-4 h-72 overflow-y-auto"
                    >
                      {crawlProgress.length === 0 ? (
                        <div className="text-gray-500">크롤링을 시작하면 로그가 표시됩니다.</div>
                      ) : (
                        crawlProgress.map((log, i) => (
                          <div key={i} className={`py-0.5 ${
                            log === '완료' ? 'text-emerald-400' :
                            log.startsWith('실패') || log.startsWith('오류') ? 'text-red-400' :
                            log.startsWith('  ') ? 'text-gray-400' :
                            'text-gray-200'
                          }`}>
                            {log}
                          </div>
                        ))
                      )}
                    </div>

                    {lastCrawlResult?.result && (
                      <div className="mt-4 grid grid-cols-4 gap-3">
                        <div className="bg-indigo-500/20 rounded-lg p-3 text-center">
                          <div className="text-xl font-bold">{lastCrawlResult.result.navigationCount}</div>
                          <div className="text-xs text-indigo-300">메뉴</div>
                        </div>
                        <div className="bg-purple-500/20 rounded-lg p-3 text-center">
                          <div className="text-xl font-bold">{lastCrawlResult.result.boardsCount}</div>
                          <div className="text-xs text-purple-300">게시판</div>
                        </div>
                        <div className="bg-rose-500/20 rounded-lg p-3 text-center">
                          <div className="text-xl font-bold">{lastCrawlResult.result.popupsCount}</div>
                          <div className="text-xs text-rose-300">팝업</div>
                        </div>
                        <div className="bg-amber-500/20 rounded-lg p-3 text-center">
                          <div className="text-xl font-bold">{(lastCrawlResult.result.crawlTime / 1000).toFixed(1)}s</div>
                          <div className="text-xs text-amber-300">소요시간</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 전체 교회 */}
                <div className="bg-white/95 rounded-2xl rounded-bl-sm p-6 shadow-sm border border-indigo-100">
                  <h3 className="text-base font-semibold text-indigo-900 mb-4">전체 교회 현황</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    {churches.map(church => (
                      <div
                        key={church.code}
                        onClick={() => setSelectedChurch(church.code)}
                        className={`p-4 rounded-xl border-2 cursor-pointer transition-all text-sm ${
                          selectedChurch === church.code
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-gray-100 hover:border-indigo-200 bg-white'
                        }`}
                      >
                        <div className={`font-medium truncate ${selectedChurch === church.code ? 'text-indigo-800' : 'text-gray-800'}`}>
                          {church.name}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {church.lastCrawled
                            ? new Date(church.lastCrawled).toLocaleDateString('ko-KR')
                            : '미크롤링'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 구조 */}
            {activeTab === 'structure' && (
              <div className="space-y-6 animate-fade-in">
                <div className="grid md:grid-cols-3 gap-6">
                  {/* 트리 뷰 */}
                  <div className="md:col-span-2 bg-white/95 rounded-2xl rounded-bl-sm p-6 shadow-sm border border-indigo-100">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-base font-semibold text-indigo-900">
                        네비게이션 구조
                        <span className="text-sm font-normal text-gray-400 ml-2">
                          {totalMenuCount}개 메뉴
                        </span>
                      </h3>
                      <div className="flex gap-2">
                        <button
                          onClick={expandAll}
                          className="px-3 py-1 text-xs bg-indigo-50 text-indigo-700 rounded hover:bg-indigo-100 transition-colors font-medium"
                        >
                          모두 펼치기
                        </button>
                        <button
                          onClick={collapseAll}
                          className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors font-medium"
                        >
                          모두 접기
                        </button>
                      </div>
                    </div>
                    <div className="max-h-[600px] overflow-y-auto text-sm border border-gray-100 rounded-xl p-2 bg-gray-50/50">
                      {structure?.navigation.length ? (
                        structure.navigation.map((node, i) => renderTreeNode(node, 0, `nav-${i}-`))
                      ) : (
                        <div className="text-gray-400 text-center py-8">
                          구조 데이터가 없습니다. 크롤링을 먼저 실행해주세요.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 상세 정보 패널 */}
                  <div className="space-y-6">
                    {/* 선택된 노드 정보 */}
                    <div className="bg-white/95 rounded-2xl rounded-bl-sm p-6 shadow-sm border border-indigo-100">
                      <h3 className="text-base font-semibold text-indigo-900 mb-4">선택된 항목</h3>
                      {selectedNode ? (
                        <div className="space-y-3 text-sm">
                          <div className="py-2 border-b border-gray-100">
                            <div className="text-gray-500 text-xs mb-1">제목</div>
                            <div className="font-medium text-gray-800">{selectedNode.title}</div>
                          </div>
                          <div className="py-2 border-b border-gray-100">
                            <div className="text-gray-500 text-xs mb-1">타입</div>
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                              selectedNode.pageType === 'menu' ? 'bg-indigo-100 text-indigo-700' :
                              selectedNode.pageType === 'submenu' ? 'bg-purple-100 text-purple-700' :
                              selectedNode.pageType === 'board' ? 'bg-amber-100 text-amber-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {selectedNode.pageType}
                            </span>
                          </div>
                          {selectedNode.url && (
                            <div className="py-2 border-b border-gray-100">
                              <div className="text-gray-500 text-xs mb-1">URL</div>
                              <a
                                href={selectedNode.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-indigo-700 hover:underline text-xs break-all"
                              >
                                {selectedNode.url}
                              </a>
                            </div>
                          )}
                          <div className="py-2 border-b border-gray-100">
                            <div className="text-gray-500 text-xs mb-1">깊이</div>
                            <div className="font-medium text-gray-800">Level {selectedNode.depth}</div>
                          </div>
                          {selectedNode.children && selectedNode.children.length > 0 && (
                            <div className="py-2 border-b border-gray-100">
                              <div className="text-gray-500 text-xs mb-1">하위 메뉴</div>
                              <div className="font-medium text-gray-800">{selectedNode.children.length}개</div>
                            </div>
                          )}
                          <div className="py-2">
                            <div className="text-gray-500 text-xs mb-1">크롤링 상태</div>
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${
                                selectedNode.crawled ? 'bg-emerald-400' :
                                selectedNode.crawlError ? 'bg-red-400' :
                                'bg-gray-300'
                              }`} />
                              <span className="text-gray-700">
                                {selectedNode.crawled ? '완료' :
                                 selectedNode.crawlError ? '오류' : '대기'}
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-gray-400 text-center py-8 text-sm">
                          트리에서 항목을 선택하세요
                        </div>
                      )}
                    </div>

                    {/* 게시판 목록 */}
                    <div className="bg-white/95 rounded-2xl rounded-bl-sm p-6 shadow-sm border border-amber-100">
                      <h3 className="text-base font-semibold text-amber-900 mb-4">
                        게시판
                        <span className="text-sm font-normal text-gray-400 ml-2">
                          {structure?.boards.length || 0}개
                        </span>
                      </h3>
                      <div className="space-y-2 max-h-40 overflow-y-auto text-sm">
                        {structure?.boards.map((board, i) => (
                          <a
                            key={i}
                            href={board.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block py-2 px-3 bg-amber-50 rounded-lg text-amber-800 hover:bg-amber-100 transition-colors"
                          >
                            {board.title}
                          </a>
                        ))}
                        {(!structure?.boards || structure.boards.length === 0) && (
                          <div className="text-gray-400 text-center py-4">게시판이 없습니다</div>
                        )}
                      </div>
                    </div>

                    {/* 메타데이터 */}
                    <div className="bg-white/95 rounded-2xl rounded-bl-sm p-6 shadow-sm border border-purple-100">
                      <h3 className="text-base font-semibold text-purple-900 mb-4">메타데이터</h3>
                      {structure?.metadata ? (
                        <div className="space-y-3 text-sm">
                          <div className="flex justify-between py-2 border-b border-gray-100">
                            <span className="text-gray-500">총 페이지</span>
                            <span className="font-medium text-gray-800">{structure.metadata.totalPages}</span>
                          </div>
                          <div className="flex justify-between py-2 border-b border-gray-100">
                            <span className="text-gray-500">최대 깊이</span>
                            <span className="font-medium text-gray-800">{structure.metadata.maxDepth}</span>
                          </div>
                          {structure.metadata.technologies.length > 0 && (
                            <div className="py-2">
                              <div className="text-gray-500 mb-2">기술 스택</div>
                              <div className="flex flex-wrap gap-1">
                                {structure.metadata.technologies.map((tech, i) => (
                                  <span key={i} className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs">
                                    {tech}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-gray-400 text-center py-4 text-sm">데이터 없음</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 사전 */}
            {activeTab === 'dictionary' && (
              <div className="space-y-6 animate-fade-in">
                <div className="bg-white/95 rounded-2xl rounded-bl-sm p-4 shadow-sm border border-emerald-100">
                  <div className="flex flex-wrap gap-4 items-center">
                    <div className="flex-1 min-w-[200px]">
                      <input
                        type="text"
                        placeholder="검색어를 입력하세요..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full px-4 py-2 bg-emerald-50/50 border border-emerald-200 rounded-lg text-gray-800 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 placeholder-gray-400"
                      />
                    </div>
                    <select
                      value={categoryFilter}
                      onChange={e => setCategoryFilter(e.target.value)}
                      className="px-4 py-2 bg-emerald-50/50 border border-emerald-200 rounded-lg text-gray-800 text-sm"
                    >
                      <option value="all">전체 카테고리</option>
                      {categories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                    <div className="text-sm text-gray-500">
                      {filteredDictionary.length}개 항목
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredDictionary.map((entry, i) => (
                    <div key={i} className="bg-white/95 rounded-2xl rounded-bl-sm p-5 shadow-sm border border-emerald-100 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="text-base font-semibold text-gray-800">{entry.term}</h4>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          entry.category === '인물' ? 'bg-indigo-100 text-indigo-700' :
                          entry.category === '장소' ? 'bg-emerald-100 text-emerald-700' :
                          entry.category === '부서' ? 'bg-purple-100 text-purple-700' :
                          entry.category === '행사' ? 'bg-amber-100 text-amber-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {entry.category}
                        </span>
                      </div>
                      {entry.subcategory && (
                        <div className="text-xs text-gray-500 mb-2">{entry.subcategory}</div>
                      )}
                      {entry.definition && (
                        <p className="text-gray-600 text-sm line-clamp-2">{entry.definition}</p>
                      )}
                    </div>
                  ))}
                </div>

                {filteredDictionary.length === 0 && (
                  <div className="text-center py-16">
                    <p className="text-gray-500 text-base mb-2">
                      {dictionary.length === 0 ? '사전 데이터가 없습니다' : '검색 결과가 없습니다'}
                    </p>
                    {dictionary.length === 0 && (
                      <p className="text-gray-400 text-sm">
                        크롤링 시 인물 정보 추출을 활성화하거나, 딥크롤링을 실행해주세요.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 설정 */}
            {activeTab === 'settings' && (
              <div className="space-y-6 animate-fade-in">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="bg-white/95 rounded-2xl rounded-bl-sm p-6 shadow-sm border border-indigo-100">
                    <h3 className="text-base font-semibold text-indigo-900 mb-4">교회 정보 수정</h3>
                    {currentChurch && (
                      <div className="space-y-4 text-sm">
                        <div>
                          <label className="block text-gray-600 mb-1">교회명</label>
                          <input
                            type="text"
                            defaultValue={currentChurch.name}
                            className="w-full px-4 py-2 bg-indigo-50/50 border border-indigo-200 rounded-lg text-gray-800 focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="block text-gray-600 mb-1">홈페이지 URL</label>
                          <input
                            type="text"
                            defaultValue={currentChurch.homepageUrl}
                            className="w-full px-4 py-2 bg-indigo-50/50 border border-indigo-200 rounded-lg text-gray-800 focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <button className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium">
                          저장
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="bg-white/95 rounded-2xl rounded-bl-sm p-6 shadow-sm border border-indigo-100">
                    <h3 className="text-base font-semibold text-indigo-900 mb-4">데이터 관리</h3>
                    <div className="space-y-3 text-sm">
                      <button
                        onClick={loadChurchData}
                        className="w-full py-2.5 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors font-medium"
                      >
                        데이터 새로고침
                      </button>
                      <button className="w-full py-2.5 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors font-medium">
                        캐시 초기화
                      </button>
                      <button className="w-full py-2.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors font-medium">
                        크롤링 데이터 삭제
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-white/95 rounded-2xl rounded-bl-sm p-6 shadow-sm border border-indigo-100">
                  <h3 className="text-base font-semibold text-indigo-900 mb-4">API 엔드포인트</h3>
                  <div className="font-mono text-xs bg-indigo-50/50 rounded-xl p-4 space-y-2 text-gray-600">
                    <div><span className="text-emerald-600 font-medium">GET</span> /api/admin/church-crawler?action=list</div>
                    <div><span className="text-emerald-600 font-medium">GET</span> /api/admin/church-crawler?action=structure&churchCode=...</div>
                    <div><span className="text-emerald-600 font-medium">GET</span> /api/admin/church-crawler?action=dictionary&churchCode=...</div>
                    <div><span className="text-indigo-600 font-medium">POST</span> /api/admin/church-crawler {'{'} action: "crawl", churchCode: "..." {'}'}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 교회 추가 모달 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl rounded-bl-sm p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-indigo-900 mb-4">새 교회 추가</h3>
            <div className="space-y-4 text-sm">
              <div>
                <label className="block text-gray-600 mb-1">교회명 *</label>
                <input
                  type="text"
                  value={newChurch.name}
                  onChange={e => setNewChurch(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="예: 서울중앙교회"
                  className="w-full px-4 py-2 bg-white border border-indigo-200 rounded-lg text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">교회 코드 *</label>
                <input
                  type="text"
                  value={newChurch.code}
                  onChange={e => setNewChurch(prev => ({ ...prev, code: e.target.value }))}
                  placeholder="예: seoulcentral (영문 소문자)"
                  className="w-full px-4 py-2 bg-white border border-indigo-200 rounded-lg text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">홈페이지 URL *</label>
                <input
                  type="url"
                  value={newChurch.homepageUrl}
                  onChange={e => setNewChurch(prev => ({ ...prev, homepageUrl: e.target.value }))}
                  placeholder="https://www.example.org/"
                  className="w-full px-4 py-2 bg-white border border-indigo-200 rounded-lg text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-gray-600 mb-1">교단</label>
                <input
                  type="text"
                  value={newChurch.denomination}
                  onChange={e => setNewChurch(prev => ({ ...prev, denomination: e.target.value }))}
                  placeholder="예: 대한예수교장로회(통합)"
                  className="w-full px-4 py-2 bg-white border border-indigo-200 rounded-lg text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium text-sm"
              >
                취소
              </button>
              <button
                onClick={addChurch}
                disabled={!newChurch.name || !newChurch.code || !newChurch.homepageUrl}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  )
}
