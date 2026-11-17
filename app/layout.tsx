import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CDEK FM · На высоких скоростях!',
  description: 'Праздничный телерадиоэфир для команды СДЭК!',
  icons: { icon: '/visual/cdek-mark.svg' },
};
export const viewport: Viewport = { themeColor: '#062229', colorScheme: 'dark' };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
