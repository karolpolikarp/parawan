// Punkt wejścia runnera ewaluacji: te same moduły, z których korzysta aplikacja (apps/web).
// Bez warstw NER/LLM, więc nic nie łączy się z siecią.
export { redactPII } from '../../packages/core/src/index';
export { extractDocxText } from '../../apps/web/src/docx';
export { decodeText } from '../../apps/web/src/files';
