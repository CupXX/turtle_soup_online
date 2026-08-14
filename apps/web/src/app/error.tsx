'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main role="alert">
      <h1>页面暂时不可用</h1>
      <p>请稍后重试。</p>
      <button type="button" onClick={reset}>
        重试
      </button>
    </main>
  );
}
