// Prisma 7.x 호환성 문제로 인해 임시 비활성화
// 주요 기능은 Supabase를 통해 작동합니다

// 더미 Prisma 클라이언트 (관리자 기능 비활성화)
export const prisma = {
  apiKey: {
    findMany: async () => [],
    findUnique: async () => null,
    upsert: async () => ({}),
    delete: async () => ({})
  },
  apiUsage: {
    create: async () => ({})
  },
  user: {
    findUnique: async () => null
  },
  conversation: {
    findMany: async () => [],
    create: async () => ({})
  },
  message: {
    create: async () => ({})
  }
} as any
