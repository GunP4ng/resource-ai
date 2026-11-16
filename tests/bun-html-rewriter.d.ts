// The official HTMLRewriter declaration needs this byte-buffer alias.
// Keep the existing Node test program free of Bun's global fetch extensions.
// This is Bun's NodeJS.TypedArray | DataView | ArrayBufferLike union.
declare namespace Bun {
  type BufferSource = NodeJS.ArrayBufferView<ArrayBufferLike> | ArrayBufferLike;
}
