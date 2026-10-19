import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { focusedPane, uid } from '../../store/ops';
import { useStore } from '../../store/store';
import type { PaneSpec, ProviderId } from '../../store/types';
import { useSettings, splitArgs } from '../settings/settings';
import { getPaneCwd } from '../terminal/registry';

export type AuthState = 'subscription' | 'api_key' | 'logged_out' | 'unknown';

export interface ProviderStatus {
  id: ProviderId;
  installed: boolean;
  binPath?: string;
  version?: string;
  auth: AuthState;
  plan?: string;
  account?: string;
  evidence: string;
  warnings: string[];
  installHint?: string;
  checkedAt: number;
}

export interface ProviderMeta {
  name: string;
  /** PATH에서 찾을 때 쓰는 이름 (감지된 binPath가 없을 때) */
  bin: string;
  /** 구독으로만 실행할 때 자식 프로세스에서 지울 API 키 환경변수 */
  apiKeyEnv: string[];
  /** 권한 확인을 건너뛰는 CLI 플래그 (사용자가 요청한 기본 동작) */
  skipPermissionsArgs: string[];
  /** 기본 인자. 모델 · 이어하기 등 사용자 인자는 설정의 providerArgs. */
  args: string[];
}

export const PROVIDER_ORDER: ProviderId[] = ['claude', 'codex', 'antigravity'];

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  claude: {
    name: 'Claude Code',
    bin: 'claude',
    apiKeyEnv: ['ANTHROPIC_API_KEY'],
    skipPermissionsArgs: ['--dangerously-skip-permissions'],
    args: [],
  },
  codex: {
    name: 'Codex',
    bin: 'codex',
    apiKeyEnv: ['OPENAI_API_KEY'],
    skipPermissionsArgs: ['--dangerously-bypass-approvals-and-sandbox'],
    args: [],
  },
  antigravity: {
    name: 'Antigravity',
    bin: 'agy',
    apiKeyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    skipPermissionsArgs: ['--dangerously-skip-permissions'],
    args: [],
  },
};

/** 이 pane의 자식 프로세스에서 지울 환경변수 */
export function envRemoveFor(pane: PaneSpec): string[] | undefined {
  if (!useSettings.getState().settings.subscriptionOnly || pane.kind !== 'agent' || !pane.provider)
    return undefined;
  return PROVIDER_META[pane.provider].apiKeyEnv;
}

interface ProvidersState {
  statuses: ProviderStatus[];
  load: () => Promise<void>;
}

export const useProviders = create<ProvidersState>()((set) => ({
  statuses: [],
  load: async () => {
    try {
      set({ statuses: await invoke<ProviderStatus[]>('providers_detect') });
      await listen<ProviderStatus[]>('providers://changed', (e) => set({ statuses: e.payload }));
    } catch (e) {
      console.error('providers_detect 실패', e);
    }
  },
}));

export type LaunchWhere = 'row' | 'col' | 'tab';

/** AI CLI를 새 pane으로 연다. 실패하면 사용자에게 보여줄 안내 문장을 돌려준다. */
export function launchAgent(provider: ProviderId, where: LaunchWhere): string | null {
  const meta = PROVIDER_META[provider];
  const status = useProviders.getState().statuses.find((s) => s.id === provider);
  if (!status?.installed) {
    return status?.installHint
      ? `${meta.name}이(가) 설치되어 있지 않습니다 — ${status.installHint}`
      : `${meta.name}이(가) 설치되어 있지 않습니다`;
  }
  const { skipPermissions, providerArgs } = useSettings.getState().settings;
  const state = useStore.getState();
  const from = focusedPane(state);
  const pane: PaneSpec = {
    id: uid('p'),
    kind: 'agent',
    provider,
    profileId: from?.profileId ?? 'pwsh',
    command: status.binPath ?? meta.bin,
    args: [
      ...(skipPermissions ? meta.skipPermissionsArgs : []),
      ...meta.args,
      ...splitArgs(providerArgs[provider]),
    ],
    // OSC 7로 알게 된 현재 폴더 > pane의 시작 폴더
    cwd: (from && getPaneCwd(from.id)) ?? from?.cwd ?? '',
    title: meta.name,
  };
  state.openPane(where, pane);
  return null;
}
