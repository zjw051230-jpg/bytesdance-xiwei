import { createActivityLogRepository } from "./activityRepository.js";
import { createAgentArtifactRepository } from "./agentArtifactRepository.js";
import { createAgentRunRepository } from "./agentRunRepository.js";
import { createClarificationRepository } from "./clarificationRepository.js";
import { createDesignPlanRepository } from "./designPlanRepository.js";
import { createPlanningTaskRepository } from "./planningTaskRepository.js";
import { createPrDraftRepository } from "./prDraftRepository.js";
import { createProjectRepository } from "./projectRepository.js";
import { createRequirementRepository } from "./requirementRepository.js";
import { createReviewItemRepository } from "./reviewRepository.js";

export function createWorkbenchRepositories(database) {
  return {
    projects: createProjectRepository(database),
    requirements: createRequirementRepository(database),
    clarifications: createClarificationRepository(database),
    designPlans: createDesignPlanRepository(database),
    planningTasks: createPlanningTaskRepository(database),
    agentRuns: createAgentRunRepository(database),
    agentArtifacts: createAgentArtifactRepository(database),
    reviewItems: createReviewItemRepository(database),
    prDrafts: createPrDraftRepository(database),
    activityLogs: createActivityLogRepository(database)
  };
}

export { createActivityLogRepository } from "./activityRepository.js";
export { createAgentArtifactRepository } from "./agentArtifactRepository.js";
export { createAgentRunRepository } from "./agentRunRepository.js";
export { createClarificationRepository } from "./clarificationRepository.js";
export { createDesignPlanRepository } from "./designPlanRepository.js";
export { createPlanningTaskRepository } from "./planningTaskRepository.js";
export { createPrDraftRepository } from "./prDraftRepository.js";
export { createProjectRepository } from "./projectRepository.js";
export { createRequirementRepository } from "./requirementRepository.js";
export { createReviewItemRepository } from "./reviewRepository.js";
