/** Legacy in-memory manifest scenario repository; excluded from production. */
import { createHash } from "node:crypto";

import {
  assertManifestLifecycleTransition,
  canonicalize,
  computeManifestCoreHash,
  validateDeploymentManifest,
  type C3DeploymentManifest,
  type C3ManifestStatus,
} from "../../src/manifest.ts";

export type PersistedManifestRevision = Readonly<{
  manifestId: string;
  revision: number;
  status: C3ManifestStatus;
  manifest: C3DeploymentManifest;
  evidenceIds: readonly string[];
  previousRevisionHash?: string;
}>;

const manifestEvidenceRegistry: ReadonlyMap<
  string,
  Readonly<{ kind: string; manifestId: string; configurationHash: string }>
> = new Map();

export class InMemoryManifestRepository {
  readonly durable = false;
  readonly #records = new Map<string, PersistedManifestRevision>();

  createProposed(manifestId: string, manifest: C3DeploymentManifest): void {
    if (!/^c3-manifest-[a-f0-9]{16,64}$/.test(manifestId))
      throw new Error("Manifest identifier is malformed.");
    const validation = validateDeploymentManifest(manifest);
    if (!validation.valid || manifest.status !== "proposed")
      throw new Error(
        "Only a valid proposed manifest can enter the repository.",
      );
    if (this.#records.has(manifestId))
      throw new Error("Manifest identifier already exists.");
    this.#records.set(
      manifestId,
      Object.freeze({
        manifestId,
        revision: 1,
        status: "proposed",
        manifest: structuredClone(manifest),
        evidenceIds: Object.freeze([]),
      }),
    );
  }

  read(manifestId: string): PersistedManifestRevision | undefined {
    const record = this.#records.get(manifestId);
    return record ? structuredClone(record) : undefined;
  }

  transition(
    manifestId: string,
    expectedRevision: number,
    nextManifest: C3DeploymentManifest,
    evidenceIds: readonly string[],
  ): PersistedManifestRevision {
    const current = this.#records.get(manifestId);
    if (!current || current.revision !== expectedRevision)
      throw new Error("Manifest compare-and-swap conflict.");
    assertManifestLifecycleTransition(current.manifest, nextManifest);
    if (
      evidenceIds.length === 0 ||
      new Set(evidenceIds).size !== evidenceIds.length
    )
      throw new Error(
        "Manifest transition requires unique trusted evidence IDs.",
      );
    for (const evidenceId of evidenceIds) {
      const evidence = manifestEvidenceRegistry.get(evidenceId);
      if (
        !evidence ||
        evidence.manifestId !== manifestId ||
        evidence.configurationHash !== computeManifestCoreHash(nextManifest)
      )
        throw new Error(
          "Manifest transition evidence is unknown or mismatched.",
        );
    }
    const next = Object.freeze({
      manifestId,
      revision: current.revision + 1,
      status: nextManifest.status,
      manifest: structuredClone(nextManifest),
      evidenceIds: Object.freeze([...evidenceIds]),
      previousRevisionHash: createHash("sha256")
        .update(canonicalize(current))
        .digest("hex"),
    });
    this.#records.set(manifestId, next);
    return structuredClone(next);
  }
}
