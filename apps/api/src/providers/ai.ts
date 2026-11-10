export type EligibleExperience = {
  id: string;
  title: string;
  activity: string;
  price_cents: number;
};
export interface AIProvider {
  suggestDates(input: {
    publicInterests: string[];
    eligibleOptions: EligibleExperience[];
  }): Promise<{ id: string; reason: string }[]>;
  draftIcebreaker(input: {
    publicPrompt: string;
  }): Promise<{ draft: string; source: "deterministic" }>;
}
// This adapter receives eligible public catalogue entries, never private budgets or chat.
export class DeterministicPlanner implements AIProvider {
  async suggestDates(input: {
    publicInterests: string[];
    eligibleOptions: EligibleExperience[];
  }) {
    return [...input.eligibleOptions]
      .sort(
        (a, b) =>
          Number(input.publicInterests.includes(b.activity)) -
            Number(input.publicInterests.includes(a.activity)) ||
          a.price_cents - b.price_cents ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 3)
      .map((x) => ({
        id: x.id,
        reason: `A ${x.activity.toLowerCase()} option from the eligible fictional catalogue.`,
      }));
  }
  async draftIcebreaker(_input: { publicPrompt: string }) {
    return {
      draft: "What is something you are looking forward to this week?",
      source: "deterministic" as const,
    };
  }
}
