ALTER TABLE `madison_golden_case_reviews`
  ADD COLUMN IF NOT EXISTS `expectedAnnotation` json;
