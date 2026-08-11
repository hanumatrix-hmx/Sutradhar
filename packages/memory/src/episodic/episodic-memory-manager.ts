/**
 * @file packages/memory/src/episodic/episodic-memory-manager.ts
 * @description EpisodicMemoryManager managing structured episode lifecycles, retrieval, and automated lesson extraction.
 */

import { PageType, DecisionEvidenceLike } from './episodic-types.js';
import { Episode, EpisodeFilter, EpisodeOutcome } from './episode-model.js';
import { StructuredLogger } from '@sutradhar/observability';

export interface IEpisodicMemoryManager {
  createEpisode(goal: string, pageType: PageType, taskGraphId: string): Episode;
  recordAction(episodeId: string, action: string): void;
  recordEvidence(episodeId: string, evidence: DecisionEvidenceLike): void;
  recordRecovery(episodeId: string, recoveryMessage: string): void;
  finalizeEpisode(
    episodeId: string,
    outcome: EpisodeOutcome,
    duration: number,
  ): Episode | undefined;
  queryEpisodes(filter?: EpisodeFilter): readonly Episode[];
}

export class EpisodicMemoryManager implements IEpisodicMemoryManager {
  private readonly episodesMap = new Map<string, Episode>();
  private readonly logger: StructuredLogger;

  public constructor(logger?: StructuredLogger) {
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public createEpisode(goal: string, pageType: PageType, taskGraphId: string): Episode {
    const id = `ep_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const episode: Episode = {
      id,
      goal,
      pageType,
      taskGraphId,
      actions: [],
      decisionEvidence: [],
      recoveries: [],
      outcome: 'success',
      duration: 0,
      timestamp: new Date().toISOString(),
      lessonsLearned: [],
    };

    this.episodesMap.set(id, episode);
    this.logger.info(
      `[EpisodicMemoryManager] Created episode ${id} for goal "${goal}" (PageType: ${pageType})`,
    );
    return episode;
  }

  public recordAction(episodeId: string, action: string): void {
    const ep = this.episodesMap.get(episodeId);
    if (!ep) return;
    (ep.actions as string[]).push(action);
  }

  public recordEvidence(episodeId: string, evidence: DecisionEvidenceLike): void {
    const ep = this.episodesMap.get(episodeId);
    if (!ep) return;
    (ep.decisionEvidence as DecisionEvidenceLike[]).push(evidence);
  }

  public recordRecovery(episodeId: string, recoveryMessage: string): void {
    const ep = this.episodesMap.get(episodeId);
    if (!ep) return;
    (ep.recoveries as string[]).push(recoveryMessage);
  }

  public finalizeEpisode(
    episodeId: string,
    outcome: EpisodeOutcome,
    duration: number,
  ): Episode | undefined {
    const ep = this.episodesMap.get(episodeId);
    if (!ep) return undefined;

    ep.outcome = outcome;
    ep.duration = duration;

    // Automated Lesson Extraction
    const lessons: string[] = [];
    if (outcome === 'success') {
      lessons.push(`Successful execution strategy on ${ep.pageType} page for goal "${ep.goal}".`);
      if (ep.recoveries.length > 0) {
        lessons.push(
          `Recovered from ${ep.recoveries.length} execution obstacles using automated strategies.`,
        );
      }
    } else {
      lessons.push(
        `Execution failed on ${ep.pageType} page. Avoid repeating unsuccessful actions.`,
      );
    }

    ep.lessonsLearned = lessons;
    this.logger.info(
      `[EpisodicMemoryManager] Finalized episode ${episodeId} with outcome ${outcome}. Extracted ${lessons.length} lessons.`,
    );

    return ep;
  }

  public queryEpisodes(filter: EpisodeFilter = {}): readonly Episode[] {
    const all = Array.from(this.episodesMap.values());
    return all.filter((ep) => {
      if (filter.pageType && ep.pageType !== filter.pageType) return false;
      if (filter.outcome && ep.outcome !== filter.outcome) return false;
      if (filter.goal && !ep.goal.toLowerCase().includes(filter.goal.toLowerCase())) return false;
      return true;
    });
  }
}
