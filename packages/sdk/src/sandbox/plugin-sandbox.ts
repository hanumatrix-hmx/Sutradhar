/**
 * @file packages/sdk/src/sandbox/plugin-sandbox.ts
 * @description PluginSandbox enforcing permission checks for sandboxed plugin execution.
 */

import { PluginPermission } from '../manifest/plugin-manifest.js';

export class PluginSandbox {
  private readonly grantedPermissions: Set<PluginPermission>;

  public constructor(grantedPermissions: readonly PluginPermission[] = []) {
    this.grantedPermissions = new Set(grantedPermissions);
  }

  public hasPermission(permission: PluginPermission): boolean {
    return this.grantedPermissions.has(permission);
  }

  public assertPermission(permission: PluginPermission, actionDescription: string): void {
    if (!this.hasPermission(permission)) {
      throw new Error(
        `[PluginSandbox Security Violation] Plugin denied permission "${permission}" required for action: ${actionDescription}`,
      );
    }
  }
}
