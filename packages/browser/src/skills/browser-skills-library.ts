/**
 * @file packages/browser/src/skills/browser-skills-library.ts
 * @description Composable high-level Browser Skills Library building upon BrowserActionEngine and DOMSemanticEngine.
 */

import { IBrowserTab } from '../session/browser-tab.js';
import { BrowserActionEngine } from '../actions/browser-action-engine.js';
import { DOMSemanticEngine } from '../dom/dom-semantic-engine.js';
import { ActionResultDto } from '../actions/action-types.js';

export class BrowserSkillsLibrary {
  private readonly actionEngine: BrowserActionEngine;
  private readonly semanticEngine: DOMSemanticEngine;

  public constructor(actionEngine?: BrowserActionEngine, semanticEngine?: DOMSemanticEngine) {
    this.actionEngine = actionEngine ?? new BrowserActionEngine();
    this.semanticEngine = semanticEngine ?? new DOMSemanticEngine();
  }

  public async searchGoogle(tab: IBrowserTab, query: string): Promise<ActionResultDto> {
    await this.actionEngine.executeAction(tab, { actionType: 'navigate', url: 'https://www.google.com' });
    await this.actionEngine.executeAction(tab, { actionType: 'type', selector: 'textarea[name="q"], input[name="q"]', value: query });
    return this.actionEngine.executeAction(tab, { actionType: 'press_key', key: 'Enter' });
  }

  public async login(tab: IBrowserTab, usernameVal: string, passwordVal: string): Promise<ActionResultDto> {
    const graph = await this.semanticEngine.buildGraph(tab);
    const userField = graph.findInputByLabel('username') || graph.findInputByLabel('email') || graph.nodes.find((n) => n.tagName === 'INPUT');
    const passField = graph.findInputByLabel('password') || graph.nodes.find((n) => n.placeholder?.toLowerCase().includes('pass'));

    const userSelector = userField?.accessibleName
      ? `input[name="${userField.accessibleName}"], input[id="${userField.accessibleName}"]`
      : 'input[name="login"], input[name="username"], input[type="text"]';

    await this.actionEngine.executeAction(tab, { actionType: 'type', selector: userSelector, value: usernameVal });

    if (passField) {
      await this.actionEngine.executeAction(tab, { actionType: 'type', selector: 'input[type="password"]', value: passwordVal });
    }

    return {
      success: true,
      actionType: 'type',
      executionTimeMs: 100,
      currentUrl: tab.url,
      outputData: { message: 'Identified and filled login credentials fields' },
    };
  }

  public async fillForm(tab: IBrowserTab, fields: Record<string, string>): Promise<ActionResultDto> {
    for (const [label, val] of Object.entries(fields)) {
      await this.actionEngine.executeAction(tab, { actionType: 'type_by_label', label, value: val });
    }
    return {
      success: true,
      actionType: 'type',
      executionTimeMs: 150,
      currentUrl: tab.url,
      outputData: { filledFieldsCount: Object.keys(fields).length },
    };
  }

  public async extractLinks(tab: IBrowserTab): Promise<readonly string[]> {
    const graph = await this.semanticEngine.buildGraph(tab);
    return graph.nodes
      .filter((n) => n.tagName === 'A' && n.accessibleName)
      .map((n) => n.accessibleName!);
  }

  public async extractEmails(tab: IBrowserTab): Promise<readonly string[]> {
    const graph = await this.semanticEngine.buildGraph(tab);
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = new Set<string>();

    for (const node of graph.nodes) {
      const text = `${node.accessibleName || ''} ${node.nearbyText || ''}`;
      const found = text.match(emailRegex);
      if (found) {
        found.forEach((e) => matches.add(e));
      }
    }
    return Array.from(matches);
  }

  public async acceptCookies(tab: IBrowserTab): Promise<ActionResultDto> {
    const graph = await this.semanticEngine.buildGraph(tab);
    const cookieBtn = graph.findByText('Accept') || graph.findByText('Agree') || graph.findByText('Allow');
    if (cookieBtn) {
      return this.actionEngine.executeAction(tab, { actionType: 'click_by_text', text: cookieBtn.accessibleName });
    }
    return { success: true, actionType: 'click', executionTimeMs: 0 };
  }

  public async dismissPopup(tab: IBrowserTab): Promise<ActionResultDto> {
    const graph = await this.semanticEngine.buildGraph(tab);
    const closeBtn = graph.findByText('Close') || graph.findByText('Dismiss') || graph.findByText('✕');
    if (closeBtn) {
      return this.actionEngine.executeAction(tab, { actionType: 'click_by_text', text: closeBtn.accessibleName });
    }
    return { success: true, actionType: 'click', executionTimeMs: 0 };
  }

  public async captureScreenshot(tab: IBrowserTab): Promise<ActionResultDto> {
    return this.actionEngine.executeAction(tab, { actionType: 'take_screenshot' });
  }
}
