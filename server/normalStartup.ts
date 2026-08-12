export type NormalStartupDependencies = {
  checkSmsCampaignSchema: () => Promise<void>;
};

/**
 * Deliberately limited normal boot contract. Schema evolution belongs to the
 * pre-deploy runner; operational repairs remain explicit, unused functions.
 */
export async function runNormalStartup({ checkSmsCampaignSchema }: NormalStartupDependencies): Promise<void> {
  await checkSmsCampaignSchema();
}
