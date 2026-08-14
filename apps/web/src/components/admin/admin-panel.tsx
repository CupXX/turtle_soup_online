'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminLogin,
  createGame,
  fetchAdminStatus,
  replacePreparation,
  retryExtraction as retryExtractionRequest,
  type AdminStatusResponse,
} from '@/lib/game-api';
import { AdminLoginForm, type AdminLoginInput } from './admin-login-form';
import { ExtractionStatus, type ExtractionStatusValue } from './extraction-status';
import { ForceEndControl } from './force-end-control';
import { GamePreparationForm, type GamePreparationInput } from './game-preparation-form';

type AdminPanelProps = {
  demo?: boolean;
  onLogin?: (input: AdminLoginInput) => void | Promise<void>;
  onPreparationSubmit?: (input: GamePreparationInput) => void | Promise<void>;
  onRetryExtraction?: () => void | Promise<void>;
  onForceEnd?: () => void | Promise<void>;
};

function statusForExtraction(value: string | null): ExtractionStatusValue {
  if (value === 'COMPLETED') return 'READY';
  if (value === 'BLOCKED') return 'BLOCKED';
  if (value === 'PENDING' || value === 'PROCESSING' || value === 'RETRY') return 'RUNNING';
  return 'IDLE';
}

export function AdminPanel({ demo = false, onLogin, onPreparationSubmit, onRetryExtraction, onForceEnd }: AdminPanelProps) {
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<ExtractionStatusValue>('IDLE');
  const [adminStatus, setAdminStatus] = useState<AdminStatusResponse | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    if (!authenticated || demo) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await fetchAdminStatus();
        if (cancelled) return;
        setAdminStatus(next);
        setStatus(statusForExtraction(next.extractionStatus));
        setStatusMessage(next.errorCode ? `错误码：${next.errorCode}` : next.workerHealthy ? undefined : '判定 Worker 暂未连接。');
      } catch {
        if (!cancelled) {
          setStatus('FAILED');
          setStatusMessage('管理状态暂时无法刷新。');
        }
      } finally {
        if (!cancelled) timer = setTimeout(poll, 2000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [authenticated, demo]);

  async function handleLogin(input: AdminLoginInput) {
    setBusy(true);
    setError(undefined);
    try {
      if (onLogin) {
        await onLogin(input);
      } else if (!demo) {
        await adminLogin(input);
      }
      setAuthenticated(true);
    } catch {
      setError('管理员会话暂时无法建立，请检查密钥后重试。');
    } finally {
      setBusy(false);
    }
  }

  async function handlePreparation(input: GamePreparationInput) {
    setBusy(true);
    setError(undefined);
    try {
      if (onPreparationSubmit) {
        await onPreparationSubmit(input);
      } else if (!demo) {
        const currentStatus = adminStatus ?? await fetchAdminStatus();
        setAdminStatus(currentStatus);
        if (currentStatus.gameStatus === 'WAITING') {
          await replacePreparation(input);
        } else {
          await createGame(input);
        }
      }
      setStatus('RUNNING');
      setNotice(demo ? '演示模式：题面字段已通过界面校验。' : '题面已提交，等待线索提取。');
    } catch {
      setError('准备请求失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  async function retryExtraction() {
    setStatus('RUNNING');
    try {
      if (onRetryExtraction) {
        await onRetryExtraction();
      } else if (!demo) {
        await retryExtractionRequest();
      }
      setNotice('已请求重新提取线索。');
    } catch {
      setStatus('FAILED');
      setNotice('重试请求失败，请稍后再试。');
    }
  }

  async function forceEnd() {
    try {
      await onForceEnd?.();
      setNotice('已提交强制结束请求。');
    } catch {
      setNotice('强制结束请求失败，请确认当前游戏仍处于进行中。');
    }
  }

  if (!authenticated) {
    return <AdminLoginForm onSubmit={handleLogin} busy={busy} error={error} />;
  }

  return (
    <main className="site-shell">
      <div className="admin-shell">
        <header className="game-header">
          <div>
            <p className="eyebrow">海龟汤 / 最小管理台</p>
            <h1>把下一局准备好</h1>
          </div>
          <Link className="text-link" href="/">返回玩家页</Link>
        </header>
        {demo ? <p className="demo-banner" role="status">当前为演示模式，提交按钮只验证界面流程。</p> : null}
        {notice ? <p className="private-answer-note" role="status">{notice}</p> : null}
        <div className="admin-grid">
          <div className="admin-main">
            <GamePreparationForm onSubmit={handlePreparation} busy={busy} error={error} />
            <ExtractionStatus status={status} message={statusMessage} onRetry={retryExtraction} />
          </div>
          <aside className="admin-sidebar">
            <ForceEndControl
              disabled={!onForceEnd}
              disabledMessage={!onForceEnd ? '强制结束将在后续阶段开放。' : undefined}
              onConfirm={forceEnd}
            />
            <section className="admin-card sidebar-card">
              <p className="eyebrow">安全边界</p>
              <p className="muted">管理台只显示状态、错误码和输入表单，不回显已保存的完整答案或隐藏线索。</p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
