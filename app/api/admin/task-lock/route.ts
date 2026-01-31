/**
 * 작업 잠금 API
 * 동시에 하나의 추출 작업만 실행되도록 관리
 *
 * GET: 현재 잠금 상태 조회
 * POST: 잠금 획득 시도
 * PATCH: 중지 요청 (graceful stop)
 * DELETE: 잠금 해제
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export type TaskType = 'sermon' | 'news' | 'bulletin' | 'bible'

interface TaskLock {
  id: number
  task_type: TaskType
  started_at: string
  started_by?: string
  description?: string
  is_active: boolean
  stop_requested?: boolean
}

// 잠금 테이블이 없으면 메모리 기반 잠금 사용
let memoryLock: {
  taskType: TaskType | null
  startedAt: Date | null
  description: string | null
  stopRequested: boolean
  currentItem: string | null  // 현재 처리 중인 항목 (예: "504호", "2026-01-26 주보")
  processedCount: number      // 처리 완료된 항목 수
  totalCount: number          // 전체 처리 대상 수
} = {
  taskType: null,
  startedAt: null,
  description: null,
  stopRequested: false,
  currentItem: null,
  processedCount: 0,
  totalCount: 0
}

// 잠금 타임아웃 (2시간) - 작업이 비정상 종료된 경우 자동 해제
const LOCK_TIMEOUT_MS = 2 * 60 * 60 * 1000

/**
 * GET: 현재 잠금 상태 조회
 */
export async function GET() {
  try {
    const client = getSupabaseAdmin()

    if (client) {
      // Supabase에서 활성 잠금 조회
      const { data, error } = await client
        .from('task_locks')
        .select('*')
        .eq('is_active', true)
        .order('started_at', { ascending: false })
        .limit(1)
        .single()

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
        // 테이블이 없으면 메모리 잠금 사용
        if (error.message?.includes('does not exist')) {
          return getMemoryLockStatus()
        }
        throw error
      }

      if (data) {
        // 타임아웃 체크
        const startedAt = new Date(data.started_at)
        if (Date.now() - startedAt.getTime() > LOCK_TIMEOUT_MS) {
          // 자동 해제
          await client
            .from('task_locks')
            .update({ is_active: false })
            .eq('id', data.id)

          return NextResponse.json({
            locked: false,
            message: '이전 작업이 타임아웃되어 자동 해제되었습니다.'
          })
        }

        return NextResponse.json({
          locked: true,
          taskType: data.task_type,
          startedAt: data.started_at,
          description: data.description,
          elapsedMinutes: Math.floor((Date.now() - startedAt.getTime()) / 60000),
          stopRequested: data.stop_requested || memoryLock.stopRequested,
          currentItem: memoryLock.currentItem,
          processedCount: memoryLock.processedCount,
          totalCount: memoryLock.totalCount
        })
      }

      return NextResponse.json({ locked: false })
    }

    // Supabase 없으면 메모리 잠금
    return getMemoryLockStatus()

  } catch (error: any) {
    console.error('Task lock GET error:', error)
    return getMemoryLockStatus()
  }
}

/**
 * POST: 잠금 획득 시도
 */
export async function POST(req: NextRequest) {
  try {
    const { taskType, description } = await req.json() as {
      taskType: TaskType
      description?: string
    }

    if (!taskType) {
      return NextResponse.json(
        { error: 'taskType is required' },
        { status: 400 }
      )
    }

    const client = getSupabaseAdmin()

    if (client) {
      // 기존 활성 잠금 확인
      const { data: existing, error: selectError } = await client
        .from('task_locks')
        .select('*')
        .eq('is_active', true)
        .single()

      // 테이블이 없으면 메모리 잠금 사용
      if (selectError?.message?.includes('does not exist') ||
          selectError?.message?.includes('Could not find') ||
          selectError?.code === 'PGRST205') {
        return acquireMemoryLock(taskType, description)
      }

      if (existing) {
        // 타임아웃 체크
        const startedAt = new Date(existing.started_at)
        if (Date.now() - startedAt.getTime() > LOCK_TIMEOUT_MS) {
          // 타임아웃된 잠금 해제
          await client
            .from('task_locks')
            .update({ is_active: false })
            .eq('id', existing.id)
        } else {
          const taskNames: Record<TaskType, string> = {
            sermon: '설교 추출',
            news: '뉴스 기사 추출',
            bulletin: '주보 추출',
            bible: '성경 임베딩'
          }

          return NextResponse.json({
            success: false,
            locked: true,
            currentTask: existing.task_type,
            message: `현재 "${taskNames[existing.task_type as TaskType] || existing.task_type}" 작업이 진행 중입니다. 완료 후 시도해주세요.`,
            elapsedMinutes: Math.floor((Date.now() - startedAt.getTime()) / 60000)
          }, { status: 409 })
        }
      }

      // 새 잠금 생성
      const { data, error } = await client
        .from('task_locks')
        .insert({
          task_type: taskType,
          description: description || `${taskType} extraction`,
          is_active: true,
          started_at: new Date().toISOString()
        })
        .select()
        .single()

      if (error) {
        if (error.message?.includes('does not exist') ||
            error.message?.includes('Could not find') ||
            error.code === 'PGRST205') {
          return acquireMemoryLock(taskType, description)
        }
        throw error
      }

      return NextResponse.json({
        success: true,
        lockId: data.id,
        message: '작업 잠금을 획득했습니다.'
      })
    }

    // 메모리 잠금
    return acquireMemoryLock(taskType, description)

  } catch (error: any) {
    console.error('Task lock POST error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to acquire lock' },
      { status: 500 }
    )
  }
}

/**
 * PATCH: 중지 요청 또는 진행 상태 업데이트
 * - action: 'stop' - 중지 요청
 * - action: 'progress' - 진행 상태 업데이트
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, taskType, currentItem, processedCount, totalCount } = body

    if (action === 'stop') {
      // 중지 요청
      const client = getSupabaseAdmin()

      if (client) {
        await client
          .from('task_locks')
          .update({ stop_requested: true })
          .eq('is_active', true)
          .eq('task_type', taskType || memoryLock.taskType || '')
          .catch(() => {})  // 테이블 없으면 무시
      }

      // 메모리 잠금에도 중지 요청 설정
      if (memoryLock.taskType === taskType || !taskType) {
        memoryLock.stopRequested = true
      }

      console.log(`[task-lock] 중지 요청됨: ${taskType || memoryLock.taskType}`)

      return NextResponse.json({
        success: true,
        message: '중지 요청이 전송되었습니다. 현재 항목 처리 완료 후 중지됩니다.',
        currentItem: memoryLock.currentItem
      })
    }

    if (action === 'progress') {
      // 진행 상태 업데이트
      if (currentItem !== undefined) memoryLock.currentItem = currentItem
      if (processedCount !== undefined) memoryLock.processedCount = processedCount
      if (totalCount !== undefined) memoryLock.totalCount = totalCount

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  } catch (error: any) {
    console.error('Task lock PATCH error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update task' },
      { status: 500 }
    )
  }
}

/**
 * DELETE: 잠금 해제
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const taskType = searchParams.get('taskType') as TaskType

    const client = getSupabaseAdmin()

    if (client) {
      const { error } = await client
        .from('task_locks')
        .update({ is_active: false, stop_requested: false })
        .eq('is_active', true)
        .eq('task_type', taskType || '')

      if (error && !error.message?.includes('does not exist')) {
        throw error
      }
    }

    // 메모리 잠금도 해제
    if (!taskType || memoryLock.taskType === taskType) {
      memoryLock = {
        taskType: null,
        startedAt: null,
        description: null,
        stopRequested: false,
        currentItem: null,
        processedCount: 0,
        totalCount: 0
      }
    }

    return NextResponse.json({
      success: true,
      message: '작업 잠금이 해제되었습니다.'
    })

  } catch (error: any) {
    console.error('Task lock DELETE error:', error)
    // 에러가 나도 메모리 잠금 해제
    memoryLock = {
      taskType: null,
      startedAt: null,
      description: null,
      stopRequested: false,
      currentItem: null,
      processedCount: 0,
      totalCount: 0
    }
    return NextResponse.json({ success: true })
  }
}

// 메모리 잠금 상태 조회
function getMemoryLockStatus() {
  if (memoryLock.taskType && memoryLock.startedAt) {
    // 타임아웃 체크
    if (Date.now() - memoryLock.startedAt.getTime() > LOCK_TIMEOUT_MS) {
      memoryLock = {
        taskType: null,
        startedAt: null,
        description: null,
        stopRequested: false,
        currentItem: null,
        processedCount: 0,
        totalCount: 0
      }
      return NextResponse.json({ locked: false })
    }

    return NextResponse.json({
      locked: true,
      taskType: memoryLock.taskType,
      startedAt: memoryLock.startedAt.toISOString(),
      description: memoryLock.description,
      elapsedMinutes: Math.floor((Date.now() - memoryLock.startedAt.getTime()) / 60000),
      stopRequested: memoryLock.stopRequested,
      currentItem: memoryLock.currentItem,
      processedCount: memoryLock.processedCount,
      totalCount: memoryLock.totalCount
    })
  }

  return NextResponse.json({ locked: false })
}

// 메모리 잠금 획득
function acquireMemoryLock(taskType: TaskType, description?: string) {
  if (memoryLock.taskType && memoryLock.startedAt) {
    // 타임아웃 체크
    if (Date.now() - memoryLock.startedAt.getTime() < LOCK_TIMEOUT_MS) {
      const taskNames: Record<TaskType, string> = {
        sermon: '설교 추출',
        news: '뉴스 기사 추출',
        bulletin: '주보 추출',
        bible: '성경 임베딩'
      }

      return NextResponse.json({
        success: false,
        locked: true,
        currentTask: memoryLock.taskType,
        message: `현재 "${taskNames[memoryLock.taskType]}" 작업이 진행 중입니다. 완료 후 시도해주세요.`
      }, { status: 409 })
    }
  }

  memoryLock = {
    taskType,
    startedAt: new Date(),
    description: description || null,
    stopRequested: false,
    currentItem: null,
    processedCount: 0,
    totalCount: 0
  }

  return NextResponse.json({
    success: true,
    message: '작업 잠금을 획득했습니다.'
  })
}

/**
 * 중지 요청 확인 함수 (외부에서 import하여 사용)
 */
export function isStopRequested(): boolean {
  return memoryLock.stopRequested
}

/**
 * 진행 상태 업데이트 함수 (외부에서 import하여 사용)
 */
export function updateProgress(currentItem: string, processedCount: number, totalCount: number) {
  memoryLock.currentItem = currentItem
  memoryLock.processedCount = processedCount
  memoryLock.totalCount = totalCount
}
