'use client'

/**
 * 성경 구절 연결 탐색 페이지
 * 카드 기반의 직관적인 연쇄 뷰로 구절 간의 관계를 탐색
 */

import { useState, useEffect } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'

interface VerseNode {
  reference: string
  content?: string
  themes?: string[]
  depth: number
  isCenter?: boolean
}

interface VerseEdge {
  source: string
  target: string
  relationType: string
  strength: number
  description?: string
}

interface VerseGraph {
  nodes: VerseNode[]
  edges: VerseEdge[]
  centerReference: string
}

// 관계 유형별 스타일 (모던 디자인)
const RELATION_STYLES: Record<string, { label: string; color: string; bgColor: string; borderColor: string; dotColor: string }> = {
  prophecy_fulfillment: { label: '예언/성취', color: 'text-rose-700', bgColor: 'bg-rose-50', borderColor: 'border-rose-200', dotColor: 'bg-rose-500' },
  parallel: { label: '평행본문', color: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-200', dotColor: 'bg-blue-500' },
  quotation: { label: '인용', color: 'text-violet-700', bgColor: 'bg-violet-50', borderColor: 'border-violet-200', dotColor: 'bg-violet-500' },
  thematic: { label: '주제 연결', color: 'text-emerald-700', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200', dotColor: 'bg-emerald-500' },
  narrative: { label: '서사 연결', color: 'text-amber-700', bgColor: 'bg-amber-50', borderColor: 'border-amber-200', dotColor: 'bg-amber-500' },
  theological: { label: '신학적', color: 'text-pink-700', bgColor: 'bg-pink-50', borderColor: 'border-pink-200', dotColor: 'bg-pink-500' },
  semantic: { label: '의미 유사', color: 'text-slate-600', bgColor: 'bg-slate-50', borderColor: 'border-slate-200', dotColor: 'bg-slate-400' }
}

// 관계 유형 설명
const RELATION_DESCRIPTIONS: Record<string, string> = {
  prophecy_fulfillment: '구약의 예언이 신약에서 이루어진 관계',
  parallel: '같은 사건이나 말씀이 다른 책에도 기록된 경우',
  quotation: '한 구절이 다른 구절을 직접 인용한 경우',
  thematic: '같은 주제나 가르침을 다루는 구절들',
  narrative: '이야기의 흐름상 연결된 구절들',
  theological: '같은 신학적 개념을 설명하는 구절들',
  semantic: 'AI가 분석한 의미적으로 유사한 구절들'
}

// 성경 66권 데이터 (책이름, 장수, 각 장별 절수)
interface BibleBook {
  name: string
  shortName: string
  chapters: number[]  // 각 장의 절 수
  testament: 'old' | 'new'
  category: 'law' | 'history' | 'poetry' | 'major_prophet' | 'minor_prophet' | 'gospel' | 'acts' | 'pauline' | 'general' | 'revelation'
}

const BIBLE_BOOKS: BibleBook[] = [
  // 구약 - 율법서 (모세오경)
  { name: '창세기', shortName: '창', chapters: [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26], testament: 'old', category: 'law' },
  { name: '출애굽기', shortName: '출', chapters: [22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38], testament: 'old', category: 'law' },
  { name: '레위기', shortName: '레', chapters: [17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34], testament: 'old', category: 'law' },
  { name: '민수기', shortName: '민', chapters: [54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13], testament: 'old', category: 'law' },
  { name: '신명기', shortName: '신', chapters: [46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12], testament: 'old', category: 'law' },
  // 구약 - 역사서
  { name: '여호수아', shortName: '수', chapters: [18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33], testament: 'old', category: 'history' },
  { name: '사사기', shortName: '삿', chapters: [36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25], testament: 'old', category: 'history' },
  { name: '룻기', shortName: '룻', chapters: [22,23,18,22], testament: 'old', category: 'history' },
  { name: '사무엘상', shortName: '삼상', chapters: [28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13], testament: 'old', category: 'history' },
  { name: '사무엘하', shortName: '삼하', chapters: [27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25], testament: 'old', category: 'history' },
  { name: '열왕기상', shortName: '왕상', chapters: [53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53], testament: 'old', category: 'history' },
  { name: '열왕기하', shortName: '왕하', chapters: [18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30], testament: 'old', category: 'history' },
  { name: '역대상', shortName: '대상', chapters: [54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30], testament: 'old', category: 'history' },
  { name: '역대하', shortName: '대하', chapters: [17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23], testament: 'old', category: 'history' },
  { name: '에스라', shortName: '스', chapters: [11,70,13,24,17,22,28,36,15,44], testament: 'old', category: 'history' },
  { name: '느헤미야', shortName: '느', chapters: [11,20,32,23,19,19,73,18,38,39,36,47,31], testament: 'old', category: 'history' },
  { name: '에스더', shortName: '에', chapters: [22,23,15,17,14,14,10,17,32,3], testament: 'old', category: 'history' },
  // 구약 - 시가서
  { name: '욥기', shortName: '욥', chapters: [22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17], testament: 'old', category: 'poetry' },
  { name: '시편', shortName: '시', chapters: [6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6], testament: 'old', category: 'poetry' },
  { name: '잠언', shortName: '잠', chapters: [33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31], testament: 'old', category: 'poetry' },
  { name: '전도서', shortName: '전', chapters: [18,26,22,16,20,12,29,17,18,20,10,14], testament: 'old', category: 'poetry' },
  { name: '아가', shortName: '아', chapters: [17,17,11,16,16,13,13,14], testament: 'old', category: 'poetry' },
  // 구약 - 대선지서
  { name: '이사야', shortName: '사', chapters: [31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24], testament: 'old', category: 'major_prophet' },
  { name: '예레미야', shortName: '렘', chapters: [19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34], testament: 'old', category: 'major_prophet' },
  { name: '예레미야애가', shortName: '애', chapters: [22,22,66,22,22], testament: 'old', category: 'major_prophet' },
  { name: '에스겔', shortName: '겔', chapters: [28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35], testament: 'old', category: 'major_prophet' },
  { name: '다니엘', shortName: '단', chapters: [21,49,30,37,31,28,28,27,27,21,45,13], testament: 'old', category: 'major_prophet' },
  // 구약 - 소선지서
  { name: '호세아', shortName: '호', chapters: [11,23,5,19,15,11,16,14,17,15,12,14,16,9], testament: 'old', category: 'minor_prophet' },
  { name: '요엘', shortName: '욜', chapters: [20,32,21], testament: 'old', category: 'minor_prophet' },
  { name: '아모스', shortName: '암', chapters: [15,16,15,13,27,14,17,14,15], testament: 'old', category: 'minor_prophet' },
  { name: '오바댜', shortName: '옵', chapters: [21], testament: 'old', category: 'minor_prophet' },
  { name: '요나', shortName: '욘', chapters: [17,10,10,11], testament: 'old', category: 'minor_prophet' },
  { name: '미가', shortName: '미', chapters: [16,13,12,13,15,16,20], testament: 'old', category: 'minor_prophet' },
  { name: '나훔', shortName: '나', chapters: [15,13,19], testament: 'old', category: 'minor_prophet' },
  { name: '하박국', shortName: '합', chapters: [17,20,19], testament: 'old', category: 'minor_prophet' },
  { name: '스바냐', shortName: '습', chapters: [18,15,20], testament: 'old', category: 'minor_prophet' },
  { name: '학개', shortName: '학', chapters: [15,23], testament: 'old', category: 'minor_prophet' },
  { name: '스가랴', shortName: '슥', chapters: [21,13,10,14,11,15,14,23,17,12,17,14,9,21], testament: 'old', category: 'minor_prophet' },
  { name: '말라기', shortName: '말', chapters: [14,17,18,6], testament: 'old', category: 'minor_prophet' },
  // 신약 - 복음서
  { name: '마태복음', shortName: '마', chapters: [25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20], testament: 'new', category: 'gospel' },
  { name: '마가복음', shortName: '막', chapters: [45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20], testament: 'new', category: 'gospel' },
  { name: '누가복음', shortName: '눅', chapters: [80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53], testament: 'new', category: 'gospel' },
  { name: '요한복음', shortName: '요', chapters: [51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25], testament: 'new', category: 'gospel' },
  // 신약 - 역사서
  { name: '사도행전', shortName: '행', chapters: [26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31], testament: 'new', category: 'acts' },
  // 신약 - 바울서신
  { name: '로마서', shortName: '롬', chapters: [32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27], testament: 'new', category: 'pauline' },
  { name: '고린도전서', shortName: '고전', chapters: [31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24], testament: 'new', category: 'pauline' },
  { name: '고린도후서', shortName: '고후', chapters: [24,17,18,18,21,18,16,24,15,18,33,21,14], testament: 'new', category: 'pauline' },
  { name: '갈라디아서', shortName: '갈', chapters: [24,21,29,31,26,18], testament: 'new', category: 'pauline' },
  { name: '에베소서', shortName: '엡', chapters: [23,22,21,32,33,24], testament: 'new', category: 'pauline' },
  { name: '빌립보서', shortName: '빌', chapters: [30,30,21,23], testament: 'new', category: 'pauline' },
  { name: '골로새서', shortName: '골', chapters: [29,23,25,18], testament: 'new', category: 'pauline' },
  { name: '데살로니가전서', shortName: '살전', chapters: [10,20,13,18,28], testament: 'new', category: 'pauline' },
  { name: '데살로니가후서', shortName: '살후', chapters: [12,17,18], testament: 'new', category: 'pauline' },
  { name: '디모데전서', shortName: '딤전', chapters: [20,15,16,16,25,21], testament: 'new', category: 'pauline' },
  { name: '디모데후서', shortName: '딤후', chapters: [18,26,17,22], testament: 'new', category: 'pauline' },
  { name: '디도서', shortName: '딛', chapters: [16,15,15], testament: 'new', category: 'pauline' },
  { name: '빌레몬서', shortName: '몬', chapters: [25], testament: 'new', category: 'pauline' },
  // 신약 - 일반서신
  { name: '히브리서', shortName: '히', chapters: [14,18,19,16,14,20,28,13,28,39,40,29,25], testament: 'new', category: 'general' },
  { name: '야고보서', shortName: '약', chapters: [27,26,18,17,20], testament: 'new', category: 'general' },
  { name: '베드로전서', shortName: '벧전', chapters: [25,25,22,19,14], testament: 'new', category: 'general' },
  { name: '베드로후서', shortName: '벧후', chapters: [21,22,18], testament: 'new', category: 'general' },
  { name: '요한일서', shortName: '요일', chapters: [10,29,24,21,21], testament: 'new', category: 'general' },
  { name: '요한이서', shortName: '요이', chapters: [13], testament: 'new', category: 'general' },
  { name: '요한삼서', shortName: '요삼', chapters: [14], testament: 'new', category: 'general' },
  { name: '유다서', shortName: '유', chapters: [25], testament: 'new', category: 'general' },
  // 신약 - 예언서
  { name: '요한계시록', shortName: '계', chapters: [20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21], testament: 'new', category: 'revelation' }
]

// 카테고리별 색상
const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string; hover: string }> = {
  law: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', hover: 'hover:bg-blue-100' },
  history: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', hover: 'hover:bg-emerald-100' },
  poetry: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', hover: 'hover:bg-purple-100' },
  major_prophet: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', hover: 'hover:bg-rose-100' },
  minor_prophet: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', hover: 'hover:bg-orange-100' },
  gospel: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', hover: 'hover:bg-amber-100' },
  acts: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', hover: 'hover:bg-teal-100' },
  pauline: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', hover: 'hover:bg-indigo-100' },
  general: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', hover: 'hover:bg-cyan-100' },
  revelation: { bg: 'bg-fuchsia-50', text: 'text-fuchsia-700', border: 'border-fuchsia-200', hover: 'hover:bg-fuchsia-100' }
}

export default function VerseMapPage() {
  const { language, t } = useLanguage()

  const [inputValue, setInputValue] = useState('')
  const [graph, setGraph] = useState<VerseGraph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<string[]>([])
  const [depth] = useState(2)

  // 성경 지도 드릴다운 상태
  const [selectedBook, setSelectedBook] = useState<BibleBook | null>(null)
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null)
  const [showBibleMap, setShowBibleMap] = useState(true)

  // URL 파라미터에서 reference 읽기
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('reference')
    if (ref) {
      setInputValue(ref)
      loadGraph(ref)
    }
  }, [])

  // 그래프 데이터 로드 (개역개정 버전만)
  async function loadGraph(reference: string) {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(
        `/api/verse-graph?reference=${encodeURIComponent(reference)}&depth=${depth}&version=GAE`
      )
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || '데이터를 불러올 수 없습니다')
      }

      setGraph(data.graph)
      setExpandedNodes(new Set([reference])) // 중심 노드는 기본 확장

    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류')
    } finally {
      setLoading(false)
    }
  }

  // 검색 제출
  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (inputValue.trim()) {
      const ref = inputValue.trim()
      setHistory([])
      loadGraph(ref)
      window.history.pushState({}, '', `/verse-map?reference=${encodeURIComponent(ref)}`)
    }
  }

  // 구절 클릭 - 해당 구절 중심으로 탐색
  function handleVerseClick(reference: string) {
    if (graph?.centerReference) {
      setHistory(prev => [...prev, graph.centerReference])
    }
    setInputValue(reference)
    loadGraph(reference)
    window.history.pushState({}, '', `/verse-map?reference=${encodeURIComponent(reference)}`)
  }

  // 뒤로 가기
  function handleBack() {
    if (history.length > 0) {
      const prevRef = history[history.length - 1]
      setHistory(prev => prev.slice(0, -1))
      setInputValue(prevRef)
      loadGraph(prevRef)
      window.history.pushState({}, '', `/verse-map?reference=${encodeURIComponent(prevRef)}`)
    }
  }

  // 책 선택
  function handleBookClick(book: BibleBook) {
    if (selectedBook?.name === book.name) {
      setSelectedBook(null)
      setSelectedChapter(null)
    } else {
      setSelectedBook(book)
      setSelectedChapter(null)
    }
  }

  // 장 선택
  function handleChapterClick(chapter: number) {
    if (selectedChapter === chapter) {
      setSelectedChapter(null)
    } else {
      setSelectedChapter(chapter)
    }
  }

  // 절 선택 → 그래프 로드
  function handleVerseSelect(book: BibleBook, chapter: number, verse: number) {
    const reference = `${book.name} ${chapter}:${verse}`
    setInputValue(reference)
    setHistory([])
    setShowBibleMap(false)
    loadGraph(reference)
    window.history.pushState({}, '', `/verse-map?reference=${encodeURIComponent(reference)}`)
  }

  // 지도로 돌아가기
  function handleBackToMap() {
    setShowBibleMap(true)
    setGraph(null)
    setSelectedBook(null)
    setSelectedChapter(null)
    window.history.pushState({}, '', '/verse-map')
  }

  // 노드 확장/축소 토글
  function toggleExpand(reference: string) {
    setExpandedNodes(prev => {
      const newSet = new Set(prev)
      if (newSet.has(reference)) {
        newSet.delete(reference)
      } else {
        newSet.add(reference)
      }
      return newSet
    })
  }

  // 특정 구절의 연결된 구절들 가져오기
  function getConnectedVerses(reference: string): { verse: VerseNode; edge: VerseEdge }[] {
    if (!graph) return []

    const connected: { verse: VerseNode; edge: VerseEdge }[] = []

    for (const edge of graph.edges) {
      let targetRef: string | null = null

      if (edge.source === reference) {
        targetRef = edge.target
      } else if (edge.target === reference) {
        targetRef = edge.source
      }

      if (targetRef) {
        const targetNode = graph.nodes.find(n => n.reference === targetRef)
        if (targetNode && targetRef !== reference) {
          connected.push({ verse: targetNode, edge })
        }
      }
    }

    // 관계 강도순 정렬
    return connected.sort((a, b) => b.edge.strength - a.edge.strength)
  }

  // 중심 구절 노드 가져오기
  const centerNode = graph?.nodes.find(n => n.isCenter)

  return (
    <div className="relative flex flex-col min-h-screen overflow-hidden">
      {/* 배경 */}
      <div className="absolute inset-0 bg-white" />
      <div className="absolute inset-0 bg-gradient-to-br from-amber-50 via-white to-orange-50" />

      {/* 헤더 */}
      <header className="relative z-10 flex-shrink-0 px-4 py-2 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <h1 className="text-lg font-semibold text-amber-900">{t('verseMap.title')}</h1>
            </div>
            <nav className="flex items-center gap-3 text-sm text-gray-600 font-medium">
              <a href="/" className="hover:text-gray-900 hover:underline">{t('common.home')}</a>
              <span className="text-gray-300">|</span>
              <a href="/verse-map" className="hover:text-gray-900 hover:underline">{t('common.verseMap')}</a>
              <span className="text-gray-300">|</span>
              <a href="/youtube" className="hover:text-gray-900 hover:underline">{t('common.sermon')}</a>
              <span className="text-gray-300">|</span>
              <a href="/news" className="hover:text-gray-900 hover:underline">{t('common.news')}</a>
              <span className="text-gray-300">|</span>
              <a href="/bulletin" className="hover:text-gray-900 hover:underline">{t('common.bulletin')}</a>
              <span className="text-gray-300">|</span>
              <a href="/admin" className="hover:text-gray-900 hover:underline">{t('common.admin')}</a>
            </nav>
          </div>
        </div>
      </header>

      {/* 검색 바 */}
      <div className="relative z-10 bg-white/80 backdrop-blur-sm border-b border-amber-100 sticky top-0">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            {history.length > 0 && (
              <button
                onClick={handleBack}
                className="text-amber-600 hover:text-amber-700 text-sm flex items-center gap-1"
              >
                ← {t('verseMap.back')}
              </button>
            )}

            {/* 검색 폼 */}
            <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 max-w-md">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={t('verseMap.searchPlaceholder')}
                className="flex-1 px-4 py-2 border border-amber-200 rounded-full focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 text-sm text-gray-900 bg-white"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-full text-sm whitespace-nowrap shadow-sm transition-colors"
              >
                {t('verseMap.explore')}
              </button>
            </form>
          </div>
        </div>
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-4 py-6 pb-20">
        {/* 로딩 */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="animate-spin w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full mx-auto" />
              <p className="mt-4 text-amber-700">{t('verseMap.loading')}</p>
            </div>
          </div>
        )}

        {/* 에러 */}
        {error && (
          <div className="text-center py-20">
            <div className="bg-red-50 text-red-600 p-6 rounded-xl inline-block border border-red-200">
              <p className="font-medium">오류가 발생했습니다</p>
              <p className="text-sm mt-2">{error}</p>
            </div>
          </div>
        )}

        {/* 성경 지도 (초기 화면) */}
        {showBibleMap && !graph && !loading && !error && (
          <div className="space-y-6">
            {/* 헤더 */}
            <div className="text-center">
              <h2 className="text-xl font-bold text-amber-800 mb-2">
                {t('verseMap.welcomeTitle')}
              </h2>
              <p className="text-amber-600 text-sm">
                {language === 'en' ? 'Select a book, chapter, and verse to explore connections' : '책을 선택하고 장과 절을 클릭하세요'}
              </p>
            </div>

            {/* 구약/신약 구분 */}
            {['old', 'new'].map((testament) => (
              <div key={testament} className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200 pb-1">
                  {testament === 'old' ? (language === 'en' ? 'Old Testament' : '구약') : (language === 'en' ? 'New Testament' : '신약')}
                </h3>

                {/* 책 그리드 */}
                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-13 gap-1">
                  {BIBLE_BOOKS.filter(b => b.testament === testament).map((book) => {
                    const colors = CATEGORY_COLORS[book.category]
                    const isSelected = selectedBook?.name === book.name

                    return (
                      <button
                        key={book.name}
                        onClick={() => handleBookClick(book)}
                        className={`
                          px-1.5 py-2 rounded-lg text-xs font-medium transition-all
                          border ${colors.border} ${colors.text}
                          ${isSelected ? `${colors.bg} ring-2 ring-offset-1 ring-amber-400 shadow-md` : `bg-white ${colors.hover}`}
                        `}
                        title={book.name}
                      >
                        {book.shortName}
                      </button>
                    )
                  })}
                </div>

                {/* 선택된 책의 장/절 표시 */}
                {selectedBook && selectedBook.testament === testament && (
                  <div className="bg-white rounded-xl border border-amber-200 p-4 shadow-sm animate-fade-in w-full">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-amber-800">
                        {selectedBook.name}
                        <span className="text-sm text-gray-500 ml-2">
                          ({selectedBook.chapters.length}{language === 'en' ? ' chapters' : '장'})
                        </span>
                      </h4>
                      <button
                        onClick={() => { setSelectedBook(null); setSelectedChapter(null) }}
                        className="text-gray-400 hover:text-gray-600 text-sm"
                      >
                        ✕
                      </button>
                    </div>

                    {/* 장 그리드 - 고정 너비 그리드 (10열 고정) */}
                    <div className="grid grid-cols-10 gap-1 mb-3">
                      {selectedBook.chapters.map((verseCount, idx) => {
                        const chapter = idx + 1
                        const isChapterSelected = selectedChapter === chapter
                        const colors = CATEGORY_COLORS[selectedBook.category]

                        return (
                          <button
                            key={chapter}
                            onClick={() => handleChapterClick(chapter)}
                            className={`
                              w-full aspect-square rounded-md text-xs font-medium transition-all
                              ${isChapterSelected
                                ? `${colors.bg} ${colors.text} ring-2 ring-amber-400`
                                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                              }
                            `}
                          >
                            {chapter}
                          </button>
                        )
                      })}
                    </div>

                    {/* 절 그리드 - 고정 너비 그리드 (10열 고정) */}
                    {selectedChapter && (
                      <div className="border-t border-gray-100 pt-3 animate-fade-in">
                        <p className="text-xs text-gray-500 mb-2">
                          {selectedBook.name} {selectedChapter}{language === 'en' ? ':' : '장'} - {language === 'en' ? 'Select verse' : '절 선택'}
                        </p>
                        <div className="grid grid-cols-10 gap-1 max-h-48 overflow-y-auto">
                          {Array.from({ length: selectedBook.chapters[selectedChapter - 1] }, (_, i) => i + 1).map((verse) => {
                            const colors = CATEGORY_COLORS[selectedBook.category]

                            return (
                              <button
                                key={verse}
                                onClick={() => handleVerseSelect(selectedBook, selectedChapter, verse)}
                                className={`
                                  w-full aspect-square rounded text-xs font-medium transition-all
                                  bg-white border border-gray-200 text-gray-600
                                  hover:${colors.bg} hover:${colors.text} hover:border-amber-300
                                `}
                              >
                                {verse}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* 범례 */}
            <div className="mt-6 pt-4 border-t border-gray-200">
              <p className="text-xs text-gray-500 text-center mb-3">{language === 'en' ? 'Book Categories' : '책 분류'}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {[
                  { key: 'law', label: language === 'en' ? 'Law' : '율법서' },
                  { key: 'history', label: language === 'en' ? 'History' : '역사서' },
                  { key: 'poetry', label: language === 'en' ? 'Poetry' : '시가서' },
                  { key: 'major_prophet', label: language === 'en' ? 'Major Prophets' : '대선지서' },
                  { key: 'minor_prophet', label: language === 'en' ? 'Minor Prophets' : '소선지서' },
                  { key: 'gospel', label: language === 'en' ? 'Gospels' : '복음서' },
                  { key: 'acts', label: language === 'en' ? 'Acts' : '사도행전' },
                  { key: 'pauline', label: language === 'en' ? 'Pauline' : '바울서신' },
                  { key: 'general', label: language === 'en' ? 'General' : '일반서신' },
                  { key: 'revelation', label: language === 'en' ? 'Revelation' : '요한계시록' }
                ].map(({ key, label }) => {
                  const colors = CATEGORY_COLORS[key]
                  return (
                    <span
                      key={key}
                      className={`px-2 py-1 rounded text-xs ${colors.bg} ${colors.text} border ${colors.border}`}
                    >
                      {label}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* 메인 콘텐츠 - 카드 기반 연쇄 뷰 */}
        {graph && centerNode && !loading && (
          <div className="space-y-4">
            {/* 지도로 돌아가기 버튼 */}
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={handleBackToMap}
                className="flex items-center gap-1 text-sm text-amber-600 hover:text-amber-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                {language === 'en' ? 'Back to Bible Map' : '성경 지도로'}
              </button>
            </div>

            {/* 타이틀 */}
            <div className="text-center mb-6">
              <h2 className="text-lg font-semibold text-amber-800">
                {language === 'en'
                  ? `Connections from "${centerNode.reference}"`
                  : `"${centerNode.reference}" 에서 시작하는 말씀의 연결`}
              </h2>
              <p className="text-sm text-amber-600 mt-1">
                {language === 'en'
                  ? 'Click a card to explore more connections'
                  : '카드를 클릭하면 해당 구절의 연결을 더 탐색할 수 있습니다'}
              </p>
            </div>

            {/* 중심 구절 카드 */}
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-1 shadow-lg">
              <div className="bg-white rounded-xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-xl font-bold text-amber-800">
                    {centerNode.reference}
                  </h3>
                  <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs rounded-full">
                    중심 구절
                  </span>
                </div>
                {centerNode.content && (
                  <p className="text-gray-700 leading-relaxed text-lg">
                    "{centerNode.content}"
                  </p>
                )}
                {centerNode.themes && centerNode.themes.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {centerNode.themes.slice(0, 5).map(theme => (
                      <span key={theme} className="px-2 py-0.5 bg-amber-50 text-amber-600 text-xs rounded">
                        #{theme}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 연결된 구절들 */}
            {(() => {
              const connected = getConnectedVerses(centerNode.reference)
              if (connected.length === 0) {
                return (
                  <div className="text-center py-8 text-amber-600">
                    <p>이 구절과 직접 연결된 구절이 없습니다.</p>
                    <p className="text-sm mt-1">다른 구절을 검색해 보세요.</p>
                  </div>
                )
              }

              // 관계 유형별로 그룹핑
              const groupedByType: Record<string, { verse: VerseNode; edge: VerseEdge }[]> = {}
              for (const item of connected) {
                const type = item.edge.relationType
                if (!groupedByType[type]) {
                  groupedByType[type] = []
                }
                groupedByType[type].push(item)
              }

              return (
                <div className="space-y-6">
                  {/* 연결 요약 */}
                  <div className="flex items-center justify-center gap-2 text-sm text-amber-700">
                    <span className="w-8 h-px bg-gray-300" />
                    <span>{connected.length}개의 연결된 구절</span>
                    <span className="w-8 h-px bg-gray-300" />
                  </div>

                  {/* 유형별 그룹 */}
                  {Object.entries(groupedByType).map(([type, items]) => {
                    const style = RELATION_STYLES[type] || RELATION_STYLES.semantic
                    const description = RELATION_DESCRIPTIONS[type] || ''

                    return (
                      <div key={type} className="space-y-3">
                        {/* 유형 헤더 */}
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${style.bgColor} ${style.color} border ${style.borderColor}`}>
                            <span className={`w-2 h-2 rounded-full ${style.dotColor}`} />
                            {style.label}
                          </span>
                          <span className="text-xs text-gray-500">{items.length}개</span>
                          {description && (
                            <span className="text-xs text-gray-400 hidden sm:inline">- {description}</span>
                          )}
                        </div>

                        {/* 연결된 구절 카드들 */}
                        <div className="grid gap-3">
                          {items.map(({ verse, edge }, itemIndex) => {
                            const isExpanded = expandedNodes.has(verse.reference)
                            const subConnected = getConnectedVerses(verse.reference)
                              .filter(v => v.verse.reference !== centerNode.reference)
                            const isFirstItem = itemIndex === 0  // 첫 번째 항목인지 확인

                            return (
                              <div
                                key={verse.reference}
                                className={`bg-white rounded-xl border overflow-hidden hover:shadow-md transition-shadow ${
                                  isFirstItem ? 'border-amber-200 shadow-sm' : 'border-amber-100'
                                }`}
                              >
                                {/* 카드 헤더 */}
                                <div
                                  className={`cursor-pointer ${isFirstItem ? 'p-5' : 'p-4'}`}
                                  onClick={() => toggleExpand(verse.reference)}
                                >
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-2">
                                        <h4 className={`font-semibold text-amber-800 ${isFirstItem ? 'text-lg' : ''}`}>
                                          {verse.reference}
                                        </h4>
                                        {subConnected.length > 0 && (
                                          <span className="text-xs text-gray-400">
                                            +{subConnected.length}개 연결
                                          </span>
                                        )}
                                      </div>
                                      {verse.content && (
                                        <p className={`text-gray-700 leading-relaxed ${isFirstItem ? 'text-base' : 'text-sm'}`}>
                                          "{isFirstItem
                                            ? verse.content  // 첫 번째 항목은 전체 내용 표시
                                            : (verse.content.length > 150
                                              ? verse.content.substring(0, 150) + '...'
                                              : verse.content)}"
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 ml-3">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleVerseClick(verse.reference)
                                        }}
                                        className="px-3 py-1 bg-gradient-to-r from-amber-100 to-orange-100 text-amber-700 rounded-lg text-xs hover:from-amber-200 hover:to-orange-200 transition-colors"
                                      >
                                        여기서 탐색
                                      </button>
                                      <span className="text-amber-400 text-lg">
                                        {isExpanded ? '▼' : '▶'}
                                      </span>
                                    </div>
                                  </div>

                                  {/* 관계 설명 (OpenBible 상호참조 텍스트는 숨김) */}
                                  {edge.description && !edge.description.includes('OpenBible') && !edge.description.includes('상호참조') && (
                                    <p className="text-xs text-gray-400 mt-2 pl-2 border-l-2 border-amber-200">
                                      {edge.description}
                                    </p>
                                  )}
                                </div>

                                {/* 확장 시 2단계 연결 */}
                                {isExpanded && subConnected.length > 0 && (
                                  <div className="border-t border-gray-100 bg-gray-50/50 p-3">
                                    <p className="text-xs text-gray-500 mb-2 font-medium">
                                      이 구절과 연결된 다른 구절들:
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                      {subConnected.slice(0, 5).map(({ verse: subVerse, edge: subEdge }) => {
                                        const subStyle = RELATION_STYLES[subEdge.relationType] || RELATION_STYLES.semantic
                                        return (
                                          <button
                                            key={subVerse.reference}
                                            onClick={() => handleVerseClick(subVerse.reference)}
                                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${subStyle.bgColor} ${subStyle.color} border ${subStyle.borderColor} hover:opacity-80 transition-opacity`}
                                          >
                                            <span className={`w-1.5 h-1.5 rounded-full ${subStyle.dotColor}`} />
                                            {subVerse.reference}
                                          </button>
                                        )
                                      })}
                                      {subConnected.length > 5 && (
                                        <span className="px-3 py-1.5 text-xs text-gray-400">
                                          +{subConnected.length - 5}개 더
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* 통계 */}
            <div className="mt-8 pt-6 border-t border-amber-200 text-center">
              <div className="inline-flex gap-6 text-sm text-amber-600">
                <span>총 {graph.nodes.length}개 구절</span>
                <span>•</span>
                <span>{graph.edges.length}개 연결</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 푸터 안내 */}
      <footer className="fixed bottom-0 left-0 right-0 z-10 bg-white/90 backdrop-blur border-t border-gray-200 py-2 px-4">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-4 text-xs text-gray-500">
          <span>카드를 클릭하면 더 많은 연결을 볼 수 있습니다</span>
          <span>•</span>
          <span>"여기서 탐색" 버튼으로 해당 구절 중심으로 이동</span>
        </div>
      </footer>

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
