/** Production policy and builder availability: deliberately empty. */
export function operationPolicyRegistryStatus(): Readonly<{
  registryVersion: "c3-operation-registry/v1";
  policyIdentifiers: readonly string[];
  executionCapability: false;
}> {
  return Object.freeze({
    registryVersion: "c3-operation-registry/v1",
    policyIdentifiers: Object.freeze([]),
    executionCapability: false,
  });
}

export function authorizationContextRepositoryStatus(): Readonly<{
  repositoryVersion: "c3-authorization-context-repository/v1";
  durable: true;
  productionReady: false;
}> {
  return Object.freeze({
    repositoryVersion: "c3-authorization-context-repository/v1",
    durable: true,
    productionReady: false,
  });
}
