export type ProviderStatus = {
  id: string;
  label: string;
  kind: string;
  state: string;
  operations: string[];
};
export type IntegrationStatus = {
  contractVersion: string;
  configurationValid: boolean;
  providers: ProviderStatus[];
};
export type Preview = {
  provider: string;
  operation: string;
  input: unknown;
  allowExternalProcessing: true;
};
export class IntegrationError extends Error {
  code: string;
  status: number;
  constructor(code: string, status?: number);
}
export const registry: readonly {
  id: string;
  label: string;
  kind: string;
  operations: string[];
}[];
export const previewProviders: Readonly<Record<string, string>>;
export function validatePreview(raw: unknown): Preview;
export function integrationStatus(raw?: string): IntegrationStatus;
export function createIntegrationHub(
  raw?: string,
  options?: { fetchImpl?: typeof fetch },
): {
  status(): IntegrationStatus;
  invoke(
    provider: string,
    operation: string,
    input: unknown,
    permission: { allowExternalProcessing: true },
  ): Promise<{
    data: any;
    evidence: {
      provider: string;
      operation: string;
      mode: string;
      requestId: string;
      durationMs: number;
      verifiedNativeProvider: false;
    };
  }>;
};
export function rankCatalogue(
  raw: string | undefined,
  eligibleOptions: any[],
  permission: { allowExternalProcessing: true },
): Promise<{ options: any[]; evidence: any }>;
