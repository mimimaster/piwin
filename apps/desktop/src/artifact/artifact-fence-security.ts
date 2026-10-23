import type { ArtifactConfig } from '@piwin/contracts';

export type ArtifactFenceSecurityProps = {
  artifactMaxBytes?: number;
  artifactBlockExternalScripts?: boolean;
  artifactBlockExternalResources?: boolean;
};

export function artifactFenceSecurityProps(
  artifact: ArtifactConfig | undefined,
): ArtifactFenceSecurityProps {
  if (!artifact) {
    return {};
  }
  return {
    artifactMaxBytes: artifact.maxBytes,
    artifactBlockExternalScripts: artifact.blockExternalScripts !== false,
    artifactBlockExternalResources: artifact.blockExternalResources !== false,
  };
}

export function pickArtifactFenceSecurity(
  props: ArtifactFenceSecurityProps,
): ArtifactFenceSecurityProps {
  const next: ArtifactFenceSecurityProps = {};
  if (props.artifactMaxBytes !== undefined) {
    next.artifactMaxBytes = props.artifactMaxBytes;
  }
  if (props.artifactBlockExternalScripts !== undefined) {
    next.artifactBlockExternalScripts = props.artifactBlockExternalScripts;
  }
  if (props.artifactBlockExternalResources !== undefined) {
    next.artifactBlockExternalResources = props.artifactBlockExternalResources;
  }
  return next;
}
