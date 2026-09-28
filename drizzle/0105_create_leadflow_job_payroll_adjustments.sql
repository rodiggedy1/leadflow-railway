CREATE TABLE IF NOT EXISTS `leadflow_job_payroll_adjustments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `leadflowJobId` int NOT NULL,
  `amountCents` int NOT NULL,
  `reason` varchar(500) NOT NULL,
  `createdByAgentId` int NOT NULL,
  `createdByAgentName` varchar(128) NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_lf_job_payroll_adjustments_job` (`leadflowJobId`),
  KEY `idx_lf_job_payroll_adjustments_created` (`createdAt`)
);
