CREATE TABLE IF NOT EXISTS `gmail_message_html_cache` (
  `id` int AUTO_INCREMENT NOT NULL,
  `threadId` varchar(255) NOT NULL,
  `messageId` varchar(255) NOT NULL,
  `bodyHtml` mediumtext NOT NULL,
  `capturedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gmail_message_html_cache_message` (`messageId`),
  KEY `idx_gmail_message_html_cache_thread` (`threadId`)
);
