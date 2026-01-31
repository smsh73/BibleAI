/**
 * 성경 구절 그래프 API
 * GET /api/verse-graph?reference=요한복음 3:16&depth=2
 *
 * GraphRAG를 사용하여 성경 구절 간의 관계를 시각화용 그래프 데이터로 반환
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  buildVerseGraph,
  getVerseRelations,
  getVerseThemes,
  getVerseContent,
  findSemanticRelations
} from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const timings: Record<string, number> = {}
  const startTotal = Date.now()

  try {
    const { searchParams } = new URL(req.url)
    const reference = searchParams.get('reference')
    const depth = parseInt(searchParams.get('depth') || '2')
    const version = searchParams.get('version') || 'GAE'  // 기본값 GAE (개역개정)

    if (!reference) {
      return NextResponse.json(
        { error: 'reference parameter is required' },
        { status: 400 }
      )
    }

    // 1. 그래프 데이터 빌드 (버전 필터 포함)
    const startBuildGraph = Date.now()
    const graph = await buildVerseGraph(reference, Math.min(depth, 3), version)
    timings['1_buildVerseGraph'] = Date.now() - startBuildGraph

    // 2. 의미적 유사 구절도 추가 (벡터 검색, 버전 필터 포함)
    const startSemantic = Date.now()
    const semanticRelations = await findSemanticRelations(reference, 0.85, 3, version)
    timings['2_findSemanticRelations'] = Date.now() - startSemantic

    // 3. 의미적 관계 노드/엣지 추가 (버전 필터 포함)
    const startAddNodes = Date.now()
    for (const rel of semanticRelations) {
      const existingNode = graph.nodes.find(n => n.reference === rel.reference)
      if (!existingNode) {
        const content = await getVerseContent(rel.reference, version)
        const themes = await getVerseThemes(rel.reference)
        graph.nodes.push({
          id: rel.reference,
          reference: rel.reference,
          content: content || undefined,
          themes,
          depth: 1
        })
      }

      // 엣지 추가
      const existingEdge = graph.edges.find(
        e => (e.source === reference && e.target === rel.reference) ||
             (e.target === reference && e.source === rel.reference)
      )
      if (!existingEdge) {
        graph.edges.push({
          source: reference,
          target: rel.reference,
          relationType: 'semantic',
          strength: rel.similarity,
          description: `의미적 유사도: ${(rel.similarity * 100).toFixed(1)}%`
        })
      }
    }
    timings['3_addSemanticNodes'] = Date.now() - startAddNodes
    timings['total'] = Date.now() - startTotal

    // 타이밍 로그 출력
    console.log('=== Verse Graph API Timings ===')
    console.log(`Reference: ${reference}, Depth: ${depth}`)
    Object.entries(timings).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}ms`)
    })
    console.log('===============================')

    return NextResponse.json({
      success: true,
      graph,
      metadata: {
        centerReference: reference,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        depth
      },
      _debug: {
        timings,
        buildGraphTimings: (graph as any)._timings || {}
      }
    })

  } catch (error) {
    console.error('Verse graph API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/verse-graph
 * 여러 구절에 대한 통합 그래프 생성
 */
export async function POST(req: NextRequest) {
  try {
    const { references, depth = 2, version = 'GAE' } = await req.json()

    if (!references || !Array.isArray(references) || references.length === 0) {
      return NextResponse.json(
        { error: 'references array is required' },
        { status: 400 }
      )
    }

    // 각 구절에 대해 그래프 생성 후 병합 (버전 필터 포함)
    const allNodes = new Map()
    const allEdges = new Map()

    for (const reference of references.slice(0, 5)) { // 최대 5개 구절
      const graph = await buildVerseGraph(reference, Math.min(depth, 2), version)

      // 노드 병합
      for (const node of graph.nodes) {
        if (!allNodes.has(node.id)) {
          allNodes.set(node.id, node)
        }
      }

      // 엣지 병합
      for (const edge of graph.edges) {
        const edgeKey = `${edge.source}-${edge.target}-${edge.relationType}`
        if (!allEdges.has(edgeKey)) {
          allEdges.set(edgeKey, edge)
        }
      }
    }

    const mergedGraph = {
      nodes: Array.from(allNodes.values()),
      edges: Array.from(allEdges.values()),
      centerReferences: references
    }

    return NextResponse.json({
      success: true,
      graph: mergedGraph,
      metadata: {
        centerReferences: references,
        nodeCount: mergedGraph.nodes.length,
        edgeCount: mergedGraph.edges.length,
        depth
      }
    })

  } catch (error) {
    console.error('Verse graph POST API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
