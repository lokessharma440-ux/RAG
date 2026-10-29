import { RepositoryAnalysis } from '../../models/RepositoryAnalysis.js';
import { AIFixPrompt } from '../../models/AIFixPrompt.js';

/**
 * Compares two analysis snapshots for a repository to verify which
 * issues were resolved, which remain, and which new issues were introduced.
 */
export async function compareAnalyses({
  repositoryId,
  ownerUserId,
  previousAnalysisId = null,
  currentAnalysisId = null,
}) {
  // 1. Fetch Analyses
  let currentAnalysis = null;
  let previousAnalysis = null;

  if (currentAnalysisId) {
    currentAnalysis = await RepositoryAnalysis.findOne({
      _id: currentAnalysisId,
      repositoryId,
      ownerUserId,
    });
  } else {
    // Default to newest
    currentAnalysis = await RepositoryAnalysis.findOne({
      repositoryId,
      ownerUserId,
      status: 'completed',
    }).sort({ createdAt: -1 });
  }

  if (!currentAnalysis) {
    throw new Error('Current analysis run not found.');
  }

  if (previousAnalysisId) {
    previousAnalysis = await RepositoryAnalysis.findOne({
      _id: previousAnalysisId,
      repositoryId,
      ownerUserId,
    });
  } else {
    // Default to the one immediately prior to current
    previousAnalysis = await RepositoryAnalysis.findOne({
      repositoryId,
      ownerUserId,
      status: 'completed',
      _id: { $ne: currentAnalysis._id },
      createdAt: { $lt: currentAnalysis.createdAt },
    }).sort({ createdAt: -1 });
  }

  if (!previousAnalysis) {
    return {
      success: true,
      data: {
        comparisonAvailable: false,
        message: 'Only one analysis run exists. Run another analysis after applying fixes to compare results.',
        currentAnalysis: {
          id: currentAnalysis._id,
          commitSha: currentAnalysis.commitSha,
          completedAt: currentAnalysis.completedAt,
          findingsCount: (currentAnalysis.findings || []).length,
        },
      },
    };
  }

  const prevFindings = previousAnalysis.findings || [];
  const currFindings = currentAnalysis.findings || [];

  const currIds = new Set(currFindings.map((f) => f.id));
  const prevIds = new Set(prevFindings.map((f) => f.id));

  // Resolved = in prev, but NOT in curr
  const resolvedFindings = prevFindings.filter((f) => !currIds.has(f.id));

  // Still Present = in both prev AND curr
  const stillPresentFindings = currFindings.filter((f) => prevIds.has(f.id));

  // New Findings = in curr, but NOT in prev
  const newFindings = currFindings.filter((f) => !prevIds.has(f.id));

  const totalPrevious = prevFindings.length;
  const fixRatePercentage = totalPrevious > 0
    ? Math.round((resolvedFindings.length / totalPrevious) * 100)
    : 100;

  // 2. Optionally update related AIFixPrompt statuses
  const relatedPrompts = await AIFixPrompt.find({
    repositoryId,
    ownerUserId,
    status: { $in: ['GENERATED', 'COPIED', 'DOWNLOADED', 'EXTERNAL_FIX_IN_PROGRESS'] },
  });

  const promptStatusUpdates = [];
  for (const prompt of relatedPrompts) {
    const promptFindingIds = prompt.selectedFindingIds || [];
    const allResolved = promptFindingIds.every((id) => !currIds.has(id));
    const someResolved = promptFindingIds.some((id) => !currIds.has(id));

    let newStatus = prompt.status;
    if (allResolved && promptFindingIds.length > 0) {
      newStatus = 'FIX_VERIFIED';
    } else if (someResolved) {
      newStatus = 'NEEDS_MANUAL_REVIEW';
    } else {
      newStatus = 'STILL_PRESENT';
    }

    if (newStatus !== prompt.status) {
      prompt.status = newStatus;
      await prompt.save();
      promptStatusUpdates.push({ promptId: prompt._id, newStatus });
    }
  }

  return {
    success: true,
    data: {
      comparisonAvailable: true,
      previousAnalysis: {
        id: previousAnalysis._id,
        commitSha: previousAnalysis.commitSha,
        completedAt: previousAnalysis.completedAt,
        findingsCount: prevFindings.length,
      },
      currentAnalysis: {
        id: currentAnalysis._id,
        commitSha: currentAnalysis.commitSha,
        completedAt: currentAnalysis.completedAt,
        findingsCount: currFindings.length,
      },
      metrics: {
        totalPrevious,
        resolvedCount: resolvedFindings.length,
        stillPresentCount: stillPresentFindings.length,
        newFindingsCount: newFindings.length,
        fixRatePercentage,
      },
      resolvedFindings: resolvedFindings.map((f) => ({
        id: f.id,
        title: f.title,
        severity: f.severity,
        category: f.category,
        filePath: f.filePath,
      })),
      stillPresentFindings: stillPresentFindings.map((f) => ({
        id: f.id,
        title: f.title,
        severity: f.severity,
        category: f.category,
        filePath: f.filePath,
      })),
      newFindings: newFindings.map((f) => ({
        id: f.id,
        title: f.title,
        severity: f.severity,
        category: f.category,
        filePath: f.filePath,
      })),
      promptStatusUpdates,
    },
  };
}
