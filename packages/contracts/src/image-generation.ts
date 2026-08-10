/** Safe metadata returned by an image-generation endpoint smoke test. */
export type ImageGenerationTestOutput = {
  mimeType: string;
  byteSize: number;
};

/** Result of testing one configured image model through its real generation route. */
export type ImageGenerationTestResult = {
  providerId: string;
  modelId: string;
  durationMs: number;
  imageCount: number;
  outputs: ImageGenerationTestOutput[];
};
