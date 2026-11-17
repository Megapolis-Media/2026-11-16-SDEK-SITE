import type { Metadata } from 'next';
import { MotionStudy } from './motion-study';
import './motion-study.css';

export const metadata: Metadata = {
  title: 'CDEK FM · Арт-дирекшн анимации',
  description: 'Три варианта 3D-переходов для лендинга «На высоких скоростях!».',
  robots: { index: false, follow: false },
};

export default function MotionPage() {
  return <MotionStudy />;
}
