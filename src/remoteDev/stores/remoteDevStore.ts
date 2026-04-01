/**
 * 远程开发状态管理
 *
 * IDE 布局：所有面板同时可见，通过机器选择器联动
 *
 * @module remoteDev/stores/remoteDevStore
 */

import { create } from 'zustand';
import type { Machine, RelayToken, RemoteDevTab } from '../types/remoteDev';

interface RemoteDevState {
  /** @deprecated 保留向后兼容，IDE 布局中已不使用 */
  activeTab: RemoteDevTab;
  setActiveTab: (tab: RemoteDevTab) => void;

  machines: Machine[];
  setMachines: (machines: Machine[]) => void;
  selectedMachineId: string | null;
  setSelectedMachineId: (id: string | null) => void;

  /** @deprecated IDE 布局中等同于 setSelectedMachineId */
  selectMachineAndNavigate: (id: string, tab: RemoteDevTab) => void;

  tokens: RelayToken[];
  setTokens: (tokens: RelayToken[]) => void;

  openTerminals: string[];
  addTerminal: (machineId: string) => void;
  removeTerminal: (machineId: string) => void;
}

export const useRemoteDevStore = create<RemoteDevState>((set) => ({
  activeTab: 'machines',
  setActiveTab: (tab) => set({ activeTab: tab }),

  machines: [],
  setMachines: (machines) => set({ machines }),
  selectedMachineId: null,
  setSelectedMachineId: (id) => set({ selectedMachineId: id }),

  selectMachineAndNavigate: (id, _tab) =>
    set({ selectedMachineId: id }),

  tokens: [],
  setTokens: (tokens) => set({ tokens }),

  openTerminals: [],
  addTerminal: (machineId) =>
    set((s) => ({
      openTerminals: s.openTerminals.includes(machineId)
        ? s.openTerminals
        : [...s.openTerminals, machineId],
    })),
  removeTerminal: (machineId) =>
    set((s) => ({
      openTerminals: s.openTerminals.filter((id) => id !== machineId),
    })),
}));
