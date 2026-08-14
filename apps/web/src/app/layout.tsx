import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '海龟汤',
  description: '多人协作推理游戏',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
