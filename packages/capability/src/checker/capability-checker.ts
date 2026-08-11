/**
 * @file packages/capability/src/checker/capability-checker.ts
 * @description Pure matching engine for evaluating capability requirements against provider matrices.
 */

import {
  CapabilityMatrix,
  CapabilityRequirement,
  CapabilityDeclaration,
} from '../contracts/capability-interfaces.js';

export interface CapabilityMatchResult {
  readonly isSatisfied: boolean;
  readonly satisfiedCapabilities: readonly CapabilityDeclaration[];
  readonly missingRequirements: readonly CapabilityRequirement[];
}

export class CapabilityChecker {
  /**
   * Checks whether a single capability requirement is satisfied by a provider capability matrix.
   */
  public static supportsCapability(
    matrix: CapabilityMatrix,
    requirement: CapabilityRequirement,
  ): boolean {
    const declaration = matrix.capabilities.find((cap) => cap.type === requirement.type);
    if (!declaration || !declaration.isSupported) {
      return false;
    }

    if (requirement.minVersion && declaration.version) {
      if (declaration.version < requirement.minVersion) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluates a set of capability requirements against a provider matrix.
   */
  public static checkCapabilities(
    matrix: CapabilityMatrix,
    requirements: readonly CapabilityRequirement[],
  ): CapabilityMatchResult {
    const satisfied: CapabilityDeclaration[] = [];
    const missing: CapabilityRequirement[] = [];

    for (const req of requirements) {
      const match = matrix.capabilities.find((cap) => cap.type === req.type && cap.isSupported);

      if (match && this.supportsCapability(matrix, req)) {
        satisfied.push(match);
      } else {
        missing.push(req);
      }
    }

    return {
      isSatisfied: missing.length === 0,
      satisfiedCapabilities: satisfied,
      missingRequirements: missing,
    };
  }

  /**
   * Filters an array of provider capability matrices down to those that satisfy all requirements.
   */
  public static filterCapableProviders(
    matrices: readonly CapabilityMatrix[],
    requirements: readonly CapabilityRequirement[],
  ): readonly CapabilityMatrix[] {
    return matrices.filter((matrix) => this.checkCapabilities(matrix, requirements).isSatisfied);
  }
}
