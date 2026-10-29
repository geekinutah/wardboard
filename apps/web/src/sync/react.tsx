import type { Board } from '@wardboard/core';
import type { OpKind } from '@wardboard/server';
import { useCallback, useContext, useEffect, useState, useSyncExternalStore, createContext } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  SyncClient,
  type ConnectionStatus,
  type OpOutcome,
  type SyncNotice,
  type SyncState,
  type WebSocketLike,
} from './client.ts';
import type { Me, Settings } from './protocol.ts';

const SyncContext = createContext<SyncClient | null>(null);

const STATUS_TEXT: Readonly<Record<ConnectionStatus, string>> = {
  live: 'Live',
  connecting: 'Connecting…',
  offline: 'Offline — reconnecting',
  forbidden: 'No access',
};

const OFFLINE_TEXT = "Offline. Changes can't be saved until the connection returns.";

function browserSocket(url: string): WebSocketLike {
  const socket = new WebSocket(url);
  let onopen: WebSocketLike['onopen'] = null;
  let onmessage: WebSocketLike['onmessage'] = null;
  let onclose: WebSocketLike['onclose'] = null;
  let onerror: WebSocketLike['onerror'] = null;
  return {
    get readyState() {
      return socket.readyState;
    },
    send(data) {
      socket.send(data);
    },
    close(code, reason) {
      if (code === undefined) socket.close();
      else socket.close(code, reason);
    },
    get onopen() {
      return onopen;
    },
    set onopen(fn) {
      onopen = fn;
      socket.onopen = fn === null ? null : () => {
        fn({});
      };
    },
    get onmessage() {
      return onmessage;
    },
    set onmessage(fn) {
      onmessage = fn;
      socket.onmessage = fn === null ? null : (event) => {
        fn({ data: event.data });
      };
    },
    get onclose() {
      return onclose;
    },
    set onclose(fn) {
      onclose = fn;
      socket.onclose = fn === null ? null : (event) => {
        fn({ code: event.code });
      };
    },
    get onerror() {
      return onerror;
    },
    set onerror(fn) {
      onerror = fn;
      socket.onerror = fn === null ? null : () => {
        fn({});
      };
    },
  };
}

function browserClient(): SyncClient {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return new SyncClient({
    url: `${protocol}://${location.host}/api/ws`,
    createSocket: browserSocket,
    timers: {
      setTimeout(fn, ms) {
        return setTimeout(fn, ms);
      },
      clearTimeout(handle) {
        if (typeof handle === 'number') {
          clearTimeout(handle);
          return;
        }
        if (typeof handle === 'object' && handle !== null) {
          clearTimeout(handle as ReturnType<typeof setTimeout>);
        }
      },
    },
    requestIds: () => crypto.randomUUID(),
  });
}

export function SyncProvider({
  client,
  children,
}: {
  client?: SyncClient;
  children: ReactNode;
}): ReactElement {
  const [owned] = useState<SyncClient | null>(() => (client === undefined ? browserClient() : null));
  const active = client ?? owned;
  if (active === null) throw new Error('SyncProvider has no client');
  useEffect(() => {
    if (client !== undefined) return;
    active.start();
    return () => {
      active.stop();
    };
  }, [active, client]);
  return <SyncContext.Provider value={active}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncState & {
  open: (boardId: string) => void;
  send: (kind: OpKind, request: object) => Promise<OpOutcome>;
  dismissNotice: () => void;
  fetchBoard: (boardId: string) => Promise<Board | null>;
} {
  const client = useContext(SyncContext);
  if (client === null) throw new Error('useSync must be used within SyncProvider');
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      client.subscribe(() => {
        onStoreChange();
      }),
    [client],
  );
  const getSnapshot = useCallback(() => client.getState(), [client]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    ...state,
    open: client.open,
    send: client.send,
    dismissNotice: client.dismissNotice,
    fetchBoard: client.fetchBoard,
  };
}

export function useSyncClient(): SyncClient {
  const client = useContext(SyncContext);
  if (client === null) throw new Error('useSyncClient must be used within SyncProvider');
  return client;
}

export function ConnectionIndicator(): ReactElement {
  const { status } = useSync();
  return (
    <p className="shell-connection" role="status" data-state={status}>
      <span className={`shell-connection-dot shell-connection-dot-${status}`} aria-hidden="true" />
      {STATUS_TEXT[status]}
    </p>
  );
}

function noticeText(notice: SyncNotice): string {
  if (notice.kind === 'stale') {
    return 'Someone else changed this board first. Your change was not applied; the board has been refreshed.';
  }
  if (notice.kind === 'resynced') return 'Reconnected. The board has been refreshed.';
  return `Your change was not applied: ${notice.message}`;
}

export const RESYNCED_NOTICE_MS = 5000;

export function SyncBanner(): ReactElement | null {
  const { status, notice, dismissNotice } = useSync();
  useEffect(() => {
    if (notice === null || notice.kind !== 'resynced') return;
    const handle = setTimeout(dismissNotice, RESYNCED_NOTICE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [notice, dismissNotice]);
  if (status !== 'offline' && notice === null) return null;
  return (
    <div className="shell-sync-banner" role="alert">
      {status === 'offline' ? <p className="shell-sync-offline">{OFFLINE_TEXT}</p> : null}
      {notice !== null ? (
        <div className="shell-sync-notice">
          <p>{noticeText(notice)}</p>
          <button
            type="button"
            className="shell-sync-dismiss"
            style={{ minWidth: 44, minHeight: 44 }}
            onClick={dismissNotice}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}

function useOnLive(load: (client: SyncClient) => void): void {
  const client = useContext(SyncContext);
  const { status } = useSync();
  useEffect(() => {
    if (client === null || status !== 'live') return;
    load(client);
  }, [client, status, load]);
}

export function useMe(): Me | null {
  const { me } = useSync();
  useOnLive(requestMe);
  return me;
}

export function useBaseline(): Board | null {
  const client = useContext(SyncContext);
  const { proposal, status } = useSync();
  const baselineId = proposal === null ? null : proposal.baselineBoardId;
  const [loaded, setLoaded] = useState<{ id: string; board: Board } | null>(null);

  useEffect(() => {
    if (client === null || baselineId === null || status !== 'live') return;
    let cancelled = false;
    void client.fetchBoard(baselineId).then((board) => {
      // A null result means the socket dropped mid-read. Leave the baseline
      // unloaded so the next live connection with this same id fetches again.
      if (cancelled || board === null) return;
      setLoaded({ id: baselineId, board });
    });
    return () => {
      cancelled = true;
    };
  }, [client, baselineId, status]);

  if (baselineId === null || loaded === null || loaded.id !== baselineId) return null;
  return loaded.board;
}

export function useSettings(): Settings | null {
  const { settings } = useSync();
  useOnLive(requestSettings);
  return settings;
}

export function useAccess(): SyncState['access'] {
  const client = useContext(SyncContext);
  if (client === null) throw new Error('useAccess must be used within SyncProvider');
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      client.subscribe(() => {
        onStoreChange();
      }),
    [client],
  );
  const getSnapshot = useCallback(() => client.getState().access, [client]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function requestMe(client: SyncClient): void {
  void client.whoami();
}

function requestSettings(client: SyncClient): void {
  void client.loadSettings();
}
