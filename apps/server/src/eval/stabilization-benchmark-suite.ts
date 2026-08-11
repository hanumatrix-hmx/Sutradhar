/**
 * @file apps/server/src/eval/stabilization-benchmark-suite.ts
 * @description Expanded 120-task benchmark suite across 8 core categories with rich execution trace metrics.
 */

import { BenchmarkTask, BenchmarkCategory } from './benchmark-dataset.js';

export type StabilizationCategory =
  | 'Authentication'
  | 'Productivity'
  | 'Documentation'
  | 'CRM'
  | 'Developer Tools'
  | 'Shopping'
  | 'Search'
  | 'Dashboards';

export interface StabilizationExecutionTrace {
  readonly taskId: string;
  readonly category: StabilizationCategory;
  readonly goal: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly retryCount: number;
  readonly recoveryCount: number;
  readonly averageEvidenceConfidence: number;
  readonly decisionExplanations: readonly string[];
  readonly episodeReused: boolean;
  readonly failureCategory?: string;
}

export class StabilizationBenchmarkSuite {
  public static getStabilizationTasks(): readonly BenchmarkTask[] {
    const categories: StabilizationCategory[] = [
      'Authentication',
      'Productivity',
      'Documentation',
      'CRM',
      'Developer Tools',
      'Shopping',
      'Search',
      'Dashboards',
    ];

    const tasks: BenchmarkTask[] = [];
    let counter = 1;

    for (const cat of categories) {
      for (let i = 1; i <= 15; i++) {
        const id = `stab_${cat.toLowerCase().replace(/\s+/g, '_')}_${counter++}`;
        let targetUrl = 'https://example.com';
        let goal = `Perform ${cat} task #${i}`;

        if (cat === 'Authentication') {
          targetUrl = 'https://github.com/login';
          goal = `Sign into user account for authentication task #${i}`;
        } else if (cat === 'Search') {
          targetUrl = 'https://www.google.com';
          goal = `Execute search query for search task #${i}`;
        } else if (cat === 'Documentation') {
          targetUrl = 'https://developer.mozilla.org';
          goal = `Inspect documentation reference for task #${i}`;
        } else if (cat === 'Developer Tools') {
          targetUrl = 'https://github.com/microsoft/TypeScript';
          goal = `Inspect repository code for developer tools task #${i}`;
        } else if (cat === 'Productivity') {
          targetUrl = 'https://wikipedia.org';
          goal = `Read research topic for productivity task #${i}`;
        } else if (cat === 'Dashboards') {
          targetUrl = 'https://news.ycombinator.com';
          goal = `Monitor news dashboard for task #${i}`;
        } else if (cat === 'CRM') {
          targetUrl = 'https://example.com/crm';
          goal = `Filter customer leads for CRM task #${i}`;
        } else if (cat === 'Shopping') {
          targetUrl = 'https://example.com/shop';
          goal = `Add product to cart for shopping task #${i}`;
        }

        tasks.push({
          id,
          category: cat as BenchmarkCategory,
          title: `${cat} task ${i}`,
          goal,
          targetUrl,
          capabilityRequired: 'browser_automation',
        });
      }
    }

    return tasks;
  }
}
