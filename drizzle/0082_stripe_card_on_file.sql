CREATE TABLE `card_auth_tokens` (
  `id` int AUTO_INCREMENT NOT NULL,
  `token` varchar(64) NOT NULL,
  `customerPhone` varchar(30) NOT NULL,
  `customerName` varchar(255),
  `jobDate` varchar(64),
  `jobAddress` varchar(512),
  `cleanerJobId` int,
  `used` tinyint NOT NULL DEFAULT 0,
  `expiresAt` bigint NOT NULL,
  `completedAt` bigint,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `card_auth_tokens_id` PRIMARY KEY(`id`),
  CONSTRAINT `card_auth_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `stripe_customers` (
  `id` int AUTO_INCREMENT NOT NULL,
  `phone` varchar(30) NOT NULL,
  `name` varchar(255),
  `stripeCustomerId` varchar(64) NOT NULL,
  `stripePaymentMethodId` varchar(64),
  `cardBrand` varchar(32),
  `cardLast4` varchar(4),
  `cardExpMonth` int,
  `cardExpYear` int,
  `cardSavedAt` bigint,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `stripe_customers_id` PRIMARY KEY(`id`),
  CONSTRAINT `stripe_customers_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `payment_authorizations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `cleanerJobId` int,
  `jobLabel` varchar(255),
  `customerPhone` varchar(30) NOT NULL,
  `customerName` varchar(255),
  `stripeCustomerId` varchar(64) NOT NULL,
  `stripePaymentMethodId` varchar(64) NOT NULL,
  `stripePaymentIntentId` varchar(64),
  `amountCents` int NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'usd',
  `status` varchar(32) NOT NULL DEFAULT 'authorized',
  `errorMessage` text,
  `createdBy` varchar(128),
  `actionBy` varchar(128),
  `notes` text,
  `authorizedAt` bigint,
  `capturedAt` bigint,
  `cancelledAt` bigint,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `payment_authorizations_id` PRIMARY KEY(`id`)
);
