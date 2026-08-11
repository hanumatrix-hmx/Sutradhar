/**
 * @file packages/browser/src/page/page-understanding-engine.ts
 * @description PageUnderstandingEngine analyzing page structure, element graphs, and URL signals to generate PageModel.
 */

import { SemanticElementGraph } from '../dom/semantic-element-graph.js';
import { ElementCandidate } from '../dom/element-candidate.js';
import { PageModel, PageType, PageRegion, FormRegion, NavigationRegion } from './page-model.js';

export interface IPageUnderstandingEngine {
  analyzePage(graph: SemanticElementGraph): PageModel;
}

export class PageUnderstandingEngine implements IPageUnderstandingEngine {
  public analyzePage(graph: SemanticElementGraph): PageModel {
    const url = graph.url.toLowerCase();
    const title = graph.title.toLowerCase();

    // 1. Infer Page Type
    let pageType: PageType = 'Unknown';
    let primaryIntent = 'General browsing';
    let confidence = 0.6;

    if (
      url.includes('/login') ||
      url.includes('/signin') ||
      title.includes('sign in') ||
      title.includes('log in')
    ) {
      pageType = 'Authentication';
      primaryIntent = 'User authentication & login';
      confidence = 0.95;
    } else if (url.includes('google.com') || url.includes('/search') || title.includes('search')) {
      pageType = 'Search';
      primaryIntent = 'Query search results';
      confidence = 0.92;
    } else if (
      url.includes('github.com') &&
      (url.includes('/releases') || url.includes('/tree/') || url.includes('/blob/'))
    ) {
      pageType = 'Repository';
      primaryIntent = 'Source code and repository inspection';
      confidence = 0.9;
    } else if (
      url.includes('docs.') ||
      url.includes('/docs') ||
      title.includes('documentation') ||
      title.includes('handbook')
    ) {
      pageType = 'Documentation';
      primaryIntent = 'API and framework documentation reference';
      confidence = 0.88;
    } else if (
      url.includes('news.ycombinator.com') ||
      url.includes('/news') ||
      title.includes('news')
    ) {
      pageType = 'News';
      primaryIntent = 'Current news articles and community discussions';
      confidence = 0.88;
    } else if (url.includes('wikipedia.org') || url.includes('/wiki/')) {
      pageType = 'Article';
      primaryIntent = 'Encyclopedic knowledge reading';
      confidence = 0.92;
    } else if (url.includes('/dashboard') || url.includes('/analytics')) {
      pageType = 'Dashboard';
      primaryIntent = 'Metrics and analytics dashboard monitoring';
      confidence = 0.85;
    } else if (url.includes('/checkout') || url.includes('/cart')) {
      pageType = 'Checkout';
      primaryIntent = 'Shopping cart checkout & payment';
      confidence = 0.9;
    } else if (url.includes('/settings') || url.includes('/preferences')) {
      pageType = 'Settings';
      primaryIntent = 'User profile and system settings configuration';
      confidence = 0.85;
    }

    // 2. Identify Regions
    const inputNodes = graph.nodes.filter(
      (n) => n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.role === 'textbox',
    );
    const buttonNodes = graph.nodes.filter((n) => n.tagName === 'BUTTON' || n.role === 'button');
    const linkNodes = graph.nodes.filter((n) => n.tagName === 'A');

    const regions: PageRegion[] = [
      {
        regionType: 'header',
        elementsCount: Math.min(10, linkNodes.length),
        description: 'Top navigation header bar',
      },
      {
        regionType: 'main_content',
        elementsCount: graph.nodes.length,
        description: 'Primary page body content',
      },
    ];

    if (inputNodes.length > 0) {
      regions.push({
        regionType: 'form',
        elementsCount: inputNodes.length + buttonNodes.length,
        description: 'Form input section',
      });
    }

    // 3. Identify Form Region
    const primarySubmit =
      graph.findCandidateByRole('button', 'submit').candidate ||
      graph.findCandidateByRole('button', 'login').candidate;
    const forms: FormRegion[] = [
      {
        inputFieldsCount: inputNodes.length,
        submitButton: primarySubmit,
      },
    ];

    // 4. Identify Navigation Region
    const navigation: NavigationRegion[] = [
      {
        linksCount: linkNodes.length,
        navTitle: 'Main Navigation Bar',
      },
    ];

    // 5. Identify Primary Action & Important Elements
    const primaryCandidateMatch =
      graph.findCandidatesByText('Search') || graph.findCandidateByRole('button');
    const primaryAction = primaryCandidateMatch.candidate;

    const importantElements: ElementCandidate[] = [];
    if (primaryAction) importantElements.push(primaryAction);

    return {
      pageType,
      primaryIntent,
      primaryAction,
      regions,
      forms,
      navigation,
      importantElements,
      confidence,
    };
  }
}
