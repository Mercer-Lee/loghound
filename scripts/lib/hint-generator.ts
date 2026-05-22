import type { AnalysisHints, ErrorCluster, HardFailure, ProjectConfig, SignalExtraction } from './types';
import { readProjectsConfig } from './index';

function loadProjectDownstream(): Record<string, string[]> {
  const projects = readProjectsConfig();
  const downstream: Record<string, string[]> = {};
  for (const [name, project] of Object.entries(projects)) {
    if (project.downstream && Array.isArray(project.downstream)) {
      downstream[name] = project.downstream;
    }
  }
  return downstream;
}

export function generateHints(
  signals: SignalExtraction,
  clusters: ErrorCluster[],
  projectConfig: ProjectConfig,
): AnalysisHints {
  const projectDownstream = loadProjectDownstream();
  const hints: AnalysisHints = {
    currentBestHypothesis: null,
    confidence: 'low',
    reasoning: [],
    supportingEvidence: [],
    missingInformation: [],
    suggestedNextAction: null,
    shouldQueryDownstream: false,
    downstreamSuggestions: [],
    alternativeHypotheses: [],
  };

  if (signals.hardFailures.length > 0) {
    const primaryFailure = signals.hardFailures[0];

    switch (primaryFailure.category) {
      case 'REVIEW':
        analyzeReviewFailure(primaryFailure, hints);
        break;
      case 'TIMEOUT':
        analyzeTimeoutFailure(primaryFailure, signals, hints, projectConfig, projectDownstream);
        break;
      case 'RENDER':
        analyzeRenderFailure(primaryFailure, hints);
        break;
      case 'MEDIA':
        analyzeMediaFailure(primaryFailure, hints, projectConfig);
        break;
      case 'DEPENDENCY':
      case 'NETWORK':
        analyzeDependencyFailure(primaryFailure, signals, hints, projectConfig, projectDownstream);
        break;
      default:
        hints.currentBestHypothesis = `Error at ${primaryFailure.layer} layer: ${primaryFailure.code || primaryFailure.error}`;
        hints.confidence = 'medium';
    }

    hints.supportingEvidence.push({
      type: 'HARD_FAILURE',
      time: primaryFailure.time,
      layer: primaryFailure.layer,
      code: primaryFailure.code,
      error: primaryFailure.error,
    });
  }

  if (signals.stateTransitions.length > 0) {
    analyzeStateTransitions(signals.stateTransitions, hints);
  }

  if (signals.crossProjectMentions.length > 0) {
    analyzeCrossProjectMentions(signals.crossProjectMentions, hints, projectConfig, projectDownstream);
  }

  if (clusters.length > 0) {
    analyzeClusters(clusters, hints);
  }

  determineNextAction(hints, projectConfig);

  return hints;
}

function analyzeReviewFailure(failure: HardFailure, hints: AnalysisHints): void {
  const fields = failure.extractedFields || {};

  if (fields.outputIsEmpty && fields.nodeIndex === 1) {
    hints.currentBestHypothesis = 'User input triggered content review at pre-check stage, AI never generated content';
    hints.confidence = 'high';
    hints.reasoning.push('output field is empty, AI never generated content');
    hints.reasoning.push('Failure at first node, indicates pre-check stage');
    hints.suggestedNextAction = 'Extract user input, analyze sensitive content';
    hints.alternativeHypotheses.push({
      hypothesis: 'Post-generation content review failure',
      likelihood: 'low',
      why: 'output is empty, does not match post-generation review pattern',
    });
  } else if (!fields.outputIsEmpty) {
    hints.currentBestHypothesis = 'AI-generated content triggered content review';
    hints.confidence = 'high';
    hints.reasoning.push('output field has content, AI generated content before review');
    hints.suggestedNextAction = 'Extract AI-generated output and analyze sensitive content';
  } else {
    hints.currentBestHypothesis = 'Content review failed, timing to be confirmed';
    hints.confidence = 'medium';
    hints.missingInformation.push('Need to confirm output field and failure node index');
    hints.suggestedNextAction = 'Check full logs to confirm review timing';
  }
}

function analyzeTimeoutFailure(
  failure: HardFailure,
  signals: SignalExtraction,
  hints: AnalysisHints,
  projectConfig: ProjectConfig,
  projectDownstream: Record<string, string[]>,
): void {
  hints.currentBestHypothesis = `Task timed out at ${failure.layer} layer`;
  hints.confidence = 'medium';
  hints.reasoning.push(`Timeout error: ${failure.error}`);

  const downstreamMention = signals.crossProjectMentions.find((m) =>
    projectDownstream[projectConfig.name]?.includes(m.mentionedService),
  );

  if (downstreamMention) {
    hints.reasoning.push(
      `Logs mention downstream service ${downstreamMention.mentionedService}, may be downstream timeout`,
    );
    hints.shouldQueryDownstream = true;
    hints.downstreamSuggestions.push(downstreamMention.mentionedService);
    hints.suggestedNextAction = `Query downstream ${downstreamMention.mentionedService} logs to confirm timeout source`;
  } else {
    hints.suggestedNextAction = 'Check current service internal execution time, confirm if local processing timeout';
  }
}

function analyzeRenderFailure(failure: HardFailure, hints: AnalysisHints): void {
  hints.currentBestHypothesis = 'Render stage failed';
  hints.confidence = 'medium';
  hints.reasoning.push(`Render error: ${failure.code}`);
  hints.suggestedNextAction = 'Check render parameters and resource availability';
  hints.missingInformation.push('Need to confirm specific render error cause (e.g. missing resource, parameter error)');
}

function analyzeMediaFailure(failure: HardFailure, hints: AnalysisHints, _projectConfig: ProjectConfig): void {
  const subtype = failure.subtype;

  if (subtype === 'FILE_NOT_FOUND' || subtype === 'CODEC_ERROR' || subtype === 'INVALID_FORMAT') {
    hints.currentBestHypothesis = `Media processing failure: ${subtype}`;
    hints.confidence = 'high';
    hints.reasoning.push('Media file issue detected');
    hints.suggestedNextAction = 'Verify original media URL accessibility and format';
  } else {
    hints.currentBestHypothesis = 'Media metadata extraction or processing failed';
    hints.confidence = 'medium';
    hints.shouldQueryDownstream = true;
    hints.reasoning.push('Possible cause: URL unreachable, unsupported format, corrupted file');
    hints.suggestedNextAction = 'Verify original media URL accessibility';
  }
}

function analyzeDependencyFailure(
  failure: HardFailure,
  signals: SignalExtraction,
  hints: AnalysisHints,
  projectConfig: ProjectConfig,
  projectDownstream: Record<string, string[]>,
): void {
  hints.currentBestHypothesis = 'Downstream service call failed';
  hints.confidence = 'medium';

  const downstreamMention = signals.crossProjectMentions.find((m) =>
    failure.error?.toLowerCase().includes(m.mentionedService.toLowerCase()),
  );

  if (downstreamMention) {
    hints.reasoning.push(
      `Current project only transparently passes downstream ${downstreamMention.mentionedService} error`,
    );
    hints.shouldQueryDownstream = true;
    hints.downstreamSuggestions.push(downstreamMention.mentionedService);
    hints.suggestedNextAction = `Query ${downstreamMention.mentionedService} project for real failure reason`;
  } else {
    hints.reasoning.push('May be local call to downstream error (network, timeout, configuration)');
    hints.suggestedNextAction = 'Check current service to downstream connection status';
  }
}

function analyzeStateTransitions(transitions: SignalExtraction['stateTransitions'], hints: AnalysisHints): void {
  if (transitions.length < 2) return;

  const first = transitions[0];
  const last = transitions[transitions.length - 1];

  hints.reasoning.push(`Task state transition: ${first.state} -> ... -> ${last.state}`);

  if (last.state === 'FAILED' || last.state === 'failed') {
    hints.supportingEvidence.push({
      type: 'STATE_TRANSITION',
      from: first.state,
      to: last.state,
    });
  }
}

function analyzeCrossProjectMentions(
  mentions: SignalExtraction['crossProjectMentions'],
  hints: AnalysisHints,
  projectConfig: ProjectConfig,
  projectDownstream: Record<string, string[]>,
): void {
  const downstreams = projectDownstream[projectConfig.name] || [];

  for (const mention of mentions) {
    if (downstreams.includes(mention.mentionedService)) {
      if (!hints.downstreamSuggestions.includes(mention.mentionedService)) {
        hints.downstreamSuggestions.push(mention.mentionedService);
      }
    }
  }

  if (hints.downstreamSuggestions.length > 0 && !hints.shouldQueryDownstream) {
    hints.shouldQueryDownstream = true;
    if (!hints.suggestedNextAction) {
      hints.suggestedNextAction = `Suggested downstream query: ${hints.downstreamSuggestions.join(', ')}`;
    }
  }
}

function analyzeClusters(clusters: ErrorCluster[], hints: AnalysisHints): void {
  const errorClusters = clusters.filter((c) => c.category === 'ERROR');

  if (errorClusters.length > 0) {
    const topError = errorClusters[0];
    hints.reasoning.push(`Most common error pattern: ${topError.pattern} (${topError.count} occurrences)`);

    if (!hints.currentBestHypothesis && topError.count >= 3) {
      hints.currentBestHypothesis = `Frequent error: ${topError.representative.error || topError.representative.content}`;
      hints.confidence = 'medium';
    }
  }
}

function determineNextAction(hints: AnalysisHints, _projectConfig: ProjectConfig): void {
  if (hints.confidence === 'high' && hints.currentBestHypothesis) {
    hints.suggestedNextAction = hints.suggestedNextAction || 'Issue located, generate customer response';
    return;
  }

  if (hints.shouldQueryDownstream && hints.downstreamSuggestions.length > 0) {
    return;
  }

  if (hints.missingInformation.length > 0) {
    hints.suggestedNextAction =
      hints.suggestedNextAction || 'Collect missing info: ' + hints.missingInformation.join(', ');
    return;
  }

  if (!hints.suggestedNextAction) {
    hints.suggestedNextAction =
      'Generate preliminary conclusion based on current evidence, suggest user retry or wait for investigation';
  }
}
