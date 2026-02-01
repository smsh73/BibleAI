'use client'

/**
 * 성경 구절 관계 네트워크 그래프 시각화 컴포넌트
 * react-force-graph-2d를 사용한 인터랙티브 그래프
 */

import { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import dynamic from 'next/dynamic'

// SSR 비활성화 (canvas 사용하는 라이브러리)
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full" />
    </div>
  )
})

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

interface Props {
  nodes: VerseNode[]
  edges: VerseEdge[]
  centerReference: string
  onNodeClick: (reference: string) => void
  height?: number
}

// 관계 유형별 색상
const RELATION_COLORS: Record<string, string> = {
  prophecy_fulfillment: '#f43f5e', // rose-500
  parallel: '#3b82f6',             // blue-500
  quotation: '#8b5cf6',            // violet-500
  thematic: '#10b981',             // emerald-500
  narrative: '#f59e0b',            // amber-500
  theological: '#ec4899',          // pink-500
  semantic: '#64748b'              // slate-500
}

// 관계 유형 라벨
const RELATION_LABELS: Record<string, string> = {
  prophecy_fulfillment: '예언/성취',
  parallel: '평행본문',
  quotation: '인용',
  thematic: '주제',
  narrative: '서사',
  theological: '신학',
  semantic: '의미유사'
}

export default function VerseGraphVisualization({
  nodes,
  edges,
  centerReference,
  onNodeClick,
  height = 500
}: Props) {
  const graphRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height })
  // hoveredNode를 ref로 관리하여 리렌더링 방지
  const hoveredNodeRef = useRef<string | null>(null)
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hoveredNodeForTooltip, setHoveredNodeForTooltip] = useState<string | null>(null)
  const [selectedRelationType, setSelectedRelationType] = useState<string | null>(null)

  // 컨테이너 크기 감지
  useEffect(() => {
    if (!containerRef.current) return

    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height
        })
      }
    }

    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [height])

  // 타임아웃 정리
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current)
      }
    }
  }, [])

  // 그래프 데이터 변환 (메모이제이션으로 불필요한 재생성 방지)
  const graphData = useMemo(() => ({
    nodes: nodes.map(node => ({
      id: node.reference,
      reference: node.reference,
      content: node.content,
      themes: node.themes,
      depth: node.depth,
      isCenter: node.reference === centerReference,
      // 노드 크기 및 색상
      val: node.reference === centerReference ? 20 : 10,
      color: node.reference === centerReference ? '#f59e0b' : '#fbbf24'
    })),
    links: edges
      .filter(edge => !selectedRelationType || edge.relationType === selectedRelationType)
      .map(edge => ({
        source: edge.source,
        target: edge.target,
        relationType: edge.relationType,
        strength: edge.strength,
        description: edge.description,
        color: RELATION_COLORS[edge.relationType] || RELATION_COLORS.semantic
      }))
  }), [nodes, edges, centerReference, selectedRelationType])

  // d3 force 설정 - 노드 간 간격 확대
  useEffect(() => {
    if (!graphRef.current) return

    const fg = graphRef.current

    // charge: 노드 간 반발력 (음수가 클수록 더 밀어냄)
    fg.d3Force('charge')?.strength(-400)

    // link: 연결된 노드 간 거리
    fg.d3Force('link')?.distance(120)

    // center: 중심으로 끌어당기는 힘
    fg.d3Force('center')?.strength(0.05)

    // 시뮬레이션 재시작
    fg.d3ReheatSimulation()
  }, [nodes, edges, selectedRelationType])

  // 노드 캔버스 렌더링 (ref 사용으로 의존성 제거)
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    // 좌표가 유효한지 확인 (force simulation 초기화 전에는 undefined일 수 있음)
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      return
    }

    const label = node.reference
    const fontSize = node.isCenter ? 16 / globalScale : 13 / globalScale
    const nodeRadius = node.isCenter ? 18 : 12
    const isHovered = hoveredNodeRef.current === node.id

    // 노드 원 그리기
    ctx.beginPath()
    ctx.arc(node.x, node.y, nodeRadius, 0, 2 * Math.PI)

    if (node.isCenter) {
      // 중심 노드 - 그라데이션 효과
      const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, nodeRadius)
      gradient.addColorStop(0, '#f59e0b')
      gradient.addColorStop(1, '#ea580c')
      ctx.fillStyle = gradient
    } else if (isHovered) {
      ctx.fillStyle = '#fbbf24'
    } else {
      ctx.fillStyle = node.depth === 1 ? '#fcd34d' : '#fef3c7'
    }
    ctx.fill()

    // 테두리
    ctx.strokeStyle = node.isCenter ? '#c2410c' : '#d97706'
    ctx.lineWidth = node.isCenter ? 2 : 1
    ctx.stroke()

    // 라벨 배경
    ctx.font = `${node.isCenter ? 'bold ' : ''}${fontSize}px 'Noto Sans KR', sans-serif`
    const textWidth = ctx.measureText(label).width
    const padding = 4 / globalScale
    const bgHeight = fontSize + padding * 2
    const bgY = node.y + nodeRadius + 4 / globalScale

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.fillRect(
      node.x - textWidth / 2 - padding,
      bgY - padding,
      textWidth + padding * 2,
      bgHeight
    )

    // 라벨 텍스트
    ctx.fillStyle = node.isCenter ? '#92400e' : '#78350f'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(label, node.x, bgY)
  }, [])

  // 노드 포인터 영역 (클릭/호버 감지 영역)
  const paintNodePointerArea = useCallback((node: any, color: string, ctx: CanvasRenderingContext2D) => {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return
    ctx.beginPath()
    ctx.arc(node.x, node.y, node.isCenter ? 22 : 16, 0, 2 * Math.PI)
    ctx.fillStyle = color
    ctx.fill()
  }, [])

  // 링크 렌더링 (ref 사용으로 의존성 제거)
  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const start = link.source
    const end = link.target

    // 좌표가 유효한지 확인
    if (!Number.isFinite(start.x) || !Number.isFinite(start.y) ||
        !Number.isFinite(end.x) || !Number.isFinite(end.y)) {
      return
    }

    const currentHovered = hoveredNodeRef.current

    // 선 그리기
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.strokeStyle = link.color
    ctx.lineWidth = Math.max(1.5, link.strength * 4) / globalScale
    ctx.globalAlpha = currentHovered && (currentHovered !== start.id && currentHovered !== end.id) ? 0.15 : 0.85
    ctx.stroke()
    ctx.globalAlpha = 1
  }, [])

  // 노드 클릭 핸들러 (메모이제이션)
  const handleNodeClick = useCallback((node: any) => {
    onNodeClick(node.reference)
  }, [onNodeClick])

  // 노드 호버 핸들러 (메모이제이션)
  const handleNodeHover = useCallback((node: any) => {
    const newHoveredId = node?.id || null
    // ref 업데이트 (리렌더링 없이)
    hoveredNodeRef.current = newHoveredId

    // 툴팁 업데이트 디바운스 (그래프 흔들림 방지)
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
    }
    tooltipTimeoutRef.current = setTimeout(() => {
      setHoveredNodeForTooltip(newHoveredId)
    }, 100)
  }, [])

  // 시뮬레이션 완료 후 화면에 맞게 줌
  const handleEngineStop = useCallback(() => {
    if (graphRef.current) {
      graphRef.current.zoomToFit(400, 60)
    }
  }, [])

  // 관계 유형 통계
  const relationStats = edges.reduce((acc, edge) => {
    acc[edge.relationType] = (acc[edge.relationType] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-4">
      {/* 범례 및 필터 */}
      <div className="bg-white rounded-xl border border-amber-100 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-amber-800">관계 유형</h3>
          {selectedRelationType && (
            <button
              onClick={() => setSelectedRelationType(null)}
              className="text-xs text-amber-600 hover:text-amber-800"
            >
              전체 보기
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(relationStats).map(([type, count]) => {
            const color = RELATION_COLORS[type] || RELATION_COLORS.semantic
            const label = RELATION_LABELS[type] || type
            const isSelected = selectedRelationType === type

            return (
              <button
                key={type}
                onClick={() => setSelectedRelationType(isSelected ? null : type)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  isSelected
                    ? 'ring-2 ring-offset-1 ring-amber-400 shadow-sm'
                    : 'hover:opacity-80'
                }`}
                style={{
                  backgroundColor: `${color}20`,
                  color: color,
                  borderWidth: 1,
                  borderColor: color
                }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {label}
                <span className="opacity-60">({count})</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 그래프 */}
      <div
        ref={containerRef}
        className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200 overflow-hidden"
        style={{ height }}
      >
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintNodePointerArea}
          linkCanvasObject={paintLink}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          cooldownTicks={200}
          d3AlphaDecay={0.01}
          d3VelocityDecay={0.2}
          // 노드 간 거리 확대 설정
          d3AlphaMin={0.001}
          linkDirectionalParticles={2}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleSpeed={0.005}
          enableZoomInteraction={true}
          enablePanInteraction={true}
          minZoom={0.3}
          maxZoom={4}
          // 초기 줌 레벨
          onEngineStop={handleEngineStop}
        />
      </div>

      {/* 도움말 */}
      <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
        <span>🖱️ 노드 클릭: 해당 구절 탐색</span>
        <span>•</span>
        <span>🔍 스크롤: 확대/축소</span>
        <span>•</span>
        <span>✋ 드래그: 화면 이동</span>
      </div>

      {/* 호버된 노드 정보 */}
      {hoveredNodeForTooltip && (
        <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-white rounded-xl shadow-lg border border-amber-200 p-4 max-w-md z-50 animate-fade-in">
          {(() => {
            const node = nodes.find(n => n.reference === hoveredNodeForTooltip)
            if (!node) return null
            return (
              <div>
                <h4 className="font-semibold text-amber-800 mb-1">{node.reference}</h4>
                {node.content && (
                  <p className="text-sm text-gray-700 line-clamp-3">"{node.content}"</p>
                )}
                {node.themes && node.themes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {node.themes.slice(0, 3).map(theme => (
                      <span key={theme} className="px-2 py-0.5 bg-amber-50 text-amber-600 text-xs rounded">
                        #{theme}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
