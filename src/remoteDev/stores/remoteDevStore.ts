/**
 * 远程开发状态管理
 *
 * IDE 布局：所有面板同时可见，通过机器选择器联动
 *
 * @module remoteDev/stores/remoteDevStore
 */

import { create } from 'zustand';
import type { Machine, RelayToken } from '../types/remoteDev';

interface RemoteDevState {
  machines: Machine[];
  setMachines: (machines: Machine[]) => void;
  selectedMachineId: string | null;
  setSelectedMachineId: (id: string | null) => void;

  tokens: RelayToken[];
  setTokens: (tokens: RelayToken[]) => void;

  openTerminals: string[];
  addTerminal: (machineId: string) => void;
  removeTerminal: (machineId: string) => void;
}

export const useRemoteDevStore = create<RemoteDevState>((set) => ({
  machines: [],
  setMachines: (machines) => set({ machines }),
  selectedMachineId: null,
  setSelectedMachineId: (id) => set({ selectedMachineId: id }),

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
