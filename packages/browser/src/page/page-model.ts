/**
 * @file packages/browser/src/page/page-model.ts
 * @description PageModel and PageType definitions for the Page Understanding Engine.
 */

import { ElementCandidate } from '../dom/element-candidate.js';

export type PageType =
  | 'Authentication'
  | 'Search'
  | 'Dashboard'
  | 'Documentation'
  | 'Repository'
  | 'Article'
  | 'News'
  | 'Shopping'
  | 'Checkout'
  | 'Settings'
  | 'Forms'
  | 'Unknown';

export type RegionType =
  | 'header'
  | 'navigation'
  | 'main_content'
  | 'form'
  | 'search_bar'
  | 'footer'
  | 'sidebar';

export interface PageRegion {
  readonly regionType: RegionType;
  readonly elementsCount: number;
  readonly description: string;
}

export interface FormRegion {
  readonly formId?: string;
  readonly inputFieldsCount: number;
  readonly submitButton?: ElementCandidate;
}

export interface NavigationRegion {
  readonly linksCount: number;
  readonly navTitle?: string;
}

export interface PageModel {
  readonly pageType: PageType;
  readonly primaryIntent: string;
  readonly primaryAction?: ElementCandidate;
  readonly regions: readonly PageRegion[];
  readonly forms: readonly FormRegion[];
  readonly navigation: readonly NavigationRegion[];
  readonly importantElements: readonly ElementCandidate[];
  readonly confidence: number;
}
