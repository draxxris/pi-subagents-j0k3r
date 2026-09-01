import type { EffectiveSubagentProfile, ModelRef, ProfileValueSource, ResolvedProfileField, SubagentDefinition, SubagentsConfig, ThinkingEffort } from './types.js';

function modelLabel(model: ModelRef): string {
  return `${model.provider}/${model.id}`;
}

function effortFromCtx(ctx: any): ThinkingEffort | undefined {
  const effort = ctx?.pi?.getThinkingLevel?.() ?? ctx?.getThinkingLevel?.() ?? ctx?.thinkingLevel;
  return typeof effort === 'string' ? effort as ThinkingEffort : undefined;
}

function modelFromCtx(ctx: any): ModelRef | undefined {
  const model = ctx?.model;
  if (!model || typeof model !== 'object') return undefined;
  const provider = typeof model.provider === 'string' ? model.provider : undefined;
  const id = typeof model.id === 'string' ? model.id : typeof model.name === 'string' ? model.name : undefined;
  return provider && id ? { provider, id } : undefined;
}

export function profileSourceLabel<T>(source: ProfileValueSource, value: T | undefined, format: (value: T) => string): string {
  return value === undefined ? 'unresolved' : `${source}: ${format(value)}`;
}

function field<T>(source: ProfileValueSource, value: T | undefined, format: (value: T) => string): ResolvedProfileField<T> {
  return { value, source, label: profileSourceLabel(source, value, format) };
}

function profileForDefinition(definition: SubagentDefinition, config: SubagentsConfig) {
  if (definition.scope === 'project') return config.project_model_profiles?.[definition.name] ?? (config.project_model_profiles ? undefined : config.model_profiles[definition.name]);
  return config.global_model_profiles?.[definition.name] ?? (config.global_model_profiles ? undefined : config.model_profiles[definition.name]);
}

function resolveModel(definition: SubagentDefinition, config: SubagentsConfig, ctx: any): ResolvedProfileField<ModelRef> {
  const profile = profileForDefinition(definition, config);
  if (profile?.model) return field('profile', profile.model, modelLabel);
  if (definition.model) return field('definition', definition.model, modelLabel);
  if (config.default_model) return field('default', config.default_model, modelLabel);
  const orchestratorModel = modelFromCtx(ctx);
  if (orchestratorModel) return field('orchestrator', orchestratorModel, modelLabel);
  return field('unresolved', undefined, modelLabel);
}

function resolveEffort(definition: SubagentDefinition, config: SubagentsConfig, ctx: any): ResolvedProfileField<ThinkingEffort> {
  const profile = profileForDefinition(definition, config);
  if (profile?.effort) return field('profile', profile.effort, String);
  if (definition.effort) return field('definition', definition.effort, String);
  if (config.default_effort) return field('default', config.default_effort, String);
  const orchestratorEffort = effortFromCtx(ctx);
  if (orchestratorEffort) return field('orchestrator', orchestratorEffort, String);
  return field('unresolved', undefined, String);
}

export function resolveEffectiveSubagentProfile(input: {
  agentName: string;
  definition: SubagentDefinition;
  config: SubagentsConfig;
  ctx: any;
}): EffectiveSubagentProfile {
  const definition = { ...input.definition, name: input.agentName.toLowerCase() };
  return {
    agent: definition.name,
    model: resolveModel(definition, input.config, input.ctx),
    effort: resolveEffort(definition, input.config, input.ctx),
  };
}

export function resolveSubagentRunProfile(input: {
  agentName: string;
  definition: SubagentDefinition;
  config: SubagentsConfig;
  ctx: any;
  modelAlias?: string;
}): EffectiveSubagentProfile {
  const resolved = resolveEffectiveSubagentProfile(input);
  if (input.modelAlias === undefined) return resolved;
  if (!input.definition.allow_model_override) {
    throw new Error(`Subagent "${input.definition.name}" does not allow model overrides. Set allow_model_override: true in its frontmatter to enable them.`);
  }
  const alias = input.modelAlias.trim().toLowerCase();
  const rawEntry: any = input.config.model_aliases?.[alias];
  if (!alias || !rawEntry) {
    const available = Object.keys(input.config.model_aliases ?? {}).sort();
    const suffix = available.length ? ` Available aliases: ${available.join(', ')}.` : ' No model aliases are configured.';
    throw new Error(`Unknown subagent model alias: ${input.modelAlias}.${suffix}`);
  }
  // Support both new {model, effort} shape and legacy bare ModelRef for backward compat
  const aliasModel: ModelRef = rawEntry.model ?? rawEntry;
  const aliasEffort: ThinkingEffort | undefined = rawEntry.effort;
  if (!aliasModel?.provider || !aliasModel?.id) {
    const available = Object.keys(input.config.model_aliases ?? {}).sort();
    const suffix = available.length ? ` Available aliases: ${available.join(', ')}.` : ' No model aliases are configured.';
    throw new Error(`Unknown subagent model alias: ${input.modelAlias}.${suffix}`);
  }
  return {
    ...resolved,
    model: field('invocation', aliasModel, modelLabel),
    effort: aliasEffort ? field('invocation', aliasEffort, String) : resolved.effort,
  };
}
