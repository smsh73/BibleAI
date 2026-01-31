'use client'

/**
 * 예수님 실루엣 컴포넌트
 * 팔을 벌려 환영하시는 평안한 모습
 * 원본 이미지를 실루엣으로 사용
 */

import Image from 'next/image'

interface JesusSilhouetteProps {
  className?: string
  opacity?: number
}

export default function JesusSilhouette({
  className = '',
  opacity = 0.08
}: JesusSilhouetteProps) {
  return (
    <div
      className={`relative ${className}`}
      style={{ opacity }}
    >
      <Image
        src="/images/jesus's siluet.webp"
        alt=""
        fill
        className="object-contain"
        style={{
          filter: 'grayscale(100%) brightness(1.2)',
        }}
        priority
      />
    </div>
  )
}
