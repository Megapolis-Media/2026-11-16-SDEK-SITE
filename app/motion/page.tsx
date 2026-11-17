import type { Metadata } from 'next';
import { MotionStudy } from './motion-study';
import './motion-study.css';

export const metadata: Metadata = {
  title: 'CDEK FM · Арт-дирекшн анимации',
  description: 'Три варианта 3D-переходов для лендинга «На высоких скоростях!».',
  robots: { index: false, follow: false },
};

export default async function MotionPage({ searchParams }: { searchParams: Promise<{ variant?: string | string[] }> }) {
  const { variant } = await searchParams;
  return <MotionStudy initialVariant={Array.isArray(variant) ? variant[0] : variant} />;
}
