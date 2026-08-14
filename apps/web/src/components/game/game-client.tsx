'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PublicGameSnapshot, PublicMessage } from '@turtle-soup/contracts';
import { createBrowserSupabase, createRealtimeSubscribe } from '@/lib/supabase-browser';
import { createPlayerSession, fetchCurrentGame, joinCurrentGame, postFinalAnswer, postQuestion, type FinalAnswerReceipt } from '@/lib/game-api';
import { useGameRealtime, type RealtimeSubscribe } from '@/hooks/use-game-realtime';
import { FinalAnswerModal } from './final-answer-modal';
import { GameHeader } from './game-header';
import { GameRevealPanel } from './game-reveal-panel';
import { MessageComposer } from './message-composer';
import { MessageFeed } from './message-feed';
import type { GameMessage } from './message-row';
import { NicknameGate } from './nickname-gate';
import { PlayerStatsPanel } from './player-stats-panel';
import { PuzzlePanel } from './puzzle-panel';

type MessageSubmitResult = PublicMessage | null | void;
type FinalAnswerResult = FinalAnswerReceipt | 'FAILED' | 'SUCCEEDED' | void;

export type GameClientProps = {
  initialSnapshot: PublicGameSnapshot | null;
  currentPlayerId?: string;
  requireNickname?: boolean;
  demo?: boolean;
  enableFinalAnswer?: boolean;
  onNicknameSubmit?: (nickname: string) => void | Promise<void>;
  onMessageSubmit?: (content: string) => MessageSubmitResult | Promise<MessageSubmitResult>;
  onFinalAnswerSubmit?: (answer: string) => FinalAnswerResult | Promise<FinalAnswerResult>;
  fetchSnapshot?: () => Promise<PublicGameSnapshot | null>;
  subscribe?: RealtimeSubscribe;
};

type PrivateFinalAnswer = {
  answer: string;
  status: 'SUBMITTED' | 'FAILED';
  sequenceNo?: number;
};

function createClientId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function GameClient({
  initialSnapshot,
  currentPlayerId,
  requireNickname = false,
  demo = false,
  enableFinalAnswer = true,
  onNicknameSubmit,
  onMessageSubmit,
  onFinalAnswerSubmit,
  fetchSnapshot,
  subscribe,
}: GameClientProps) {
  const [nickname, setNickname] = useState('');
  const [sessionPlayerId, setSessionPlayerId] = useState(currentPlayerId);
  const [nicknameBusy, setNicknameBusy] = useState(false);
  const [nicknameError, setNicknameError] = useState<string>();
  const [localMessages, setLocalMessages] = useState<GameMessage[]>([]);
  const [messageError, setMessageError] = useState<string>();
  const [privateFinalAnswer, setPrivateFinalAnswer] = useState<PrivateFinalAnswer>();
  const [finalAnswerOpen, setFinalAnswerOpen] = useState(false);

  const browserSupabase = useMemo(() => createBrowserSupabase(), []);
  const defaultSubscribe = useMemo(() => createRealtimeSubscribe(browserSupabase), [browserSupabase]);
  const effectiveSubscribe = subscribe ?? defaultSubscribe;
  const effectiveFetch = fetchSnapshot ?? fetchCurrentGame;
  const realtime = useGameRealtime(initialSnapshot, {
    gameId: initialSnapshot?.game.id,
    fetchSnapshot: effectiveFetch,
    subscribe: effectiveSubscribe,
  });
  const { snapshot, refresh: refreshSnapshot } = realtime;
  const activePlayerId = sessionPlayerId ?? snapshot?.players[0]?.id;
  const activePlayer = snapshot?.players.find((player) => player.id === activePlayerId) ?? snapshot?.players[0];
  const visibleMessages = useMemo(() => {
    const serverIds = new Set(snapshot?.messages.map((message) => message.id));
    return [...(snapshot?.messages ?? []), ...localMessages.filter((message) => !serverIds.has(message.id))];
  }, [localMessages, snapshot?.messages]);

  useEffect(() => {
    const sequenceNo = privateFinalAnswer?.sequenceNo;
    if (!sequenceNo) return;
    const event = snapshot?.events.find((candidate) => candidate.sequenceNo === sequenceNo && candidate.playerId === activePlayerId);
    if (!event) {
      if (snapshot?.game.status === 'ENDED') setPrivateFinalAnswer(undefined);
      return;
    }
    if (event.eventType === 'FINAL_ANSWER_FAILED') {
      setPrivateFinalAnswer((current) => current ? { ...current, status: 'FAILED' } : current);
    } else if (event.eventType === 'FINAL_ANSWER_SUCCEEDED' || snapshot?.game.status === 'ENDED') {
      setPrivateFinalAnswer(undefined);
    }
  }, [activePlayerId, privateFinalAnswer?.sequenceNo, snapshot?.events, snapshot?.game.status]);

  const handleNicknameSubmit = useCallback(async (nextNickname: string) => {
    setNicknameBusy(true);
    setNicknameError(undefined);
    try {
      if (onNicknameSubmit) {
        await onNicknameSubmit(nextNickname);
      } else if (!demo) {
        const session = await createPlayerSession(nextNickname);
        setSessionPlayerId(session.playerId);
        await joinCurrentGame();
        await refreshSnapshot();
      }
      setNickname(nextNickname);
    } catch {
      setNicknameError('昵称暂时无法保存，请稍后重试。');
    } finally {
      setNicknameBusy(false);
    }
  }, [demo, onNicknameSubmit, refreshSnapshot]);

  const handleMessageSubmit = useCallback((content: string) => {
    if (!snapshot || snapshot.game.status !== 'ACTIVE') return;
    setMessageError(undefined);
    const localMessage: GameMessage = {
      id: createClientId('sending'),
      gameId: snapshot.game.id,
      playerId: activePlayerId ?? 'local-player',
      sequenceNo: Math.max(0, ...visibleMessages.map((message) => message.sequenceNo)) + 1,
      content,
      status: 'SENDING',
      verdict: null,
      awardedPoints: 0,
      createdAt: new Date().toISOString(),
      judgedAt: null,
      updatedAt: new Date().toISOString(),
    };
    setLocalMessages((messages) => [...messages, localMessage]);

    try {
      const submit = onMessageSubmit ?? (demo ? undefined : postQuestion);
      const result = submit?.(content);
      if (result && typeof (result as Promise<MessageSubmitResult>).then === 'function') {
        void (result as Promise<MessageSubmitResult>)
          .then((serverMessage) => {
            if (serverMessage) {
              setLocalMessages((messages) => messages.map((message) => message.id === localMessage.id ? serverMessage : message));
            }
          })
          .catch(() => {
            setLocalMessages((messages) => messages.filter((message) => message.id !== localMessage.id));
            setMessageError('问题发送失败，请稍后重试。');
          });
      } else if (result && typeof result === 'object') {
        setLocalMessages((messages) => messages.map((message) => message.id === localMessage.id ? result as PublicMessage : message));
      }
    } catch {
      setLocalMessages((messages) => messages.filter((message) => message.id !== localMessage.id));
      setMessageError('问题发送失败，请稍后重试。');
    }
  }, [activePlayerId, demo, onMessageSubmit, snapshot, visibleMessages]);

  const handleFinalAnswerSubmit = useCallback((answer: string) => {
    setFinalAnswerOpen(false);
    setPrivateFinalAnswer({ answer, status: 'SUBMITTED' });
    try {
      const submit = onFinalAnswerSubmit ?? (demo ? undefined : postFinalAnswer);
      const result = submit?.(answer);
      if (result && typeof (result as Promise<FinalAnswerResult>).then === 'function') {
        void (result as Promise<FinalAnswerResult>)
          .then((status) => {
            if (status === 'FAILED') setPrivateFinalAnswer({ answer, status: 'FAILED' });
            if (status === 'SUCCEEDED') setPrivateFinalAnswer(undefined);
            if (status && typeof status === 'object' && 'sequenceNo' in status) {
              setPrivateFinalAnswer({ answer, status: 'SUBMITTED', sequenceNo: status.sequenceNo });
            }
          })
          .catch(() => setPrivateFinalAnswer({ answer, status: 'FAILED' }));
      } else if (result === 'FAILED') {
        setPrivateFinalAnswer({ answer, status: 'FAILED' });
      } else if (result === 'SUCCEEDED') {
        setPrivateFinalAnswer(undefined);
      } else if (result && typeof result === 'object' && 'sequenceNo' in result) {
        setPrivateFinalAnswer({ answer, status: 'SUBMITTED', sequenceNo: result.sequenceNo });
      }
    } catch {
      setPrivateFinalAnswer({ answer, status: 'FAILED' });
    }
  }, [demo, onFinalAnswerSubmit]);

  if (requireNickname && !nickname && !sessionPlayerId) {
    return <NicknameGate onSubmit={handleNicknameSubmit} error={nicknameError} busy={nicknameBusy} />;
  }

  if (!snapshot) {
    return (
      <main className="site-shell">
        <section className="waiting-page" aria-labelledby="waiting-title">
          <p className="eyebrow">海龟汤 / 等待下一局</p>
          <h1 id="waiting-title">下一局故事还在准备中</h1>
          <p className="muted">管理员发布题面后，这里会自动出现公共故事表面。</p>
          {requireNickname ? <NicknameGate onSubmit={handleNicknameSubmit} error={nicknameError} busy={nicknameBusy} /> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="site-shell">
      <div className="dashboard-shell">
        <GameHeader game={snapshot.game} playerCount={snapshot.players.length} connection={realtime.connection} activePlayer={activePlayer?.displayNickname ?? nickname} />
        {demo ? <p className="demo-banner" role="status">当前显示的是前端演示数据；连接 Supabase 后会替换为真实单局快照。</p> : null}
        <div className="dashboard-grid">
          <div className="dashboard-main">
            <PuzzlePanel game={snapshot.game} />
            <MessageFeed messages={visibleMessages} players={snapshot.players} events={snapshot.events} />
            <GameRevealPanel reveal={snapshot.reveal} />
            {privateFinalAnswer ? (
              <aside className="private-answer-note" aria-live="polite">
                <strong>{privateFinalAnswer.status === 'FAILED' ? '最终答案判定失败' : '最终答案已私下提交'}</strong>
                <span>{privateFinalAnswer.status === 'FAILED' ? privateFinalAnswer.answer : '只有你能在本页面看到这条状态。'}</span>
              </aside>
            ) : null}
            <MessageComposer disabled={snapshot.game.status !== 'ACTIVE'} error={messageError} onSubmit={handleMessageSubmit} />
            <div className="final-answer-action">
              <button className="secondary-button" type="button" onClick={() => setFinalAnswerOpen(true)} disabled={!enableFinalAnswer || snapshot.game.status !== 'ACTIVE'}>
                提交最终答案
              </button>
              {!enableFinalAnswer ? <span className="muted">最终答案功能将在后续阶段开放。</span> : null}
              {enableFinalAnswer && snapshot.game.status === 'ENDED' ? <span className="muted">本局已结束，输入已停用。</span> : null}
            </div>
          </div>
          <aside className="dashboard-sidebar">
            <PlayerStatsPanel stats={snapshot.stats} />
            <section className="sidebar-card">
              <p className="eyebrow">当前玩家</p>
              <strong>{activePlayer?.displayNickname ?? (nickname || '未设置昵称')}</strong>
              <p className="muted">你的提问会进入同一条公开问题流，判定结果会显示在原问题右侧。</p>
            </section>
          </aside>
        </div>
      </div>
      <FinalAnswerModal key={finalAnswerOpen ? 'open' : 'closed'} open={finalAnswerOpen} disabled={!enableFinalAnswer || snapshot.game.status !== 'ACTIVE'} onClose={() => setFinalAnswerOpen(false)} onSubmit={handleFinalAnswerSubmit} />
    </main>
  );
}
