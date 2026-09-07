import { Type } from 'typebox';
import type { SubagentManager } from '../manager.js';
import { formatSubagentList, renderSubagentListResult } from '../render/tools/subagent-list-agents.js';
import { ok, fail } from './tool-response.js';

export function createSubagentListAgentsTool(manager: SubagentManager) {
  return {
    name: 'subagent_list_agents',
    label: 'Subagent List Agents',
    description: 'List available markdown-defined subagents for delegation.',
    promptSnippet: 'List available subagents loaded from global/project agents and subagents markdown directories.',
    parameters: Type.Object({}),
    async execute(_id: string, _params: any, _signal: any, _onUpdate: any, ctx: any) {
      try {
        const agents = manager.listAgents(ctx?.cwd ?? process.cwd(), ctx);
        const publicAgents = agents.map((agent) => ({
          name: agent.name,
          description: agent.description,
          filePath: agent.filePath,
          tools: agent.tools,
          allow_model_override: agent.allow_model_override,
          model_aliases: agent.model_aliases,
        }));
        return ok(formatSubagentList(publicAgents, true), { agents: publicAgents });
      } catch (e) {
        return fail(e);
      }
    },
    renderResult(result: any, { expanded }: any, theme: any) {
      return renderSubagentListResult(result, Boolean(expanded), theme);
    },
  };
}
