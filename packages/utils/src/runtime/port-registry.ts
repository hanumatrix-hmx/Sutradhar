/**
 * @file packages/utils/src/runtime/port-registry.ts
 * @description Preferred Port Registry for Hanumatrix ecosystem projects.
 */

export interface ProjectPortConfig {
  readonly projectName: string;
  readonly frontendPreferredPort: number;
  readonly backendPreferredPort: number;
  readonly websocketPreferredPort?: number;
}

export const HANUMATRIX_PORT_REGISTRY: Record<string, ProjectPortConfig> = {
  PinchTab: {
    projectName: 'PinchTab',
    frontendPreferredPort: 5173,
    backendPreferredPort: 3000,
    websocketPreferredPort: 3001,
  },
  MitSu: {
    projectName: 'MitSu',
    frontendPreferredPort: 5180,
    backendPreferredPort: 3100,
  },
  Supamatrix: {
    projectName: 'Supamatrix',
    frontendPreferredPort: 5190,
    backendPreferredPort: 3200,
  },
  EstateMatrix: {
    projectName: 'Estate Matrix',
    frontendPreferredPort: 5200,
    backendPreferredPort: 3300,
  },
  FanucSDK: {
    projectName: 'Fanuc SDK',
    frontendPreferredPort: 5210,
    backendPreferredPort: 3400,
  },
};
