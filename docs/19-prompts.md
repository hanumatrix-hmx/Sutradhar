---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Depends on ADRs:
  - 0005-tool-system
References ADRs:
  - 0004-runtime-architecture
Related Packages:
  - '@pinchtab/prompt'
  - '@pinchtab/orchestrator'
---

# System Prompt Templates & Guardrails

## 1. ReAct Reasoner System Prompt Template

```handlebars
You are an autonomous AI Browser Agent controlling a web browser. Your objective:
{{goal}}

CURRENT PAGE SNAPSHOT:
{{domSnapshot}}

AVAILABLE TOOLS:
{{toolDefinitions}}

PREVIOUS STEPS & OBSERVATIONS:
{{executionHistory}}

Instructions: 1. Analyze the current page snapshot and execution history. 2. Select the next single
tool action required to make progress toward the goal. 3. Respond strictly in the required JSON
tool-calling format.
```

## 2. Prompt Versioning & Validation

- All prompts are registered in `@pinchtab/prompt` with explicit version identifiers (e.g. `react-reasoner-v1.0`).
- Prompts undergo variable schema validation before rendering to prevent missing variable errors.
