CREATE TABLE IF NOT EXISTS `madison_action_approvals` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `proposalId` bigint NOT NULL,
  `decision` enum('APPROVE','DISMISS','WRONG_ACTION') NOT NULL,
  `correctedActionType` enum('RESCHEDULE_BOOKING','CANCEL_BOOKING','SERVICE_ISSUE_REVIEW','REFUND_CREDIT_REVIEW','OTHER_OPERATION'),
  `correctionReason` varchar(64),
  `correctedBy` varchar(128) NOT NULL,
  `createdIssueId` bigint,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_madison_action_approvals_proposal_created` (`proposalId`,`createdAt`),
  KEY `idx_madison_action_approvals_issue` (`createdIssueId`),
  KEY `idx_madison_action_approvals_decision_created` (`decision`,`createdAt`)
);
