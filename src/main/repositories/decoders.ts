const decoders: { [encoding: string]: TextDecoder } = {};

export default function getDecoder(encoding: string): TextDecoder {
  if (!decoders[encoding]) {
    decoders[encoding] = new TextDecoder(encoding);
  }
  return decoders[encoding]
}
