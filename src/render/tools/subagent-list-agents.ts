import { textComponent } from './components.js';

export type ListedSubagent = {
  name: string;
  tools: string[];
  allow_model_override?: boolean;
  model_aliases?: string[];
};

function summary(agent: ListedSubagent): string {
  const override = agent.allow_model_override
    ? `allowed (${agent.model_aliases?.join(', ') || 'no aliases configured'})`
    : 'disabled';
  return `${agent.name} · model override: ${override}`;
}

export function formatSubagentList(agents: ListedSubagent[], includeTools: boolean): string {
  if (!agents.length) return 'No subagents available.';
  return agents.map((agent) => (
    includeTools ? `${summary(agent)} · tools: ${agent.tools.join(', ') || 'none'}` : summary(agent)
  )).join('\n');
}

export function renderSubagentListResult(result: any, expanded: boolean, theme: any) {
  const agents: ListedSubagent[] = Array.isArray(result?.details?.agents) ? result.details.agents : [];
  if (!agents.length) return textComponent('No subagents available.');
  const dim = (text: string) => theme?.fg?.('dim', text) ?? text;

  if (expanded) {
    return textComponent(agents.flatMap((agent) => [
      summary(agent),
      dim(`  tools: ${agent.tools.join(', ') || 'none'}`),
    ]).join('\n'));
  }

  const visible = agents.slice(0, 5);
  const hidden = agents.length - visible.length;
  return textComponent([
    ...visible.map(summary),
    hidden > 0 ? dim(`… ${hidden} more agents hidden`) : undefined,
    dim('ctrl+o to expand'),
  ].filter((line): line is string => Boolean(line)).join('\n'));
}
