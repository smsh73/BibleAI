'use client'

import { useState, useEffect, useCallback } from 'react'

interface Church {
  id: number
  name: string
  code: string
  homepageUrl: string
  lastCrawled?: string
}

interface PageInfo {
  id?: number
  url: string
  title: string
  pageType: string
  depth: number
  contentType?: string
  children?: PageInfo[]
}

interface SiteStructure {
  church: { name: string; code: string; url: string }
  navigation: PageInfo[]
  boards: PageInfo[]
  metadata: {
    totalPages: number
    maxDepth: number
    hasLogin: boolean
    hasMobileVersion: boolean
    technologies: string[]
  }
}

interface DictionaryEntry {
  term: string
  category: string
  subcategory?: string
  definition?: string
  aliases?: string[]
  sourceUrl?: string
}

interface TaxonomyNode {
  id: number
  name: string
  taxonomy_type: string
  depth: number
  path: string
}

export default function ChurchDictionaryPage() {
  const [churches, setChurches] = useState<Church[]>([])
  const [selectedChurch, setSelectedChurch] = useState<Church | null>(null)
  const [structure, setStructure] = useState<SiteStructure | null>(null)
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([])
  const [taxonomy, setTaxonomy] = useState<TaxonomyNode[]>([])
  const [loading, setLoading] = useState(false)
  const [crawling, setCrawling] = useState(false)
  const [activeTab, setActiveTab] = useState<'structure' | 'dictionary' | 'taxonomy'>('structure')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  // 교회 목록 로드
  useEffect(() => {
    loadChurches()
  }, [])

  const loadChurches = async () => {
    try {
      const res = await fetch('/api/admin/church-crawler?action=list')
      const data = await res.json()
      if (data.success) {
        setChurches(data.churches)
      }
    } catch (error) {
      console.error('교회 목록 로드 실패:', error)
    }
  }

  // 교회 선택 시 데이터 로드
  const selectChurch = useCallback(async (church: Church) => {
    setSelectedChurch(church)
    setLoading(true)

    try {
      // 구조 로드
      const structureRes = await fetch(`/api/admin/church-crawler?action=structure&churchCode=${church.code}`)
      const structureData = await structureRes.json()
      if (structureData.success) {
        setStructure(structureData.structure)
      }

      // 사전 로드
      const dictRes = await fetch(`/api/admin/church-crawler?action=dictionary&churchCode=${church.code}`)
      const dictData = await dictRes.json()
      if (dictData.success) {
        setDictionary(dictData.dictionary)
      }

      // 분류 체계 로드
      const taxRes = await fetch(`/api/admin/church-crawler?action=taxonomy&churchCode=${church.code}`)
      const taxData = await taxRes.json()
      if (taxData.success) {
        setTaxonomy(taxData.taxonomy)
      }
    } catch (error) {
      console.error('데이터 로드 실패:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // 크롤링 실행
  const runCrawl = async () => {
    if (!selectedChurch) return

    setCrawling(true)
    try {
      const res = await fetch('/api/admin/church-crawler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'crawl',
          churchCode: selectedChurch.code,
          options: {
            maxDepth: 3,
            maxPages: 100,
            extractPeople: true,
            extractBoards: true
          }
        })
      })

      const data = await res.json()
      if (data.success) {
        alert(`크롤링 완료!\n- 페이지: ${data.result.totalPages}개\n- 메뉴: ${data.result.navigationCount}개\n- 게시판: ${data.result.boardsCount}개\n- 사전: ${data.result.dictionaryCount}개\n- 소요시간: ${(data.result.crawlTime / 1000).toFixed(1)}초`)
        // 데이터 새로고침
        await selectChurch(selectedChurch)
        await loadChurches()
      } else {
        alert('크롤링 실패: ' + (data.errors?.join(', ') || '알 수 없는 오류'))
      }
    } catch (error) {
      console.error('크롤링 실패:', error)
      alert('크롤링 실패')
    } finally {
      setCrawling(false)
    }
  }

  // 노드 토글
  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId)
    } else {
      newExpanded.add(nodeId)
    }
    setExpandedNodes(newExpanded)
  }

  // 네비게이션 트리 렌더링
  const renderNavigationTree = (items: PageInfo[], level: number = 0) => {
    return (
      <ul className={`${level > 0 ? 'ml-6 border-l border-gray-200 pl-4' : ''}`}>
        {items.map((item, idx) => {
          const nodeId = `nav-${level}-${idx}`
          const hasChildren = item.children && item.children.length > 0
          const isExpanded = expandedNodes.has(nodeId)

          return (
            <li key={nodeId} className="py-1">
              <div className="flex items-center gap-2">
                {hasChildren ? (
                  <button
                    onClick={() => toggleNode(nodeId)}
                    className="w-5 h-5 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded"
                  >
                    {isExpanded ? '▼' : '▶'}
                  </button>
                ) : (
                  <span className="w-5 h-5 flex items-center justify-center text-gray-300">•</span>
                )}

                <span className={`
                  px-2 py-0.5 rounded text-xs font-medium
                  ${item.pageType === 'menu' ? 'bg-blue-100 text-blue-700' :
                    item.pageType === 'submenu' ? 'bg-green-100 text-green-700' :
                    item.pageType === 'board' ? 'bg-purple-100 text-purple-700' :
                    'bg-gray-100 text-gray-600'}
                `}>
                  {item.pageType}
                </span>

                <span className="font-medium text-gray-800">{item.title}</span>

                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline truncate max-w-xs"
                  >
                    {item.url.replace(/^https?:\/\/[^/]+/, '')}
                  </a>
                )}
              </div>

              {hasChildren && isExpanded && renderNavigationTree(item.children!, level + 1)}
            </li>
          )
        })}
      </ul>
    )
  }

  // 카테고리 목록 추출
  const categories = Array.from(new Set(dictionary.map(d => d.category)))

  // 필터링된 사전 항목
  const filteredDictionary = selectedCategory
    ? dictionary.filter(d => d.category === selectedCategory)
    : dictionary

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">교회 홈페이지 분석</h1>
            <p className="text-sm text-gray-500 mt-1">Dictionary / Taxonomy / Metadata 관리</p>
          </div>
          <a href="/admin" className="text-blue-600 hover:text-blue-800">
            ← 관리자 홈으로
          </a>
        </div>
      </header>

      <div className="flex h-[calc(100vh-73px)]">
        {/* 사이드바: 교회 목록 */}
        <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-700">교회 목록</h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {churches.map(church => (
              <li key={church.id}>
                <button
                  onClick={() => selectChurch(church)}
                  className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                    selectedChurch?.id === church.id ? 'bg-blue-50 border-r-2 border-blue-500' : ''
                  }`}
                >
                  <div className="font-medium text-gray-900">{church.name}</div>
                  <div className="text-xs text-gray-500 truncate">{church.homepageUrl}</div>
                  {church.lastCrawled && (
                    <div className="text-xs text-green-600 mt-1">
                      마지막 크롤링: {new Date(church.lastCrawled).toLocaleDateString('ko-KR')}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* 메인 콘텐츠 */}
        <main className="flex-1 overflow-y-auto">
          {!selectedChurch ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              왼쪽에서 교회를 선택하세요
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-gray-500">데이터 로드 중...</p>
              </div>
            </div>
          ) : (
            <div className="p-6">
              {/* 교회 정보 헤더 */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{selectedChurch.name}</h2>
                    <a
                      href={selectedChurch.homepageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-sm"
                    >
                      {selectedChurch.homepageUrl}
                    </a>

                    {structure && (
                      <div className="flex gap-4 mt-4 text-sm">
                        <div className="bg-blue-50 px-3 py-1 rounded">
                          <span className="text-blue-600 font-medium">{structure.metadata.totalPages}</span>
                          <span className="text-blue-500 ml-1">페이지</span>
                        </div>
                        <div className="bg-green-50 px-3 py-1 rounded">
                          <span className="text-green-600 font-medium">{structure.navigation.length}</span>
                          <span className="text-green-500 ml-1">메뉴</span>
                        </div>
                        <div className="bg-purple-50 px-3 py-1 rounded">
                          <span className="text-purple-600 font-medium">{structure.boards.length}</span>
                          <span className="text-purple-500 ml-1">게시판</span>
                        </div>
                        <div className="bg-amber-50 px-3 py-1 rounded">
                          <span className="text-amber-600 font-medium">{dictionary.length}</span>
                          <span className="text-amber-500 ml-1">사전 항목</span>
                        </div>
                      </div>
                    )}

                    {structure?.metadata.technologies.length > 0 && (
                      <div className="flex gap-2 mt-3">
                        {structure.metadata.technologies.map(tech => (
                          <span key={tech} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                            {tech}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={runCrawl}
                    disabled={crawling}
                    className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${
                      crawling
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {crawling ? (
                      <>
                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                        크롤링 중...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        AI 크롤링 실행
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* 탭 */}
              <div className="flex border-b border-gray-200 mb-6">
                <button
                  onClick={() => setActiveTab('structure')}
                  className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                    activeTab === 'structure'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  사이트 구조
                </button>
                <button
                  onClick={() => setActiveTab('dictionary')}
                  className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                    activeTab === 'dictionary'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  사전 ({dictionary.length})
                </button>
                <button
                  onClick={() => setActiveTab('taxonomy')}
                  className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                    activeTab === 'taxonomy'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  분류 체계 ({taxonomy.length})
                </button>
              </div>

              {/* 탭 콘텐츠 */}
              {activeTab === 'structure' && structure && (
                <div className="space-y-6">
                  {/* 네비게이션 구조 */}
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                      네비게이션 메뉴
                    </h3>
                    {structure.navigation.length > 0 ? (
                      renderNavigationTree(structure.navigation)
                    ) : (
                      <p className="text-gray-500 text-sm">크롤링을 실행하여 메뉴 구조를 분석하세요.</p>
                    )}
                  </div>

                  {/* 게시판 목록 */}
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      게시판
                    </h3>
                    {structure.boards.length > 0 ? (
                      <div className="grid grid-cols-2 gap-4">
                        {structure.boards.map((board, idx) => (
                          <a
                            key={idx}
                            href={board.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs">게시판</span>
                            <span className="font-medium text-gray-800">{board.title}</span>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm">감지된 게시판이 없습니다.</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'dictionary' && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                  {/* 필터 */}
                  <div className="p-4 border-b border-gray-200 flex items-center gap-4">
                    <span className="text-sm text-gray-600">카테고리:</span>
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="border border-gray-300 rounded px-3 py-1 text-sm"
                    >
                      <option value="">전체</option>
                      {categories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                    <span className="text-sm text-gray-500">
                      {filteredDictionary.length}개 항목
                    </span>
                  </div>

                  {/* 사전 목록 */}
                  <div className="divide-y divide-gray-100">
                    {filteredDictionary.length > 0 ? (
                      filteredDictionary.map((entry, idx) => (
                        <div key={idx} className="p-4 hover:bg-gray-50">
                          <div className="flex items-start gap-3">
                            <span className={`
                              px-2 py-1 rounded text-xs font-medium shrink-0
                              ${entry.category === '인물' ? 'bg-blue-100 text-blue-700' :
                                entry.category === '장소' ? 'bg-green-100 text-green-700' :
                                entry.category === '부서' ? 'bg-purple-100 text-purple-700' :
                                entry.category === '행사' ? 'bg-amber-100 text-amber-700' :
                                'bg-gray-100 text-gray-600'}
                            `}>
                              {entry.category}
                              {entry.subcategory && ` / ${entry.subcategory}`}
                            </span>
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">{entry.term}</div>
                              {entry.definition && (
                                <div className="text-sm text-gray-600 mt-1">{entry.definition}</div>
                              )}
                              {entry.aliases && entry.aliases.length > 0 && (
                                <div className="flex gap-1 mt-2">
                                  {entry.aliases.map((alias, i) => (
                                    <span key={i} className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                                      {alias}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-8 text-center text-gray-500">
                        <p>사전 항목이 없습니다.</p>
                        <p className="text-sm mt-1">크롤링을 실행하여 데이터를 수집하세요.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'taxonomy' && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <h3 className="font-semibold text-gray-900 mb-4">조직/사역 분류 체계</h3>
                  {taxonomy.length > 0 ? (
                    <div className="space-y-2">
                      {taxonomy.map(node => (
                        <div
                          key={node.id}
                          style={{ marginLeft: `${node.depth * 24}px` }}
                          className="flex items-center gap-2"
                        >
                          <span className={`
                            px-2 py-1 rounded text-xs font-medium
                            ${node.taxonomy_type === 'organization' ? 'bg-blue-100 text-blue-700' :
                              node.taxonomy_type === 'ministry' ? 'bg-green-100 text-green-700' :
                              node.taxonomy_type === 'location' ? 'bg-amber-100 text-amber-700' :
                              'bg-gray-100 text-gray-600'}
                          `}>
                            {node.taxonomy_type}
                          </span>
                          <span className="font-medium text-gray-800">{node.name}</span>
                          <span className="text-xs text-gray-400">{node.path}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">분류 체계 데이터가 없습니다.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
