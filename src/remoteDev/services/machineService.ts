/**
 * 机器管理服务 (Phase 2)
 *
 * @module remoteDev/services/machineService
 */

import type { RemoteDevApiClient } from './apiClient';
import type {
  Machine,
  MachineCreateParams,
  MachineUpdateParams,
  SSHTestResult,
} from '../types/remoteDev';

export function createMachineService(api: RemoteDevApiClient) {
  return {
    async createMachine(params: MachineCreateParams): Promise<Machine> {
      return api.post('/api/remote-dev/machines', params);
    },

    async listMachines(): Promise<Machine[]> {
      return api.get('/api/remote-dev/machines');
    },

    async getMachine(machineId: string): Promise<Machine> {
      return api.get(`/api/remote-dev/machines/${machineId}`);
    },

    async updateMachine(machineId: string, params: MachineUpdateParams): Promise<Machine> {
      return api.put(`/api/remote-dev/machines/${machineId}`, params);
    },

    async deleteMachine(machineId: string): Promise<void> {
      await api.delete(`/api/remote-dev/machines/${machineId}`);
    },

    async testSSH(machineId: string): Promise<SSHTestResult> {
      return api.post(`/api/remote-dev/machines/${machineId}/test`);
    },
  };
}

export type MachineService = ReturnType<typeof createMachineService>;
